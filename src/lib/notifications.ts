/**
 * Notifications are derived from live rows rather than kept in a table of their
 * own: every item below is something that already happened in the database, so
 * the bell stays in step with the data with no extra writes to maintain. Each
 * role sees the events it can act on.
 */

import {
  alertCircleOutline,
  calendarOutline,
  cashOutline,
  cameraOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  constructOutline,
  leafOutline,
  partlySunnyOutline,
  personAddOutline,
  walletOutline,
} from 'ionicons/icons';
import { supabase } from '../supabaseClient';
import type { UserRole } from '../contexts/AuthContext';
import { firstOf, peso, shortDate } from './format';
import { projectCommission } from './revenue';

export type NotificationTone = 'green' | 'gold' | 'slate' | 'red';

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  /** ISO timestamp the event happened; the list is sorted on this. */
  at: string;
  tone: NotificationTone;
  icon: string;
  /** Page that resolves the item. */
  route: string;
};

/** Per user, so two accounts on one browser do not clear each other's badge. */
const seenKey = (userId: string) => `farmvest.notifications-seen.${userId}`;

export const getLastSeen = (userId: string): string | null => {
  try {
    return localStorage.getItem(seenKey(userId));
  } catch {
    return null;
  }
};

export const markAllSeen = (userId: string) => {
  try {
    localStorage.setItem(seenKey(userId), new Date().toISOString());
  } catch {
    // Storage can be unavailable; the badge then simply keeps its count.
  }
};

export const countUnseen = (items: AppNotification[], lastSeen: string | null) =>
  lastSeen ? items.filter((item) => item.at > lastSeen).length : items.length;

export const timeAgo = (value: string) => {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 10_080) return `${Math.round(minutes / 1440)}d ago`;
  return shortDate(value);
};

const byNewest = (a: AppNotification, b: AppNotification) => (a.at < b.at ? 1 : -1);

/** How far back the queries reach, so an old system does not flood the bell. */
const MAX_PER_SOURCE = 20;

