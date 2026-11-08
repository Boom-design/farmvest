/**
 * AI #1 — Investment Recommendation.
 *
 * A content-based recommender. Each open project is scored against the
 * investor's stated budget and against the farm owner's own
 * record, then ranked. It is explainable by construction: every point added or
 * taken away carries the sentence that explains it, so the screen can say why a
 * project is near the top rather than asking to be trusted.
 *
 * That matters more here than raw accuracy. An investor is being asked to part
 * with money, and a ranking that cannot say why is a ranking nobody should act
 * on. It is also what keeps the recommendation honest: the reasons are drawn
 * from rows in the database, so a claim on screen can always be checked against
 * the record behind it.
 *
 * The weights below are a starting point, chosen so no single signal can carry
 * a project on its own and so an open dispute can sink one whatever else it has
 * going for it.
 */

/**
 * Where the weather stands at one farm, as AI #2 reports it.
 *
 * Undefined when the forecast could not be fetched for that location, which is
 * treated as no signal rather than as a bad one: an unreachable API is not
 * evidence about a farm.
 */
export type FarmOutlook = {
  /** PAGASA wind signal expected in the forecast window, 0 for none. */
  level: number;
  /** Days until the worst day. */
  leadTimeDays: number;
  /** The place the forecast was matched to, for the sentence. */
  place: string;
};

/**
 * How each livestock category fares by season, and why.
 *
 * Philippine seasons are taken as dry from November to April and wet from May
 * to October, the same split the crop calendar in lib/weather uses. The notes
 * are general husbandry guidance rather than a forecast: housing that is light
 * enough to lose a roof, stock that suffers in heat, pasture that depends on
 * rain, ponds that overflow. They shift a score, they do not decide it.
 */
const SEASONAL: Record<string, { dry: number; wet: number; dryNote: string; wetNote: string }> = {
  Poultry: {
    dry: 4,
    wet: -6,
    dryNote: 'Poultry does well in the dry season: drier litter and less disease pressure.',
    wetNote: 'Poultry housing is light, so the wet season carries storm and disease risk.',
  },
  Swine: {
    dry: -3,
    wet: 2,
    dryNote: 'Swine suffer heat stress in the hottest dry months, which slows growth.',
    wetNote: 'Swine housing is solid enough that the wet season is the easier half.',
  },
  Cattle: {
    dry: -4,
    wet: 5,
    dryNote: 'Dry months mean bought feed and hauled water, so costs rise.',
    wetNote: 'Rain keeps pasture growing, which is when cattle cost least to keep.',
  },
  Goat: {
    dry: 5,
    wet: -5,
    dryNote: 'Goats are at their healthiest in dry months, with fewer parasites and less foot rot.',
    wetNote: 'Wet ground raises parasite and foot rot risk in goats.',
  },
  Fish: {
    dry: 3,
    wet: -6,
    dryNote: 'Pond levels are manageable in the dry season, with lower escape risk.',
    wetNote: 'Heavy rain overflows ponds, and a flooded pond loses its stock.',
  },
  Other: { dry: 0, wet: 0, dryNote: '', wetNote: '' },
};

/** Philippine dry season runs November to April; the rest is the wet season. */
const isDrySeason = (month: number) => month >= 10 || month <= 3;

/** Most a season can move a score, either way. */
const SEASON_CAP = 6;

/** An expected wind signal at the farm, per level. */
const WEATHER_PENALTY = [0, 4, 10, 18, 25, 30];

export type InvestorPreferences = {
  /** Null when the investor has not set one. Nothing is scored until it is set. */
  budget: number | null;
};

export type ProjectSignals = {
  projectsId: string;
  farmOwnersId: string;
  category: string;
  fundingGoal: number;
  currentFunding: number;
};

/** One row of public.customer_track_record. */
export type TrackRecord = {
  completed_projects: number;
  total_projects: number;
  last_update_at: string | null;
  progress_update_count: number;
  average_rating: number | null;
  rating_count: number;
  open_disputes: number;
};

export type Reason = {
  tone: 'good' | 'warn' | 'info';
  text: string;
};

export type Recommendation = {
  projectsId: string;
  /** 0 to 100, after the dispute penalty. */
  score: number;
  reasons: Reason[];
};

/**
 * What each signal can contribute at most. They total 100.
 *
 * Risk match used to hold 25 of these. It was removed with the risk level
 * itself, and its points went to the signals that survive on evidence rather
 * than on a label: what the farm has finished, and whether the investor can
 * actually take part.
 */
const WEIGHTS = {
  budget: 40,
  record: 28,
  activity: 20,
  momentum: 12,
};

/** An open case outweighs any single strength, which is the point of it. */
const DISPUTE_PENALTY = 20;
const DISPUTE_PENALTY_CAP = 40;

const daysSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

const money = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value);

