/**
 * FarmVest help assistant.
 *
 * Rule-based on purpose. Two kinds of question arrive here: how the app works,
 * which has one correct answer that never changes, and what is happening on
 * this account, which has an answer only the database knows. A language model
 * would improvise on the second kind; matching an intent and then reading the
 * row cannot. Nothing it says is generated, so nothing it says can be wrong
 * about the account.
 *
 * This is a support feature rather than a third AI: the two AI features in the
 * proposal stay the investment recommender and the weather advisory. Where the
 * assistant reports on either, it calls the same module the page does instead
 * of working the answer out again.
 *
 * Each acting role gets its own intents, because the same words mean different
 * things on either side of a transaction: "my projects" is what a farm owner
 * posted and what an investor funded.
 */

import { supabase } from '../supabaseClient';
import type { UserRole } from '../contexts/AuthContext';
import { peso, shortDate } from './format';
import { loadAdvisory, advisoryFor, WeatherError } from './weather';
import { COMMISSION_RATE } from './revenue';
import { isReleasedStage } from './funding';
import {
  matchLabel,
  recommend,
  type FarmOutlook,
  type TrackRecord,
} from './recommend';

export type ChatContext = {
  userId: string;
  name: string;
};

export type Intent = {
  id: string;
  /** Shown as a choice in the thread. */
  label: string;
  /** Offered in the opening list. The rest are behind More questions. */
  suggested?: boolean;
  /** Kept out of the list entirely. Small talk is answered, never offered. */
  hidden?: boolean;
  /** Lower-case words or phrases. A phrase counts for more than a word. */
  keywords: string[];
  answer: (context: ChatContext) => string | Promise<string>;
};

const bullet = (lines: string[]) => lines.map((line) => `• ${line}`).join('\n');

const numbered = (lines: string[]) =>
  lines.map((line, index) => `${index + 1}. ${line}`).join('\n');

// ---------------------------------------------------------------------------
// Small talk, shared by both roles
// ---------------------------------------------------------------------------

const SMALL_TALK: Intent[] = [
  {
    id: 'hello',
    label: 'Say hello',
    hidden: true,
    keywords: [
      'hi',
      'hello',
      'hey',
      'yo',
      'kumusta',
      'kamusta',
      'musta',
      'good morning',
      'good afternoon',
      'good evening',
      'good day',
    ],
    answer: ({ name }) =>
      `Yes, how may I help you${name ? `, ${name.split(' ')[0]}` : ''}? Pick one of the questions below, or type what you need.`,
  },
  {
    id: 'thanks',
    label: 'Thanks',
    hidden: true,
    keywords: ['thanks', 'thank', 'salamat', 'ty', 'appreciate'],
    answer: () => 'Any time. Ask again whenever you need something.',
  },
  {
    id: 'bye',
    label: 'Goodbye',
    hidden: true,
    keywords: ['bye', 'goodbye', 'see you', 'later', 'that is all', 'nothing else'],
    answer: () => 'Goodbye. Good luck with the farm.',
  },
];

// ---------------------------------------------------------------------------
// Farm Owner: answers that read the account
// ---------------------------------------------------------------------------

const projectSummary = async ({ userId }: ChatContext) => {
  const { data, error } = await supabase
    .from('projects')
    .select('title, status, funding_goal, current_funding, rejection_reason')
    .eq('customers_id', userId)
    .order('created_at', { ascending: false });

  if (error) return `I could not read your projects: ${error.message}`;

  const rows = data ?? [];
  if (rows.length === 0) {
    return 'You have not posted a project yet. Open My Projects and use New Project to post your first one.';
  }

  const counts = new Map<string, number>();
  rows.forEach((row) => counts.set(row.status, (counts.get(row.status) ?? 0) + 1));

  const raised = rows.reduce((sum, row) => sum + Number(row.current_funding), 0);

  return [
    `You have ${rows.length} project${rows.length === 1 ? '' : 's'}, and they have raised ${peso(raised)} so far.`,
    '',
    bullet(Array.from(counts, ([status, count]) => `${status}: ${count}`)),
  ].join('\n');
};