const adminNotifications = async (): Promise<AppNotification[]> => {
  const [users, projects, rentals, payments, reports] = await Promise.all([
    supabase
      .from('users')
      .select('users_id, name, face_match_score, verification_notes, liveness_passed_at, created_at')
      .eq('verification_status', 'Flagged')
      .order('liveness_passed_at', { ascending: false, nullsFirst: false })
      .limit(MAX_PER_SOURCE),
    supabase
      .from('projects')
      .select('projects_id, title, funding_goal, created_at, customers(users(name))')
      .eq('status', 'Pending Approval')
      .order('created_at', { ascending: false })
      .limit(MAX_PER_SOURCE),
    supabase
      .from('rentals')
      .select('rentals_id, start_date, end_date, created_at, customers(users(name)), equipment(name)')
      .eq('status', 'Pending')
      .order('created_at', { ascending: false })
      .limit(MAX_PER_SOURCE),
    // Nothing confirms itself: a payment sits here until the Admin has found it
    // in the receiving account.
    supabase
      .from('payments')
      .select(
        'payments_id, amount, payment_type, reference_no, submitted_at, rentals(customers(users(name)), equipment(name)), investments(customers(users(name)), projects(title))'
      )
      .eq('status', 'Submitted')
      .order('submitted_at', { ascending: false })
      .limit(MAX_PER_SOURCE),
    supabase
      .from('reports')
      .select('reports_id, reason, created_at')
      .eq('status', 'Open')
      .order('created_at', { ascending: false })
      .limit(MAX_PER_SOURCE),
  ]);

  const items: AppNotification[] = [];

  const { data: liquidationData } = await supabase
    .from('liquidations')
    .select('liquidations_id, mortality, heads_stocked, submitted_at, projects(title, customers(users(name)))')
    .eq('status', 'Submitted')
    .order('submitted_at', { ascending: false })
    .limit(MAX_PER_SOURCE);

  for (const row of (liquidationData ?? []) as unknown as {
    liquidations_id: string;
    mortality: number;
    heads_stocked: number;
    submitted_at: string;
    projects: { title: string; customers: { users: { name: string } | null } | null } | null;
  }[]) {
    items.push({
      id: `liquidation-${row.liquidations_id}`,
      title: 'Liquidation to review',
      body: `${row.projects?.customers?.users?.name ?? 'A farm owner'} reported "${row.projects?.title ?? 'a project'}": ${row.mortality} of ${row.heads_stocked} head died. Compare it with the budget, then accept it and mark the project Completed.`,
      at: row.submitted_at,
      tone: 'gold',
      icon: leafOutline,
      route: '/admin/projects?tab=In%20Progress',
    });
  }

  const { data: repaymentData } = await supabase
    .from('repayments')
    .select('repayments_id, amount, submitted_at, projects(title, customers(users(name)))')
    .eq('status', 'Submitted')
    .order('submitted_at', { ascending: false })
    .limit(MAX_PER_SOURCE);

  for (const row of (repaymentData ?? []) as unknown as {
    repayments_id: string;
    amount: number;
    submitted_at: string;
    projects: { title: string; customers: { users: { name: string } | null } | null } | null;
  }[]) {
    items.push({
      id: `repayment-${row.repayments_id}`,
      title: 'Repayment to verify',
      body: `${row.projects?.customers?.users?.name ?? 'A farm owner'} sent ${peso(row.amount)} to repay the investors of "${row.projects?.title ?? 'a project'}". Confirm it and pay each investor out.`,
      at: row.submitted_at,
      tone: 'gold',
      icon: walletOutline,
      route: '/admin/investments',
    });
  }

  // Progress on a running project is what unlocks its next release, so each
  // new update tells the Admin which stage it is now waiting on.
  const { data: progressData } = await supabase
    .from('progress_updates')
    .select(
      'progress_updates_id, notes, captured_at, projects!inner(title, status, customers(users(name)), fund_releases(stage))'
    )
    .in('projects.status', ['Funded', 'In Progress'])
    .order('captured_at', { ascending: false })
    .limit(MAX_PER_SOURCE);

  for (const row of (progressData ?? []) as unknown as {
    progress_updates_id: string;
    notes: string | null;
    captured_at: string;
    projects: {
      title: string;
      status: string;
      customers: { users: { name: string } | null } | null;
      fund_releases: { stage: string }[];
    } | null;
  }[]) {
    const released = row.projects?.fund_releases?.map((release) => release.stage) ?? [];
    const next = released.includes('Full') || released.includes('Final') ? null : 'Full';

    items.push({
      id: `admin-progress-${row.progress_updates_id}`,
      title: 'New progress update',
      body: `${row.projects?.customers?.users?.name ?? 'A farm owner'} posted progress on "${
        row.projects?.title ?? 'a project'
      }"${row.notes ? `: ${row.notes}` : ''}.${
        next ? ' Funds not yet released.' : ' Funds are released; it is completed once the liquidation is accepted and the repayment confirmed.'
      }`,
      at: row.captured_at,
      tone: 'gold',
      icon: cameraOutline,
      // Straight to the tab the project sits on, where its Release button is.
      route: `/admin/projects?tab=${encodeURIComponent(row.projects?.status ?? 'In Progress')}`,
    });
  }

  for (const row of (users.data ?? []) as {
    users_id: string;
    name: string;
    face_match_score: number | null;
    verification_notes: string;
    liveness_passed_at: string | null;
    created_at: string;
  }[]) {
    const score =
      row.face_match_score == null ? 'not scored' : `${Math.round(row.face_match_score * 100)}%`;

    items.push({
      id: `flagged-${row.users_id}`,
      title: 'Verification needs your eyes',
      body: `${row.name || 'A customer'} matched at ${score}, which is not certain enough to pass on its own. Compare the ID and the photo.`,
      // When the face check ran, not when the account was opened. Verification
      // happens at a customer's first project, often weeks after signup, and
      // dating it by signup buried it under everything newer in the bell.
      at: row.liveness_passed_at ?? row.created_at,
      tone: 'gold',
      icon: personAddOutline,
      // Lands on the tab that holds them, which is the tab that opens by
      // default on this page.
      route: '/admin/users',
    });
  }

  for (const row of (projects.data ?? []) as unknown as {
    projects_id: string;
    title: string;
    funding_goal: number;
    created_at: string;
    customers: { users: { name: string } | null } | null;
  }[]) {
    items.push({
      id: `project-${row.projects_id}`,
      title: 'Project waiting for approval',
      body: `${row.customers?.users?.name ?? 'A farm owner'} posted "${row.title}" for ${peso(row.funding_goal)}.`,
      at: row.created_at,
      tone: 'green',
      icon: leafOutline,
      route: '/admin/projects',
    });
  }

  for (const row of (rentals.data ?? []) as unknown as {
    rentals_id: string;
    start_date: string;
    end_date: string;
    created_at: string;
    customers: { users: { name: string } | null } | null;
    equipment: { name: string } | null;
  }[]) {
    items.push({
      id: `rental-${row.rentals_id}`,
      title: 'New booking request',
      body: `${row.customers?.users?.name ?? 'A farm owner'} booked ${row.equipment?.name ?? 'a unit'} for ${shortDate(row.start_date)} to ${shortDate(row.end_date)}.`,
      at: row.created_at,
      tone: 'slate',
      icon: calendarOutline,
      route: '/admin/rentals',
    });
  }

  for (const row of (payments.data ?? []) as unknown as {
    payments_id: string;
    amount: number;
    payment_type: string;
    reference_no: string;
    submitted_at: string;
    rentals: {
      customers: { users: { name: string } | null } | null;
      equipment: { name: string } | null;
    } | null;
    investments: {
      customers: { users: { name: string } | null } | null;
      projects: { title: string } | null;
    } | null;
  }[]) {
    // A payment is for a booking or for an investment, and is reviewed on the
    // page that holds that one.
    const investment = row.investments;

    items.push({
      id: `payment-${row.payments_id}`,
      title: investment ? 'Investment payment to verify' : 'Payment to verify',
      body: investment
        ? `${investment.customers?.users?.name ?? 'An investor'} sent ${peso(row.amount)} for "${investment.projects?.title ?? 'a project'}". Reference ${row.reference_no}.`
        : `${row.rentals?.customers?.users?.name ?? 'A farm owner'} sent ${peso(row.amount)} (${row.payment_type}) for ${row.rentals?.equipment?.name ?? 'a unit'}. Reference ${row.reference_no}.`,
      at: row.submitted_at,
      tone: 'gold',
      icon: walletOutline,
      route: investment ? '/admin/investments' : '/admin/rentals',
    });
  }

  for (const row of (reports.data ?? []) as { reports_id: string; reason: string; created_at: string }[]) {
    items.push({
      id: `report-${row.reports_id}`,
      title: 'Report needs review',
      body: row.reason,
      at: row.created_at,
      tone: 'red',
      icon: alertCircleOutline,
      route: '/admin/reports',
    });
  }

  return items;
};