/**
 * How much of what the project still needs this investor could cover.
 *
 * Not a pass or fail. A budget that covers the whole remainder is the strongest
 * fit, but a smaller one still buys a share, so the score falls off gradually
 * instead of cutting off.
 */
const scoreBudget = (
  preferences: InvestorPreferences,
  project: ProjectSignals,
  reasons: Reason[]
) => {
  const remaining = Math.max(0, Number(project.fundingGoal) - Number(project.currentFunding));

  if (preferences.budget === null) {
    reasons.push({
      tone: 'info',
      text: 'Set an investment budget on My Account for a closer match.',
    });
    // Neutral rather than zero: an unset budget is missing information, not a
    // reason to push a project down.
    return WEIGHTS.budget * 0.5;
  }

  if (remaining <= 0) {
    reasons.push({ tone: 'info', text: 'Already fully funded.' });
    return 0;
  }

  const coverage = preferences.budget / remaining;

  if (coverage >= 1) {
    reasons.push({
      tone: 'good',
      text: `Your ${money(preferences.budget)} budget covers the whole ${money(remaining)} still needed.`,
    });
    return WEIGHTS.budget;
  }

  if (coverage >= 0.25) {
    reasons.push({
      tone: 'good',
      text: `Your budget covers ${Math.round(coverage * 100)}% of the ${money(remaining)} still needed.`,
    });
    return WEIGHTS.budget * 0.75;
  }

  if (coverage >= 0.05) {
    reasons.push({
      tone: 'info',
      text: `A ${Math.round(coverage * 100)}% share of what this project still needs.`,
    });
    return WEIGHTS.budget * 0.45;
  }

  reasons.push({
    tone: 'warn',
    text: `This project needs ${money(remaining)}, well beyond your budget.`,
  });
  return WEIGHTS.budget * 0.15;
};

/** What the farm has finished before, and how it was rated for it. */
const scoreRecord = (record: TrackRecord | undefined, reasons: Reason[]) => {
  if (!record) return WEIGHTS.record * 0.4;

  let score = 0;

  if (record.completed_projects >= 3) {
    score += 15;
    reasons.push({
      tone: 'good',
      text: `This farm has completed ${record.completed_projects} projects.`,
    });
  } else if (record.completed_projects === 2) {
    score += 12;
    reasons.push({ tone: 'good', text: 'This farm has completed two projects.' });
  } else if (record.completed_projects === 1) {
    score += 8;
    reasons.push({ tone: 'good', text: 'This farm has completed one project.' });
  } else {
    reasons.push({
      tone: 'info',
      text: 'First project from this farm, with no completed record yet.',
    });
  }

  if (record.rating_count === 0) {
    // No rating is neither good nor bad; a new farm has to start somewhere.
    score += 2;
  } else if (record.average_rating !== null && record.average_rating >= 4.5) {
    score += 5;
    reasons.push({
      tone: 'good',
      text: `Rated ${record.average_rating} out of 5 across ${record.rating_count} reviews.`,
    });
  } else if (record.average_rating !== null && record.average_rating >= 3.5) {
    score += 3;
    reasons.push({
      tone: 'info',
      text: `Rated ${record.average_rating} out of 5 across ${record.rating_count} reviews.`,
    });
  } else if (record.average_rating !== null) {
    reasons.push({
      tone: 'warn',
      text: `Rated only ${record.average_rating} out of 5 across ${record.rating_count} reviews.`,
    });
  }

  return Math.min(WEIGHTS.record, score);
};

/**
 * How recently the farm posted proof of work.
 *
 * Between milestones this is the only thing an investor can actually see, and a
 * farm that stops posting is the first sign of the case the Admin ends up
 * deciding, so silence is scored as the warning it is.
 */
const scoreActivity = (record: TrackRecord | undefined, reasons: Reason[]) => {
  if (!record || !record.last_update_at) {
    reasons.push({ tone: 'warn', text: 'No progress update has ever been posted by this farm.' });
    return 0;
  }

  const age = daysSince(record.last_update_at);

  if (age <= 7) {
    reasons.push({ tone: 'good', text: 'Posted a progress update within the last week.' });
    return WEIGHTS.activity;
  }

  if (age <= 14) {
    reasons.push({ tone: 'good', text: 'Posted a progress update in the last two weeks.' });
    return WEIGHTS.activity * 0.75;
  }

  if (age <= 30) {
    reasons.push({
      tone: 'info',
      text: `Last progress update was ${Math.round(age)} days ago.`,
    });
    return WEIGHTS.activity * 0.4;
  }

  reasons.push({
    tone: 'warn',
    text: `No progress update in ${Math.round(age)} days.`,
  });
  return 0;
};

/**
 * How other investors have already voted with their money.
 *
 * Credit peaks in the middle of the range. A project nobody has backed yet has
 * nothing behind it; one at the very top has almost no room left to join.
 */