const rejectedProjects = async ({ userId }: ChatContext) => {
  const { data, error } = await supabase
    .from('projects')
    .select('title, rejection_reason')
    .eq('customers_id', userId)
    .eq('status', 'Rejected');

  if (error) return `I could not read your projects: ${error.message}`;

  const rows = data ?? [];
  if (rows.length === 0) return 'None of your projects has been rejected. Nothing to fix.';

  return [
    `${rows.length} project${rows.length === 1 ? ' was' : 's were'} rejected, with the reason the Admin gave:`,
    '',
    bullet(rows.map((row) => `${row.title} — ${row.rejection_reason || 'no reason recorded'}`)),
    '',
    'Post a corrected project from My Projects. A rejected one cannot be edited back into review.',
  ].join('\n');
};

const rentalStatus = async ({ userId }: ChatContext) => {
  const { data, error } = await supabase
    .from('rentals')
    .select('start_date, end_date, status, equipment(name)')
    .eq('customers_id', userId)
    .neq('status', 'Completed')
    .neq('status', 'Cancelled')
    .order('start_date');

  if (error) return `I could not read your bookings: ${error.message}`;

  const rows = (data ?? []) as unknown as {
    start_date: string;
    end_date: string;
    status: string;
    equipment: { name: string } | null;
  }[];

  if (rows.length === 0) {
    return 'You have no open booking. Browse the fleet under Rent Equipment to reserve a unit.';
  }

  return [
    `You have ${rows.length} open booking${rows.length === 1 ? '' : 's'}:`,
    '',
    bullet(
      rows.map(
        (row) =>
          `${row.equipment?.name ?? 'Unit'} — ${row.status}, ${shortDate(row.start_date)} to ${shortDate(row.end_date)}`
      )
    ),
  ].join('\n');
};

/** Shared by both roles, differing only in whose location is read. */
const describeAdvisory = async (city: string, province: string, label: string) => {
  try {
    const advisory = await loadAdvisory(city, province);
    const definition = advisoryFor(advisory.level);
    const rain = Math.round(advisory.days.reduce((sum, day) => sum + day.rainMm, 0));

    return [
      `${label}: ${advisory.headline}`,
      '',
      `${rain} mm of rain is forecast over the next ${advisory.days.length} days.`,
      '',
      'What to do:',
      bullet(definition.actions),
    ].join('\n');
  } catch (failure) {
    return failure instanceof WeatherError
      ? failure.message
      : 'I could not reach the forecast right now.';
  }
};

const farmOwnerWeather = async ({ userId }: ChatContext) => {
  const { data } = await supabase
    .from('customers')
    .select('farm_city, farm_province')
    .eq('customers_id', userId)
    .maybeSingle();

  const owner = data as { farm_city: string | null; farm_province: string | null } | null;

  const answer = await describeAdvisory(
    owner?.farm_city ?? '',
    owner?.farm_province ?? '',
    'Your farm'
  );

  return `${answer}\n\nThe full outlook is on the Weather Advisory page.`;
};

const progressAnswer = async ({ userId }: ChatContext) => {
  const { data } = await supabase
    .from('projects')
    .select('projects_id')
    .eq('customers_id', userId)
    .in('status', ['Open', 'Funded', 'In Progress']);

  const ids = (data ?? []).map((row) => row.projects_id);

  if (ids.length === 0) {
    return 'You have no funded project to report on yet. Progress updates start once a project is Open or later.';
  }

  const { data: updates } = await supabase
    .from('progress_updates')
    .select('captured_at')
    .in('projects_id', ids)
    .order('captured_at', { ascending: false })
    .limit(1);

  const last = updates?.[0]?.captured_at;

  const lead = last
    ? `Your last progress update was on ${shortDate(last)}.`
    : 'You have not posted a progress update yet.';

  return [
    lead,
    '',
    'Investors judge a project by this trail, and an empty trail is what a dispute case looks at first. To post one:',
    '',
    numbered([
      'Open Progress Updates.',
      'Pick the project.',
      'Take or choose a photo. The location and time are attached automatically.',
      'Add a short note on what changed.',
    ]),
  ].join('\n');
};