/**
 * What a booking status means to the farm owner, in their words.
 *
 * "Booking active" is what the database calls it; "your unit is on the way" is
 * what it means to the person waiting at the farm, and it is the one line that
 * has to reach them before the truck does.
 */
const RENTAL_NEWS: Record<
  string,
  { title: string; body: (unit: string, dates: string) => string; tone: NotificationTone; icon: string }
> = {
  Confirmed: {
    title: 'Booking confirmed',
    body: (unit, dates) => `${unit} is reserved for you, ${dates}. It will be delivered on the start date.`,
    tone: 'green',
    icon: calendarOutline,
  },
  'Out for Delivery': {
    title: 'Your unit is on the way',
    body: (unit, dates) =>
      `${unit} has left for your farm for ${dates}. Have someone there to receive it, check it over before the driver leaves, then confirm receipt in My Rentals to start the rental.`,
    tone: 'green',
    icon: constructOutline,
  },
  Active: {
    title: 'Rental started',
    body: (unit, dates) =>
      `Receipt of ${unit} is confirmed and the rental is running, ${dates}. FarmVest collects it on the return date.`,
    tone: 'green',
    icon: constructOutline,
  },
  'On Hold - Weather Advisory': {
    title: 'Booking on weather hold',
    body: (unit, dates) =>
      `${unit} for ${dates} is on hold under a severe weather advisory. No penalty applies to either side for this.`,
    tone: 'gold',
    icon: partlySunnyOutline,
  },
  Rescheduled: {
    title: 'Booking rescheduled',
    body: (unit, dates) => `${unit} has been moved to ${dates}.`,
    tone: 'gold',
    icon: calendarOutline,
  },
  'Under Inspection': {
    title: 'Unit received back',
    body: (unit) =>
      `${unit} is back with FarmVest and is being inspected. The booking closes once its condition is recorded.`,
    tone: 'slate',
    icon: constructOutline,
  },
  Completed: {
    title: 'Booking closed',
    body: (unit, dates) => `${unit} for ${dates} is closed. It is now on your Reports page.`,
    tone: 'slate',
    icon: constructOutline,
  },
  Cancelled: {
    title: 'Booking cancelled',
    body: (unit, dates) => `${unit} for ${dates} was cancelled.`,
    tone: 'red',
    icon: alertCircleOutline,
  },
};

/** Inclusive rental length, so a same-day booking still costs one day. */
const rentalDays = (start: string, end: string) =>
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;