const scoreMomentum = (project: ProjectSignals, reasons: Reason[]) => {
  const goal = Number(project.fundingGoal);
  if (!goal) return 0;

  const percent = (Number(project.currentFunding) / goal) * 100;

  if (percent >= 40 && percent <= 90) {
    reasons.push({
      tone: 'good',
      text: `${Math.round(percent)}% funded already, so other investors have backed it.`,
    });
    return WEIGHTS.momentum;
  }

  if (percent > 90) {
    reasons.push({ tone: 'info', text: `${Math.round(percent)}% funded, with little room left.` });
    return WEIGHTS.momentum * 0.4;
  }

  if (percent > 0) {
    reasons.push({ tone: 'info', text: `${Math.round(percent)}% funded so far.` });
    return WEIGHTS.momentum * 0.5;
  }

  reasons.push({ tone: 'info', text: 'No investor has backed this project yet.' });
  return 0;
};

/**
 * Whether the season suits what this project raises.
 *
 * The weakest of the signals on purpose, and capped: a good farm with a good
 * record is still a good farm in the wrong month, and a project that runs for
 * six months will see both seasons anyway. It is worth saying, not worth
 * deciding on.
 */
const scoreSeason = (category: string, reasons: Reason[]) => {
  const entry = SEASONAL[category] ?? SEASONAL.Other;
  const dry = isDrySeason(new Date().getMonth());
  const shift = dry ? entry.dry : entry.wet;
  const note = dry ? entry.dryNote : entry.wetNote;

  if (shift === 0 || !note) return 0;

  reasons.push({ tone: shift > 0 ? 'good' : 'warn', text: note });
  return Math.max(-SEASON_CAP, Math.min(SEASON_CAP, shift));
};

/**
 * What the forecast says at the farm itself.
 *
 * This is AI #2 read from the investor's side. The farm owner is told to secure
 * the roof; the investor is told the money is going somewhere a storm is due,
 * which is the same fact answering a different question.
 */
const scoreWeather = (outlook: FarmOutlook | undefined, reasons: Reason[]) => {
  if (!outlook || outlook.level === 0) return 0;

  const penalty = WEATHER_PENALTY[Math.min(outlook.level, WEATHER_PENALTY.length - 1)];

  reasons.push({
    tone: outlook.level >= 2 ? 'warn' : 'info',
    text: `Signal No. ${outlook.level} conditions are expected at ${outlook.place} in ${outlook.leadTimeDays} day${outlook.leadTimeDays === 1 ? '' : 's'}.`,
  });

  return penalty;
};

const scoreDisputes = (record: TrackRecord | undefined, reasons: Reason[]) => {
  if (!record || record.open_disputes === 0) return 0;

  const penalty = Math.min(DISPUTE_PENALTY_CAP, record.open_disputes * DISPUTE_PENALTY);

  reasons.push({
    tone: 'warn',
    text: `${record.open_disputes} open case${record.open_disputes === 1 ? '' : 's'} against this farm owner.`,
  });

  return penalty;
};

/** Order the reasons the way they should be read: warnings first, then wins. */
const ORDER: Record<Reason['tone'], number> = { warn: 0, good: 1, info: 2 };

export const scoreProject = (
  preferences: InvestorPreferences,
  project: ProjectSignals,
  record: TrackRecord | undefined,
  outlook?: FarmOutlook
): Recommendation => {
  const reasons: Reason[] = [];

  // The four weighted signals total 100. Season, weather and disputes are
  // adjustments on top, so a storm or an open case can pull a strong project
  // down without any of them being able to carry a weak one up.
  const total =
    scoreBudget(preferences, project, reasons) +
    scoreRecord(record, reasons) +
    scoreActivity(record, reasons) +
    scoreMomentum(project, reasons) +
    scoreSeason(project.category, reasons) -
    scoreWeather(outlook, reasons) -
    scoreDisputes(record, reasons);

  reasons.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);

  return {
    projectsId: project.projectsId,
    score: Math.max(0, Math.min(100, Math.round(total))),
    reasons,
  };
};

export const recommend = (
  preferences: InvestorPreferences,
  projects: ProjectSignals[],
  records: Map<string, TrackRecord>,
  /** Keyed by customers_id, empty while the forecasts are still loading. */
  outlooks: Map<string, FarmOutlook> = new Map()
): Recommendation[] =>
  projects
    .map((project) =>
      scoreProject(
        preferences,
        project,
        records.get(project.farmOwnersId),
        outlooks.get(project.farmOwnersId)
      )
    )
    .sort((a, b) => b.score - a.score);

/** The band a score falls in, which is what the badge says. */
export const matchLabel = (score: number) => {
  if (score >= 75) return 'Strong match';
  if (score >= 55) return 'Good match';
  if (score >= 35) return 'Fair match';
  return 'Weak match';
};

export const matchTone = (score: number) => {
  if (score >= 75) return 'strong';
  if (score >= 55) return 'good';
  if (score >= 35) return 'fair';
  return 'weak';
};