// ---------------------------------------------------------------------------
// Investor: answers that read the account
// ---------------------------------------------------------------------------

const portfolioSummary = async ({ userId }: ChatContext) => {
  const { data, error } = await supabase
    .from('investments')
    .select('amount, milestone_stage, projects(title, status)')
    .eq('customers_id', userId);

  if (error) return `I could not read your investments: ${error.message}`;

  const rows = (data ?? []) as unknown as {
    amount: number;
    milestone_stage: string;
    projects: { title: string; status: string } | null;
  }[];

  if (rows.length === 0) {
    return 'You have not invested yet. Open Browse Projects to see what is open for funding.';
  }

  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const held = rows.filter((row) => !isReleasedStage(row.milestone_stage)).length;

  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const status = row.projects?.status ?? 'Unknown';
    counts.set(status, (counts.get(status) ?? 0) + 1);
  });

  return [
    `You have ${rows.length} investment${rows.length === 1 ? '' : 's'} totalling ${peso(total)}.`,
    '',
    bullet(Array.from(counts, ([status, count]) => `${status}: ${count}`)),
    '',
    held > 0
      ? `${held} of them still have funds held back, released only as the farm reports progress.`
      : 'Every one of them has reached the Final release stage.',
  ].join('\n');
};

const preferencesAnswer = async ({ userId }: ChatContext) => {
  const { data } = await supabase
    .from('customers')
    .select('investment_budget')
    .eq('customers_id', userId)
    .maybeSingle();

  const row = data as { investment_budget: number | null } | null;

  const budget =
    row?.investment_budget != null ? peso(row.investment_budget) : 'not set';

  return [
    `Your budget is ${budget}.`,
    '',
    'That is what the recommendations are matched against. Change it on Browse Projects, or under My Account in the menu on your name at the top right.',
    '',
    row?.investment_budget == null
      ? 'Setting a budget sharpens the matching considerably: without one, budget fit is scored as neutral for every project.'
      : 'A project whose remaining amount your budget covers in full scores highest on budget fit.',
  ].join('\n');
};

/**
 * The top recommendation, worked out by the same module the browse page uses.
 *
 * Calling recommend() rather than restating its rules is the point: two answers
 * to the same question that disagree are worse than one answer, and this way
 * the assistant cannot drift from the ranking on screen.
 */