const farmOwnerNotifications = async (userId: string): Promise<AppNotification[]> => {
  const [projects, rentals, pending, payments, investments] = await Promise.all([
    supabase
      .from('projects')
      .select(
        'projects_id, title, status, rejection_reason, reviewed_at, started_at, completed_at, expected_roi_percent, investments(amount), repayments(status, admin_notes, submitted_at, reviewed_at), fund_releases(stage, released_at), liquidations(status, admin_notes, reviewed_at)'
      )
      .eq('customers_id', userId)
      .not('reviewed_at', 'is', null)
      .order('reviewed_at', { ascending: false })
      .limit(MAX_PER_SOURCE),
    supabase
      .from('rentals')
      .select(
        'rentals_id, status, start_date, end_date, admin_notes, status_changed_at, delivery_window, driver_name, driver_contact, return_condition, damage_notes, damage_charge, equipment(name)'
      )
      .eq('customers_id', userId)
      .neq('status', 'Pending')
      .order('status_changed_at', { ascending: false })
      .limit(MAX_PER_SOURCE),
    // Pending is excluded above because a booking the Admin has not touched is
    // not news on its own. It becomes news when it is waiting on the renter,
    // which is what the payment rows below decide.
    supabase
      .from('rentals')
      .select('rentals_id, status, start_date, end_date, created_at, equipment(name, price_per_day)')
      .eq('customers_id', userId)
      .eq('status', 'Pending')
      .order('created_at', { ascending: false })
      .limit(MAX_PER_SOURCE),
    supabase
      .from('payments')
      .select('rentals_id, amount, payment_type, status, admin_notes, submitted_at, reviewed_at')
      .order('submitted_at', { ascending: false }),
    supabase
      .from('investments')
      .select('investments_id, amount, created_at, projects!inner(projects_id, title, customers_id)')
      .eq('projects.customers_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_PER_SOURCE),
  ]);

  const items: AppNotification[] = [];

  for (const row of (projects.data ?? []) as {
    projects_id: string;
    title: string;
    status: string;
    rejection_reason: string | null;
    reviewed_at: string;
    started_at: string | null;
    completed_at: string | null;
    expected_roi_percent: number;
    investments: { amount: number }[];
    repayments: { status: string; admin_notes: string; submitted_at: string; reviewed_at: string | null }[];
    fund_releases: { stage: string; released_at: string }[];
    liquidations: { status: string; admin_notes: string; reviewed_at: string | null }[];
  }[]) {
    const finalRelease = row.fund_releases?.find((release) => release.stage === 'Full' || release.stage === 'Final');
    const report = firstOf(row.liquidations);
    if (row.status === 'In Progress' && finalRelease && (!report || report.status === 'Returned')) {
      items.push({
        id: `liquidation-${row.projects_id}-${report ? 'returned' : 'due'}`,
        title: report ? 'Liquidation returned' : 'Liquidation due',
        body: report
          ? `Your liquidation for "${row.title}" was returned: ${report.admin_notes}. Correct it in My Projects.`
          : `The funds for "${row.title}" are released. Once the harvest is sold, report what was spent, with receipts, and how many head died and were sold. The project is completed after FarmVest reviews it.`,
        at: report?.reviewed_at ?? finalRelease.released_at,
        tone: report ? 'red' : 'gold',
        icon: leafOutline,
        route: '/app/projects',
      });
    }

    const rejected = row.status === 'Rejected';
    const completed = row.status === 'Completed';

    // Once its liquidation is accepted, a project owes its investors capital
    // plus the agreed return, and FarmVest its commission. Confirming that
    // repayment is what completes it.
    if (
      ['In Progress', 'Completed'].includes(row.status) &&
      report?.status === 'Accepted' &&
      (row.investments ?? []).length > 0
    ) {
      const capital = (row.investments ?? []).reduce((sum, investment) => sum + Number(investment.amount), 0);
      const due = capital * (1 + Number(row.expected_roi_percent ?? 0) / 100) + projectCommission(capital);
      const repayment = [...(row.repayments ?? [])].sort((a, b) =>
        b.submitted_at.localeCompare(a.submitted_at)
      )[0];

      if (row.status === 'In Progress' && (!repayment || repayment.status === 'Rejected')) {
        items.push({
          id: `repay-due-${row.projects_id}-${repayment ? 'again' : 'new'}`,
          title: repayment ? 'Repayment rejected, send it again' : 'Repayment due',
          body: repayment
            ? `Your repayment for "${row.title}" was rejected: ${repayment.admin_notes}. Send ${peso(due)} again from My Projects.`
            : `The liquidation of "${row.title}" was accepted. Send ${peso(due)} through FarmVest from My Projects: your investors' capital plus the agreed ${Number(row.expected_roi_percent)}% return, and FarmVest's 5% commission. The project is completed once it is confirmed.`,
          at: repayment?.reviewed_at ?? report.reviewed_at ?? row.reviewed_at,
          tone: repayment ? 'red' : 'gold',
          icon: cashOutline,
          // The Repay button sits on the project's row in My Projects.
          route: '/app/projects',
        });
      } else if (repayment.status === 'Confirmed' && repayment.reviewed_at) {
        items.push({
          id: `repay-done-${row.projects_id}`,
          title: 'Investors repaid',
          body: `FarmVest confirmed your repayment for "${row.title}" and paid each investor their share.`,
          at: repayment.reviewed_at,
          tone: 'green',
          icon: cashOutline,
          route: '/app/reports',
        });
      }
    }

    items.push({
      id: `project-${row.projects_id}-${row.status}`,
      title: rejected ? 'Project rejected' : completed ? 'Project completed' : `Project ${row.status.toLowerCase()}`,
      body: rejected
        ? `"${row.title}" was rejected. ${row.rejection_reason ?? ''}`.trim()
        : completed
          ? `"${row.title}" is completed. It now counts toward your track record and raises the funding ceiling for your next project. It is on your Reports page.`
          : `"${row.title}" is now ${row.status}.`,
      // When the status was reached, not when the project was approved:
      // dated by approval, a completion landed weeks down the bell.
      at: (completed ? row.completed_at : row.status === 'In Progress' ? row.started_at : null) ?? row.reviewed_at,
      tone: rejected ? 'red' : 'green',
      icon: leafOutline,
      // An ended project is on Reports; one still in hand is on My Projects.
      route: ['Completed', 'Rejected', 'Cancelled', 'Under Investigation'].includes(row.status)
        ? '/app/reports'
        : '/app/projects',
    });
  }

  // Money reaching the farm, one line per release.
  const { data: releaseData } = await supabase
    .from('fund_releases')
    .select('fund_releases_id, stage, net_amount, commission, reference_no, released_at, projects!inner(title, customers_id)')
    .eq('projects.customers_id', userId)
    .order('released_at', { ascending: false })
    .limit(MAX_PER_SOURCE);

  for (const row of (releaseData ?? []) as unknown as {
    fund_releases_id: string;
    stage: string;
    net_amount: number;
    commission: number;
    reference_no: string;
    released_at: string;
    projects: { title: string } | null;
  }[]) {
    items.push({
      id: `release-${row.fund_releases_id}`,
      title: row.stage === 'Full' ? 'Funds released' : `${row.stage} funds released`,
      body: `${peso(row.net_amount)} for "${row.projects?.title ?? 'your project'}" was sent to you in full. FarmVest's 5% commission is paid with your repayment, after the harvest. Reference ${row.reference_no}.`,
      at: row.released_at,
      tone: 'green',
      icon: cashOutline,
      route: '/app/projects',
    });
  }

  for (const row of (rentals.data ?? []) as unknown as {
    rentals_id: string;
    status: string;
    start_date: string;
    end_date: string;
    admin_notes: string | null;
    status_changed_at: string;
    delivery_window: string | null;
    driver_name: string | null;
    driver_contact: string | null;
    return_condition: string | null;
    damage_notes: string | null;
    damage_charge: number | null;
    equipment: { name: string } | null;
  }[]) {
    const unit = row.equipment?.name ?? 'Your unit';
    const dates = `${shortDate(row.start_date)} to ${shortDate(row.end_date)}`;

    // A closed booking with damage is a bill, not a receipt, so it gets its own
    // wording and lands on Reports, where the charge is shown.
    const damaged =
      row.status === 'Completed' &&
      !!row.return_condition &&
      row.return_condition !== 'Good' &&
      row.return_condition !== 'None';

    if (damaged) {
      const notes = row.damage_notes && row.damage_notes !== 'None' ? ` ${row.damage_notes}.` : '';
      const charge = Number(row.damage_charge ?? 0);

      items.push({
        id: `rental-${row.rentals_id}-damage`,
        title: `${row.return_condition} found on return`,
        body: `${unit} for ${dates} came back with ${row.return_condition!.toLowerCase()}.${notes}${
          charge > 0 ? ` A repair charge of ${peso(charge)} is added to this booking.` : ''
        }`,
        at: row.status_changed_at,
        tone: 'red',
        icon: alertCircleOutline,
        route: '/app/reports',
      });
      continue;
    }

    const news = RENTAL_NEWS[row.status];

    // There is no tracking, so this is the answer to "where is it": when it is
    // expected, and the number to call.
    const delivery =
      row.status === 'Out for Delivery'
        ? [
            row.delivery_window && row.delivery_window !== 'None'
              ? `Arriving ${row.delivery_window}.`
              : null,
            row.driver_contact && row.driver_contact !== 'None'
              ? `Driver ${row.driver_name && row.driver_name !== 'None' ? row.driver_name : 'contact'}: ${row.driver_contact}.`
              : null,
          ]
            .filter(Boolean)
            .join(' ')
        : '';

    // A note from the Admin is why this happened, so it wins over the general
    // wording; the general wording is what fills the gap when there is none.
    const note = row.admin_notes && row.admin_notes !== 'None' ? row.admin_notes : null;

    items.push({
      id: `rental-${row.rentals_id}-${row.status}`,
      title: news?.title ?? `Booking ${row.status.toLowerCase()}`,
      body: news
        ? [news.body(unit, dates), delivery, note].filter(Boolean).join(' ')
        : (note ?? `${unit} for ${dates}.`),
      // When the status changed, not when the booking was made. The farm owner
      // has already seen the booking date, so dating a change with it left the
      // badge silent.
      at: row.status_changed_at,
      tone: news?.tone ?? 'slate',
      icon: news?.icon ?? constructOutline,
      // A closed booking lives on Reports, which is where its message points.
      route: row.status === 'Completed' ? '/app/reports' : '/app/rentals',
    });
  }

  // The latest payment per booking. A rejected one is replaced by the next
  // attempt, so only the most recent decides what the renter is told.
  const latestPayment = new Map<
    string,
    {
      rentals_id: string;
      amount: number;
      payment_type: string;
      status: string;
      admin_notes: string | null;
      submitted_at: string;
      reviewed_at: string | null;
    }
  >();

  for (const row of (payments.data ?? []) as unknown as {
    rentals_id: string;
    amount: number;
    payment_type: string;
    status: string;
    admin_notes: string | null;
    submitted_at: string;
    reviewed_at: string | null;
  }[]) {
    if (!latestPayment.has(row.rentals_id)) latestPayment.set(row.rentals_id, row);
  }

  for (const row of (pending.data ?? []) as unknown as {
    rentals_id: string;
    status: string;
    start_date: string;
    end_date: string;
    created_at: string;
    equipment: { name: string; price_per_day: number } | null;
  }[]) {
    const payment = latestPayment.get(row.rentals_id);
    const unit = row.equipment?.name ?? 'Your unit';
    const dates = `${shortDate(row.start_date)} to ${shortDate(row.end_date)}`;
    const fee = rentalDays(row.start_date, row.end_date) * Number(row.equipment?.price_per_day ?? 0);

    if (!payment) {
      items.push({
        id: `payment-due-${row.rentals_id}`,
        title: 'Booking needs payment',
        body: `${unit} for ${dates} is held for you. Pay ${peso(fee)} in full, or ${peso(Math.round(fee / 2))} as a downpayment, to have it confirmed.`,
        at: row.created_at,
        tone: 'gold',
        icon: walletOutline,
        route: '/app/rentals',
      });
      continue;
    }

    if (payment.status === 'Rejected') {
      items.push({
        id: `payment-rejected-${row.rentals_id}`,
        title: 'Payment was not accepted',
        body: `${payment.admin_notes && payment.admin_notes !== 'None' ? payment.admin_notes : 'The administrator could not match your payment.'} Submit another for ${unit}.`,
        at: payment.reviewed_at ?? payment.submitted_at,
        tone: 'red',
        icon: walletOutline,
        route: '/app/rentals',
      });
      continue;
    }

    if (payment.status === 'Submitted') {
      items.push({
        id: `payment-review-${row.rentals_id}`,
        title: 'Payment under review',
        body: `${peso(payment.amount)} for ${unit} is with the administrator. The booking is confirmed once it is matched to the account.`,
        at: payment.submitted_at,
        tone: 'slate',
        icon: walletOutline,
        route: '/app/rentals',
      });
      continue;
    }

    items.push({
      id: `payment-confirmed-${row.rentals_id}`,
      title: 'Payment confirmed',
      body: `${peso(payment.amount)} for ${unit} has been received. The administrator is confirming the booking.`,
      at: payment.reviewed_at ?? payment.submitted_at,
      tone: 'green',
      icon: walletOutline,
      route: '/app/rentals',
    });
  }

  for (const row of (investments.data ?? []) as unknown as {
    investments_id: string;
    amount: number;
    created_at: string;
    projects: { projects_id: string; title: string } | null;
  }[]) {
    items.push({
      id: `investment-${row.investments_id}`,
      title: 'Investment received',
      body: `${peso(row.amount)} was invested in "${row.projects?.title ?? 'your project'}".`,
      at: row.created_at,
      tone: 'green',
      icon: cashOutline,
      route: '/app/projects',
    });
  }

  return items;
};

const investorNotifications = async (userId: string): Promise<AppNotification[]> => {
  const { data: investmentData } = await supabase
    .from('investments')
    .select(
      'investments_id, amount, created_at, investor_payouts(principal, return_amount, total, reference_no, paid_at), projects(projects_id, title, status, completed_at), payments(status, admin_notes, submitted_at, reviewed_at, refunded_at, refund_reference)'
    )
    .eq('customers_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_PER_SOURCE);

  const investments = (investmentData ?? []) as unknown as {
    investments_id: string;
    amount: number;
    created_at: string;
    projects: { projects_id: string; title: string; status: string; completed_at: string | null } | null;
    investor_payouts: { principal: number; return_amount: number; total: number; reference_no: string; paid_at: string }[];
    payments: {
      status: string;
      admin_notes: string;
      submitted_at: string;
      reviewed_at: string | null;
      refunded_at: string | null;
      refund_reference: string;
    }[];
  }[];

  const items: AppNotification[] = [];
  const titleByProject = new Map<string, string>();

  for (const row of investments) {
    if (row.projects) titleByProject.set(row.projects.projects_id, row.projects.title);

    // An investment counts once it is paid, so an unpaid or refused one is the
    // investor's next job. The link opens the payment form for this investment.
    const payment = [...(row.payments ?? [])].sort((a, b) =>
      b.submitted_at.localeCompare(a.submitted_at)
    )[0];
    const project = row.projects?.title ?? 'a project';

    const payout = firstOf(row.investor_payouts);
    if (payout) {
      items.push({
        id: `investment-return-${row.investments_id}`,
        title: 'Return received',
        body: `${peso(payout.total)} from "${project}" was sent to you: ${peso(payout.principal)} capital + ${peso(payout.return_amount)} return. Reference ${payout.reference_no}.`,
        at: payout.paid_at,
        tone: 'green',
        icon: cashOutline,
        route: '/app/reports',
      });
    }

    if (payment?.status === 'Refunded') {
      items.push({
        id: `investment-refund-${row.investments_id}`,
        title: 'Project cancelled, payment refunded',
        body: `"${project}" did not reach its goal and was cancelled${
          payment.admin_notes && payment.admin_notes !== 'None' ? ` (${payment.admin_notes})` : ''
        }. Your ${peso(row.amount)} was returned. Refund reference ${payment.refund_reference}.`,
        at: payment.refunded_at ?? row.created_at,
        tone: 'gold',
        icon: cashOutline,
        route: '/app/reports',
      });
      continue;
    }

    // Cancelled before it was ever paid: nothing to refund, nothing to pay.
    if (row.projects?.status === 'Cancelled') continue;

    if (!payment || payment.status === 'Rejected') {
      items.push({
        id: `investment-pay-${row.investments_id}-${payment ? 'again' : 'new'}`,
        title: payment ? 'Payment rejected, send it again' : 'Payment needed',
        body: payment
          ? `Your ${peso(row.amount)} payment for "${project}" was rejected${
              payment.admin_notes && payment.admin_notes !== 'None' ? `: ${payment.admin_notes}` : ''
            }. Send it again to keep your place.`
          : `You committed ${peso(row.amount)} to "${project}". Pay it to FarmVest's official account to confirm the investment.`,
        at: payment?.reviewed_at ?? row.created_at,
        tone: payment ? 'red' : 'gold',
        icon: cashOutline,
        route: `/app/investments?pay=${row.investments_id}`,
      });
    } else if (payment.status === 'Confirmed' && payment.reviewed_at) {
      items.push({
        id: `investment-paid-${row.investments_id}`,
        title: 'Payment confirmed',
        body: `FarmVest received your ${peso(row.amount)} for "${project}". The investment is confirmed.`,
        at: payment.reviewed_at,
        tone: 'green',
        icon: cashOutline,
        route: '/app/investments',
      });
    }

    items.push({
      id: `investment-${row.investments_id}`,
      title: `Project ${row.projects?.status?.toLowerCase() ?? 'update'}`,
      body:
        row.projects?.status === 'Completed'
          ? `"${row.projects.title}" is completed. Your ${peso(row.amount)} is now on your Reports page.`
          : `Your ${peso(row.amount)} in "${row.projects?.title ?? 'a project'}" is ${row.projects?.status ?? 'recorded'}.`,
      at: (row.projects?.status === 'Completed' ? row.projects.completed_at : null) ?? row.created_at,
      tone: row.projects?.status === 'Completed' ? 'green' : 'slate',
      icon: cashOutline,
      route: row.projects?.status === 'Completed' ? '/app/reports' : '/app/investments',
    });
  }

  // The liquidation closes the cycle: the investor is told when it is filed,
  // with its receipts, and again when FarmVest accepts it.
  if (titleByProject.size > 0) {
    const { data: liquidationData } = await supabase
      .from('liquidations')
      .select('projects_id, status, submitted_at, reviewed_at, heads_harvested, sales_amount')
      .in('projects_id', Array.from(titleByProject.keys()));

    for (const row of (liquidationData ?? []) as {
      projects_id: string;
      status: string;
      submitted_at: string;
      reviewed_at: string | null;
      heads_harvested: number;
      sales_amount: number;
    }[]) {
      const title = titleByProject.get(row.projects_id) ?? 'A funded project';
      const accepted = row.status === 'Accepted';
      if (!accepted && row.status !== 'Submitted') continue;
      items.push({
        id: `investor-liquidation-${row.projects_id}-${row.status}`,
        title: accepted ? 'Liquidation accepted' : 'Liquidation report filed',
        body: accepted
          ? `FarmVest checked and accepted the liquidation of "${title}". The farm owner repays you next.`
          : `The farm owner of "${title}" reported ${row.heads_harvested} head sold for ${peso(row.sales_amount)}. See the figures and the receipts.`,
        at: (accepted ? row.reviewed_at : null) ?? row.submitted_at,
        tone: accepted ? 'green' : 'gold',
        icon: leafOutline,
        route: `/app/monitoring?project=${row.projects_id}`,
      });
    }
  }

  // Progress photos are the point of monitoring, so they are worth a line each.
  if (titleByProject.size > 0) {
    const { data: updateData } = await supabase
      .from('progress_updates')
      .select('progress_updates_id, projects_id, notes, captured_at')
      .in('projects_id', Array.from(titleByProject.keys()))
      .order('captured_at', { ascending: false })
      .limit(MAX_PER_SOURCE);

    for (const row of (updateData ?? []) as {
      progress_updates_id: string;
      projects_id: string;
      notes: string | null;
      captured_at: string;
    }[]) {
      items.push({
        id: `update-${row.progress_updates_id}`,
        title: 'New progress update',
        body: `${titleByProject.get(row.projects_id) ?? 'A funded project'}: ${row.notes || 'a new photo was posted'}.`,
        at: row.captured_at,
        tone: 'gold',
        icon: cameraOutline,
        // Straight to the photos, already narrowed to the project they are for.
        route: `/app/monitoring?project=${row.projects_id}`,
      });
    }
  }

  return items;
};

/**
 * The outcome of the customer's identity check. An automatic pass is decided
 * while they watch, but a flagged check waits on an Admin, so that decision is
 * news the customer would otherwise only find by trying to post a project.
 */
const verificationNotifications = async (userId: string): Promise<AppNotification[]> => {
  const [{ data }, payout] = await Promise.all([
    supabase
      .from('users')
      .select('verification_status, verified_at, verification_notes')
      .eq('users_id', userId)
      .maybeSingle(),
    supabase.from('payout_accounts').select('payout_accounts_id').eq('customers_id', userId).limit(1),
  ]);

  if (!data?.verified_at) return [];
  const byAdmin = /administrator/i.test(data.verification_notes ?? '');

  // Nothing can be sent to a customer without somewhere to send it, so a
  // verified account without one is asked for it until it is set.
  const payoutMissing: AppNotification[] =
    data.verification_status === 'Approved' && (payout.data ?? []).length === 0
      ? [
          {
            id: 'payout-account-missing',
            title: 'Add your payout account',
            body: 'Set the GCash, Maya or bank account FarmVest sends your money to: released project funds and investment returns. Open Account Profile, under Payout Accounts.',
            at: data.verified_at,
            tone: 'gold',
            icon: walletOutline,
            route: '/account',
          },
        ]
      : [];

  if (data.verification_status === 'Approved') {
    return [
      ...payoutMissing,
      {
        id: `verification-approved-${data.verified_at}`,
        title: 'Account verified',
        body: byAdmin
          ? 'An administrator reviewed your ID and live photo and approved your account. You can now post projects and invest.'
          : 'Your ID and live photo matched. Your account is verified, and you can now post projects and invest.',
        at: data.verified_at,
        tone: 'green',
        icon: checkmarkCircleOutline,
        route: '/app',
      },
    ];
  }

  if (data.verification_status === 'Rejected') {
    return [
      {
        id: `verification-rejected-${data.verified_at}`,
        title: 'Verification not approved',
        body: 'An administrator could not match your ID with your live photo. Open My Projects to verify again with a clear photo of a valid ID.',
        at: data.verified_at,
        tone: 'red',
        icon: closeCircleOutline,
        route: '/app/projects',
      },
    ];
  }

  return [];
};

/** Everything the signed-in user should know about, newest first. */
export const loadNotifications = async (
  role: UserRole,
  userId: string
): Promise<AppNotification[]> => {
  // A customer gets both feeds. The two builders read different tables and
  // neither knows about the other, so they run together and the results are
  // merged into one stream ordered by when things actually happened.
  if (role === 'Admin') {
    return (await adminNotifications()).sort(byNewest);
  }

  const [farming, investing, verification] = await Promise.all([
    farmOwnerNotifications(userId),
    investorNotifications(userId),
    verificationNotifications(userId),
  ]);

  return [...farming, ...investing, ...verification].sort(byNewest);
};