const topRecommendation = async ({ userId }: ChatContext) => {
  const [{ data: prefs }, { data: projectRows }] = await Promise.all([
    supabase
      .from('customers')
      .select('investment_budget')
      .eq('customers_id', userId)
      .maybeSingle(),
    supabase
      .from('projects')
      .select(
        'projects_id, customers_id, title, category, funding_goal, current_funding'
      )
      .eq('status', 'Open')
      // The assistant recommends what this customer can actually fund.
      .neq('customers_id', userId),
  ]);

  const projects = (projectRows ?? []) as {
    projects_id: string;
    customers_id: string;
    title: string;
    category: string | null;
    funding_goal: number;
    current_funding: number;
  }[];

  if (projects.length === 0) {
    return 'No project is open for funding right now. Farm owners post them here once an administrator approves them.';
  }

  const ownerIds = Array.from(new Set(projects.map((row) => row.customers_id)));

  const [{ data: trackRecords }, { data: directory }] = await Promise.all([
    supabase
      .from('customer_track_record')
      .select(
        'customers_id, completed_projects, total_projects, last_update_at, progress_update_count, average_rating, rating_count, open_disputes'
      )
      .in('customers_id', ownerIds),
    supabase
      .from('customer_directory')
      .select('customers_id, name, farm_city, farm_province')
      .in('customers_id', ownerIds),
  ]);

  const records = new Map(
    (trackRecords ?? []).map((row) => [
      (row as { customers_id: string }).customers_id,
      row as unknown as TrackRecord,
    ])
  );

  const owners = new Map(
    (directory ?? []).map((row) => [
      (row as { customers_id: string }).customers_id,
      row as { customers_id: string; name: string; farm_city: string | null; farm_province: string | null },
    ])
  );

  // One forecast per town, the same unit the browse page fetches on.
  const byPlace = new Map<string, string[]>();
  owners.forEach((owner, ownerId) => {
    if (!owner.farm_city || !owner.farm_province) return;
    const key = `${owner.farm_city}|${owner.farm_province}`;
    byPlace.set(key, [...(byPlace.get(key) ?? []), ownerId]);
  });

  const forecasts = await Promise.allSettled(
    Array.from(byPlace.keys()).map(async (key) => {
      const [city, province] = key.split('|');
      return { key, advisory: await loadAdvisory(city, province) };
    })
  );

  const outlooks = new Map<string, FarmOutlook>();
  forecasts.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    const { key, advisory } = result.value;
    (byPlace.get(key) ?? []).forEach((ownerId) =>
      outlooks.set(ownerId, {
        level: advisory.level,
        leadTimeDays: advisory.leadTimeDays,
        place: advisory.matchedPlace,
      })
    );
  });

  const ranked = recommend(
    {
      budget: prefs?.investment_budget != null ? Number(prefs.investment_budget) : null,
    },
    projects.map((row) => ({
      projectsId: row.projects_id,
      farmOwnersId: row.customers_id,
      category: row.category ?? 'Other',
      fundingGoal: Number(row.funding_goal),
      currentFunding: Number(row.current_funding),
    })),
    records,
    outlooks
  );

  const best = ranked[0];
  const project = projects.find((row) => row.projects_id === best.projectsId);
  const owner = project ? owners.get(project.customers_id) : undefined;

  return [
    `Your closest match is ${project?.title ?? 'a project'} by ${owner?.name ?? 'a farm owner'}${owner?.farm_city ? ` in ${owner.farm_city}` : ''}.`,
    '',
    `${matchLabel(best.score)}, scoring ${best.score} out of 100:`,
    '',
    bullet(best.reasons.slice(0, 5).map((reason) => reason.text)),
    '',
    'The full ranking, with every project scored, is on Browse Projects.',
  ].join('\n');
};

const investorProgress = async ({ userId }: ChatContext) => {
  const { data } = await supabase
    .from('investments')
    .select('projects(projects_id, title)')
    .eq('customers_id', userId);

  const rows = (data ?? []) as unknown as {
    projects: { projects_id: string; title: string } | null;
  }[];

  const unique = new Map<string, string>();
  rows.forEach((row) => {
    if (row.projects) unique.set(row.projects.projects_id, row.projects.title);
  });

  if (unique.size === 0) {
    return 'You have not funded a project yet, so there is no progress trail to follow.';
  }

  const { data: updates } = await supabase
    .from('progress_updates')
    .select('projects_id, captured_at')
    .in('projects_id', Array.from(unique.keys()))
    .order('captured_at', { ascending: false });

  const latest = new Map<string, string>();
  ((updates ?? []) as { projects_id: string; captured_at: string }[]).forEach((row) => {
    if (!latest.has(row.projects_id)) latest.set(row.projects_id, row.captured_at);
  });

  const lines = Array.from(unique, ([id, title]) => {
    const last = latest.get(id);
    if (!last) return `${title} — no update posted yet`;
    const days = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
    return `${title} — last update ${shortDate(last)}${days >= 14 ? ` (${days} days ago)` : ''}`;
  });

  const quiet = Array.from(unique.keys()).filter((id) => {
    const last = latest.get(id);
    return !last || Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000) >= 14;
  });

  return [
    `You are following ${unique.size} project${unique.size === 1 ? '' : 's'}:`,
    '',
    bullet(lines),
    '',
    quiet.length > 0
      ? 'A farm that stops posting is the first thing a dispute case looks at. Ask the farm owner, and report it to the administrator if it continues.'
      : 'Every project you funded has posted recently. The photos are on Progress Monitoring.',
  ].join('\n');
};

const investorWeather = async ({ userId }: ChatContext) => {
  const { data } = await supabase
    .from('investments')
    .select('projects(customers_id, title)')
    .eq('customers_id', userId);

  const rows = (data ?? []) as unknown as {
    projects: { customers_id: string; title: string } | null;
  }[];

  const ownerIds = Array.from(
    new Set(rows.map((row) => row.projects?.customers_id).filter(Boolean) as string[])
  );

  if (ownerIds.length === 0) {
    return 'You have not funded a project yet. Once you do, I can tell you the forecast where that farm is.';
  }

  const { data: directory } = await supabase
    .from('customer_directory')
    .select('customers_id, name, farm_city, farm_province')
    .in('customers_id', ownerIds);

  const owners = (directory ?? []) as {
    customers_id: string;
    name: string;
    farm_city: string | null;
    farm_province: string | null;
  }[];

  const results = await Promise.allSettled(
    owners.map(async (owner) => {
      const advisory = await loadAdvisory(owner.farm_city ?? '', owner.farm_province ?? '');
      return { owner, advisory };
    })
  );

  const lines = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => {
      const { owner, advisory } = (
        result as PromiseFulfilledResult<{
          owner: (typeof owners)[number];
          advisory: Awaited<ReturnType<typeof loadAdvisory>>;
        }>
      ).value;

      const definition = advisoryFor(advisory.level);
      return advisory.level === 0
        ? `${owner.farm_city ?? owner.name}: no wind signal expected.`
        : `${owner.farm_city ?? owner.name}: ${definition.label} expected in ${advisory.leadTimeDays} day${advisory.leadTimeDays === 1 ? '' : 's'}.`;
    });

  if (lines.length === 0) {
    return 'I could not reach the forecast for those farms right now.';
  }

  return [
    'The forecast where your funded farms are:',
    '',
    bullet(lines),
    '',
    'A storm at the farm is scored against a project in the recommendations, so a warning here is already reflected in the ranking on Browse Projects.',
  ].join('\n');
};

// ---------------------------------------------------------------------------
// Intents per role
// ---------------------------------------------------------------------------

const FARM_OWNER_INTENTS: Intent[] = [
  ...SMALL_TALK,
  {
    id: 'about',
    label: 'What can you do?',
    hidden: true,
    keywords: ['what can you do', 'who are you', 'what are you', 'how do you work', 'help me'],
    answer: () =>
      [
        'I am the FarmVest assistant. Two kinds of question:',
        '',
        bullet([
          'How the app works: posting a project, renting equipment, fees, approvals.',
          'What is happening on your account: your projects, your bookings, the forecast for your farm.',
        ]),
        '',
        'The second kind is read from your own records, so the numbers are the real ones.',
      ].join('\n'),
  },
  {
    id: 'projects',
    label: 'My projects',
    suggested: true,
    keywords: ['my project', 'projects', 'project status', 'how many project', 'funding'],
    answer: projectSummary,
  },
  {
    id: 'rentals',
    label: 'My bookings',
    suggested: true,
    keywords: ['my rental', 'rentals', 'booking', 'bookings', 'equipment status', 'my equipment'],
    answer: rentalStatus,
  },
  {
    id: 'weather',
    label: 'Weather this week',
    suggested: true,
    keywords: ['weather', 'typhoon', 'storm', 'bagyo', 'rain', 'wind', 'forecast', 'signal'],
    answer: farmOwnerWeather,
  },
  {
    id: 'post-project',
    label: 'How to post a project',
    suggested: true,
    keywords: ['post a project', 'new project', 'create project', 'add project', 'how to post'],
    answer: () =>
      [
        'To post a livestock project:',
        '',
        numbered([
          'Open My Projects and press New Project.',
          'Fill in the title, category, and funding goal, then attach your documents: two proving you farm there, and a photo of the coop, pen or pond.',
          'Add a cover photo. A project with a photo is funded more often.',
          'Submit. It starts as Pending Approval.',
        ]),
        '',
        'The Admin reviews it before investors can see it. Watch the Pending Approval tab.',
      ].join('\n'),
  },
  {
    id: 'rent',
    label: 'How to rent equipment',
    suggested: true,
    keywords: ['rent equipment', 'how to rent', 'book equipment', 'hire equipment', 'fleet'],
    answer: () =>
      [
        'FarmVest owns the fleet, so you rent directly from us:',
        '',
        numbered([
          'Open Rent Equipment and pick a unit.',
          'Choose your start and end dates. Booked dates are blocked automatically.',
          'Check the cost estimate. You are charged per day, both ends included.',
          'Type your full name to sign the agreement, then send the request.',
        ]),
        '',
        'The Admin confirms it. Follow it under My Rentals.',
      ].join('\n'),
  },
  {
    id: 'progress',
    label: 'Progress updates',
    suggested: true,
    keywords: ['progress', 'update', 'photo', 'geotag', 'proof'],
    answer: progressAnswer,
  },
  {
    id: 'rejected',
    label: 'Why was my project rejected?',
    keywords: ['rejected', 'reject', 'declined', 'denied', 'not approved'],
    answer: rejectedProjects,
  },
  {
    id: 'approval',
    label: 'Account approval',
    keywords: ['approve', 'approval', 'pending account', 'verify', 'verification', 'valid id'],
    answer: () =>
      [
        'Every new account starts as Pending. The Admin checks the government ID you uploaded against the details on your registration, then approves it.',
        '',
        'You cannot sign in until that passes. No confirmation email is sent, because the ID is the identity check.',
      ].join('\n'),
  },
  {
    id: 'fees',
    label: 'Fees and commission',
    keywords: ['fee', 'fees', 'commission', 'charge', 'cost', 'price', 'how much'],
    answer: () =>
      [
        'Two different things, and they are often mixed up:',
        '',
        bullet([
          `Investment: FarmVest charges a ${COMMISSION_RATE * 100}% commission on what your project raised, only if it succeeds. You pay it with the repayment, after the harvest is sold.`,
          'Equipment: there is no commission. FarmVest owns the fleet, so you pay a daily rental rate.',
        ]),
        '',
        'Posting a project and browsing the fleet cost nothing.',
      ].join('\n'),
  },
  {
    id: 'damage',
    label: 'Equipment damage',
    keywords: ['damage', 'broken', 'repair', 'return', 'inspection'],
    answer: () =>
      [
        'A unit is inspected when it comes back, and the two cases are handled differently:',
        '',
        bullet([
          'Damage beyond normal wear is charged to you, under clause 4 of the rental agreement.',
          'Mechanical failure is not charged. FarmVest owns the fleet and carries that cost.',
        ]),
        '',
        'If you disagree with an assessment, file a case with the Admin so it is reviewed on record.',
      ].join('\n'),
  },
  {
    id: 'reports',
    label: 'Where are my finished projects?',
    keywords: ['completed', 'finished', 'history', 'archive', 'report', 'past'],
    answer: () =>
      [
        'Completed projects and closed bookings move to Reports, so My Projects and My Rentals only carry work that still needs something done.',
        '',
        'Reports has a tab for each, with your totals: how much you raised, and how much you paid in rental fees.',
      ].join('\n'),
  },
  {
    id: 'account',
    label: 'Change my details',
    keywords: ['account', 'profile', 'password', 'change', 'settings', 'avatar', 'contact number'],
    answer: () =>
      'Open the menu on your name at the top right and choose My Account. Your contact number, photo, and farm details are edited there.',
  },
  {
    id: 'admin',
    label: 'Contact the Admin',
    keywords: ['admin', 'contact', 'help', 'support', 'dispute', 'complaint', 'report someone'],
    answer: () =>
      [
        'The Admin handles account approval, booking confirmation, and disputes.',
        '',
        'To raise a case, file a report from the project or booking it concerns. It reaches the Admin as an open case with the evidence attached, and you can follow the decision.',
      ].join('\n'),
  },
];

const INVESTOR_INTENTS: Intent[] = [
  ...SMALL_TALK,
  {
    id: 'about',
    label: 'What can you do?',
    hidden: true,
    keywords: ['what can you do', 'who are you', 'what are you', 'how do you work', 'help me'],
    answer: () =>
      [
        'I am the FarmVest assistant. Two kinds of question:',
        '',
        bullet([
          'How the app works: investing, milestone releases, fees, and how projects are checked.',
          'What is happening on your account: your portfolio, your recommendations, the farms you are following.',
        ]),
        '',
        'The second kind is read from your own records, so the numbers are the real ones.',
      ].join('\n'),
  },
  {
    id: 'recommend',
    label: 'What should I invest in?',
    suggested: true,
    keywords: [
      'recommend',
      'recommendation',
      'suggest',
      'best project',
      'what should i invest',
      'where to invest',
      'good investment',
      'match',
    ],
    answer: topRecommendation,
  },
  {
    id: 'portfolio',
    label: 'My investments',
    suggested: true,
    keywords: ['my investment', 'investments', 'portfolio', 'how much have i', 'what did i fund'],
    answer: portfolioSummary,
  },
  {
    id: 'preferences',
    label: 'My investment budget',
    suggested: true,
    keywords: ['budget', 'my preference', 'preferences', 'how much can i'],
    answer: preferencesAnswer,
  },
  {
    id: 'monitor',
    label: 'How are my farms doing?',
    suggested: true,
    keywords: ['progress', 'update', 'photo', 'monitoring', 'how is my', 'farm doing'],
    answer: investorProgress,
  },
  {
    id: 'how-to-invest',
    label: 'How to invest',
    suggested: true,
    keywords: ['how to invest', 'how do i invest', 'invest in a project', 'fund a project'],
    answer: () =>
      [
        'To invest in a livestock project:',
        '',
        numbered([
          'Open Browse Projects. Enter your budget in the panel at the top and it ranks every open project against it.',
          'Read the risk disclosure on the project you want.',
          'Type your full name to sign the agreement.',
          'Confirm the amount.',
        ]),
        '',
        'The money is not released to the farm all at once. It moves in three stages, which is what limits the loss if something goes wrong.',
      ].join('\n'),
  },
  {
    id: 'weather',
    label: 'Weather at the farms I funded',
    suggested: true,
    keywords: ['weather', 'typhoon', 'storm', 'bagyo', 'rain', 'wind', 'forecast', 'signal'],
    answer: investorWeather,
  },
  {
    id: 'milestones',
    label: 'How are funds released?',
    keywords: ['milestone', 'release', 'stage', 'initial', 'midterm', 'final', 'when is the money'],
    answer: () =>
      [
        'Funds move to the farm in one full release:',
        '',
        bullet([
          'FarmVest holds every payment until the project is fully funded.',
          'Once funded, the whole raise goes to the farm owner, with nothing deducted.',
          'If the goal is not reached, the project is cancelled and you are refunded.',
        ]),
        '',
        'After the release, the farm owner posts progress and liquidates at the end of the cycle, with receipts.',
      ].join('\n'),
  },
  {
    id: 'risk',
    label: 'How risky is this, and how do I judge a project?',
    keywords: ['risk', 'risky', 'how risky', 'safe', 'lose my money', 'guarantee'],
    answer: () =>
      [
        'Every project here can lose money. This is an investment and not a loan, and no return is guaranteed. Livestock can die of disease, weather or accident, and prices can fall.',
        '',
        'What you can check before you commit:',
        '',
        bullet([
          'Nothing reaches you until an administrator has reviewed it. A farm owner must attach two separate documents proving they farm there, plus photos of the actual coop, pen or pond.',
          'The recommendation panel scores each project against your budget, the farm\u2019s finished work, how other investors are behaving, and the weather where the farm is.',
          'Read the progress updates. A farm that posts regularly is telling you something a form cannot.',
        ]),
        '',
        'The real protection is the staged release. Funds move to the farm in three stages against evidenced progress, so a project that stops never receives the rest.',
      ].join('\n'),
  },
  {
    id: 'fees',
    label: 'Fees and commission',
    keywords: ['fee', 'fees', 'commission', 'charge', 'cost', 'how much do you take'],
    answer: () =>
      [
        `Investors pay no commission. FarmVest charges the farm owner ${COMMISSION_RATE * 100}% of the raise, only when the project succeeds. Browsing and signing up cost nothing.`,
        '',
        'FarmVest does not hold or move your money beyond that: the platform records the agreement and the milestone releases, and the transfer itself is arranged between you and the farm owner.',
      ].join('\n'),
  },
  {
    id: 'dispute',
    label: 'Report a problem',
    keywords: ['dispute', 'complaint', 'report', 'scam', 'fraud', 'suspicious', 'no update'],
    answer: () =>
      [
        'File a case from the project it concerns. Pick a category, say what happened, and it reaches the Admin as an open case.',
        '',
        'The Admin sees the reported account, the funding, the full timestamped photo trail, and every investor with money at risk. They can freeze the project, which hides it from investors, blocks new investment, and holds the remaining release.',
        '',
        'The strongest evidence is a farm that stopped posting progress updates.',
      ].join('\n'),
  },
  {
    id: 'reports',
    label: 'Where are my finished investments?',
    keywords: ['completed', 'finished', 'history', 'archive', 'past', 'cancelled', 'contract'],
    answer: () =>
      [
        'Completed and cancelled projects move to Reports, so My Investments only carries what is still running.',
        '',
        'Reports has three tabs: Completed Investments, Cancelled Projects, and Signed Agreements, each with its own totals.',
      ].join('\n'),
  },
  {
    id: 'account',
    label: 'Change my details',
    keywords: ['account', 'profile', 'password', 'change', 'settings', 'avatar', 'contact number'],
    answer: () =>
      'Open the menu on your name at the top right and choose My Account. Your contact number, photo, and investment budget are edited there.',
  },
  {
    id: 'admin',
    label: 'Contact the Admin',
    keywords: ['admin', 'contact', 'support', 'who approves'],
    answer: () =>
      [
        'The Admin approves accounts and projects, and decides disputes.',
        '',
        'There is no direct message channel. Anything that needs their attention is raised as a case from the project it concerns, so the evidence travels with it.',
      ].join('\n'),
  },
];

/**
 * One account farms and invests, so the assistant answers both.
 *
 * The two lists stay separate above rather than being merged into one array:
 * they were written to different audiences, and keeping the seam means a
 * question about renting a tractor cannot be answered with portfolio wording.
 * Farming comes first for the same reason it does in the sidebar.
 */
const CUSTOMER_INTENTS: Intent[] = [...FARM_OWNER_INTENTS, ...INVESTOR_INTENTS];

const BY_ROLE: Partial<Record<UserRole, Intent[]>> = {
  Customer: CUSTOMER_INTENTS,
};

/** The Admin has the dashboards for all of this, so no assistant is offered. */
export const intentsFor = (role: UserRole | null): Intent[] =>
  (role && BY_ROLE[role]) || [];

export const suggestedFor = (role: UserRole | null) =>
  intentsFor(role).filter((intent) => intent.suggested);

/** Everything worth putting in front of someone, greetings excluded. */
export const menuFor = (role: UserRole | null) =>
  intentsFor(role).filter((intent) => !intent.hidden);

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Pick the intent a message is asking for.
 *
 * A multi-word keyword scores above a single word, so "rent equipment" beats a
 * bare "equipment" that several intents mention. Nothing is returned when no
 * keyword lands, and the caller says so rather than answering the wrong
 * question, which is the failure a help screen is least forgiven for.
 *
 * A single-word keyword has to match a whole word. Substring matching looked
 * fine until "hi" matched "this week" and every greeting turned into a weather
 * report.
 */
export const matchIntent = (message: string, role: UserRole | null): Intent | null => {
  const text = message.toLowerCase().trim();
  if (!text) return null;

  const words = text.split(/[^a-z0-9']+/).filter(Boolean);

  let best: { intent: Intent; score: number } | null = null;

  for (const intent of intentsFor(role)) {
    let score = 0;

    for (const keyword of intent.keywords) {
      if (keyword.includes(' ')) {
        if (text.includes(keyword)) score += 3;
      } else if (words.includes(keyword)) {
        score += 1;
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { intent, score };
    }
  }

  return best?.intent ?? null;
};

export const greeting = (name: string, _role: UserRole | null) =>
  [
    `Hello${name ? `, ${name.split(' ')[0]}` : ''}. I can answer questions about FarmVest and about your own projects, bookings and investments.`,
    '',
    'Pick one below, or type your question.',
  ].join('\n');

export const fallbackFor = (role: UserRole | null) =>
  [
    'I do not have an answer for that one. I can help with:',
    '',
    bullet(menuFor(role).map((intent) => intent.label)),
  ].join('\n');
