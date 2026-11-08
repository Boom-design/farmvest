import { useCallback, useEffect, useMemo, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import PaymentForm from '../../components/PaymentForm';
import Portal from '../../components/Portal';
import EmptyState from '../../components/EmptyState';
import Pager, { usePaged } from '../../components/Pager';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { firstOf, orNone, peso, pillClass, shortDate } from '../../lib/format';
import { COMMISSION_RATE, projectCommission } from '../../lib/revenue';
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

type ProjectRow = {
  projects_id: string;
  title: string;
  rejection_reason: string | null;
  category: string | null;
  funding_goal: number;
  current_funding: number;
  status: string;
  created_at: string;
  expected_roi_percent: number;
  investments: { amount: number }[];
  repayments: { status: string; admin_notes: string; submitted_at: string }[];
  liquidations: { status: string; sales_amount: number; expenses: { item: string; amount: number }[] }[];
  fund_releases: {
    stage: string;
    gross_amount: number;
    commission: number;
    net_amount: number;
    reference_no: string;
    released_at: string;
  }[];
};

/** The three releases in order, so every project lists them the same way. */

type RentalRow = {
  rentals_id: string;
  start_date: string;
  end_date: string;
  status: string;
  returned_at: string | null;
  return_condition: string;
  damage_charge: number;
  equipment: {
    name: string;
    unit_code: string | null;
    type: string | null;
    price_per_day: number;
  } | null;
};

type InvestmentRow = {
  investments_id: string;
  amount: number;
  investor_payouts: {
    principal: number;
    return_amount: number;
    total: number;
    reference_no: string;
    paid_at: string;
  }[];
  payments: { status: string; refund_reference: string; refunded_at: string | null }[];
  milestone_stage: string;
  created_at: string;
  projects: {
    title: string;
    category: string | null;
    status: string;
    funding_goal: number;
    current_funding: number;
  } | null;
  contracts: {
    signatory_name: string;
    signed_at: string;
    terms_version: string;
    agreed_amount: number;
  }[];
};

/**
 * Five tabs, in the order the two halves of the account appear in the sidebar:
 * what was farmed, then what was invested.
 */
/**
 * The project statuses that end a project's life on My Projects and bring it
 * here. Rejected never opened; Cancelled opened and was refunded; Under
 * Investigation is frozen while a case is decided.
 */
const ENDED_STATUSES = ['Completed', 'Rejected', 'Cancelled', 'Under Investigation'] as const;

const TABS = [
  'My Projects',
  'My Rentals',
  'Completed Investments',
  'Cancelled Projects',
  'Signed Agreements',
] as const;

type Tab = (typeof TABS)[number];

const SUBTITLE: Record<Tab, string> = {
  'My Projects':
    'Projects you posted that have ended: completed, rejected, cancelled or under investigation.',
  'My Rentals': 'Bookings that were returned and closed, and what each one cost.',
  'Completed Investments': 'Projects you funded that reached Completed, and what you put into each.',
  'Cancelled Projects':
    'Projects you funded that were cancelled before they finished, and what you had in each.',
  'Signed Agreements': 'Every investment agreement you signed, and the terms version behind it.',
};

/** Inclusive rental length, so a same-day booking still costs one day. */
const dayCount = (start: string, end: string) =>
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;

/**
 * The customer's record.
 *
 * The working screens -- My Projects, My Rentals, My Investments -- carry the
 * statuses that still need something done about them, and every row there has a
 * button. A completed project, a closed booking and a finished investment have
 * none, so they live here instead, read-only, with the totals that only mean
 * something once the work is over.
 *
 * One page rather than two, because one account now does both. The tabs keep
 * the halves apart without making the reader sign in twice to see them.
 */
const CustomerReports: React.FC = () => {
  const { profile } = useAuth();

  const [tab, setTab] = useState<Tab>('My Projects');
  /** Which ended projects the My Projects tab is showing. */
  const [projectStatus, setProjectStatus] = useState<(typeof ENDED_STATUSES)[number]>('Completed');
  /** The completed project being repaid, while its payment form is open. */
  const [repaying, setRepaying] = useState<ProjectRow | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    // Three independent reads, so they go together rather than in sequence.
    const [projectsRes, rentalsRes, investmentsRes] = await Promise.all([
      supabase
        .from('projects')
        .select(
          'projects_id, title, rejection_reason, category, funding_goal, current_funding, status, created_at, expected_roi_percent, investments(amount), repayments(status, admin_notes, submitted_at), liquidations(status, sales_amount, expenses), fund_releases(stage, gross_amount, commission, net_amount, reference_no, released_at)'
        )
        .eq('customers_id', profile.users_id)
        .in('status', [...ENDED_STATUSES])
        .order('created_at', { ascending: false }),
      supabase
        .from('rentals')
        .select(
          'rentals_id, start_date, end_date, status, returned_at, return_condition, damage_charge, equipment(name, unit_code, type, price_per_day)'
        )
        .eq('customers_id', profile.users_id)
        .eq('status', 'Completed')
        .order('end_date', { ascending: false }),
      supabase
        .from('investments')
        .select(
          'investments_id, amount, milestone_stage, created_at, projects(title, category, status, funding_goal, current_funding), contracts(signatory_name, signed_at, terms_version, agreed_amount), investor_payouts(principal, return_amount, total, reference_no, paid_at), payments(status, refund_reference, refunded_at)'
        )
        .eq('customers_id', profile.users_id)
        .order('created_at', { ascending: false }),
    ]);

    const failed = [projectsRes, rentalsRes, investmentsRes].find((result) => result.error);
    if (failed?.error) {
      setError(failed.error.message);
      setLoading(false);
      return;
    }

    setProjects((projectsRes.data ?? []) as ProjectRow[]);
    setRentals((rentalsRes.data ?? []) as unknown as RentalRow[]);
    setInvestments((investmentsRes.data ?? []) as unknown as InvestmentRow[]);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const rentalFee = (rental: RentalRow) =>
    dayCount(rental.start_date, rental.end_date) * Number(rental.equipment?.price_per_day ?? 0);

  const completed = useMemo(
    () => investments.filter((row) => row.projects?.status === 'Completed'),
    [investments]
  );

  const cancelled = useMemo(
    () => investments.filter((row) => row.projects?.status === 'Cancelled'),
    [investments]
  );

  const signed = useMemo(
    () => investments.filter((row) => row.contracts.length > 0),
    [investments]
  );

  const totals = useMemo(() => {
    // Raised counts only the projects that finished: a rejected one raised
    // nothing and a cancelled one was refunded.
    const finished = projects.filter((project) => project.status === 'Completed');
    const raised = finished.reduce((sum, project) => sum + Number(project.current_funding), 0);
    const goal = finished.reduce((sum, project) => sum + Number(project.funding_goal), 0);
    const fees = rentals.reduce((sum, rental) => sum + rentalFee(rental), 0);
    // Damage is reimbursement for a repair, so it is counted apart from the fee
    // rather than folded into it, the same way the Admin revenue table does it.
    const damage = rentals.reduce((sum, rental) => sum + Number(rental.damage_charge ?? 0), 0);
    const days = rentals.reduce(
      (sum, rental) => sum + dayCount(rental.start_date, rental.end_date),
      0
    );

    const invested = completed.reduce((sum, row) => sum + Number(row.amount), 0);
    // The investor pays no commission: FarmVest charges the farm owner on the
    // repayment. Kept here only so the totals object keeps its shape.
    const commission = 0;
    const signedTotal = signed.reduce((sum, row) => sum + Number(row.amount), 0);
    const cancelledTotal = cancelled.reduce((sum, row) => sum + Number(row.amount), 0);

    return { raised, goal, fees, damage, days, invested, commission, signedTotal, cancelledTotal };
  }, [projects, rentals, completed, signed, cancelled]);

  const countFor = (value: Tab) => {
    switch (value) {
      case 'My Projects':
        return projects.length;
      case 'My Rentals':
        return rentals.length;
      case 'Completed Investments':
        return completed.length;
      case 'Cancelled Projects':
        return cancelled.length;
      default:
        return signed.length;
    }
  };

  const investmentRows =
    tab === 'Completed Investments' ? completed : tab === 'Cancelled Projects' ? cancelled : signed;

  // Five rows a page on every tab; switching tab starts again at page one.
  const shownProjects = useMemo(
    () => projects.filter((project) => project.status === projectStatus),
    [projects, projectStatus]
  );
  const pagedProjects = usePaged(shownProjects, `${tab}-${projectStatus}`);
  const pagedRentals = usePaged(rentals, tab);
  const pagedInvestments = usePaged(investmentRows, tab);
  const pager =
    tab === 'My Projects' ? pagedProjects : tab === 'My Rentals' ? pagedRentals : pagedInvestments;

  /** What the investors are owed: their capital plus the stated return. */
  const investorsDue = (project: ProjectRow) => {
    const capital = (project.investments ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
    return Math.round(capital * (1 + Number(project.expected_roi_percent ?? 0) / 100) * 100) / 100;
  };

  /** FarmVest's 5%, charged only now that the project has succeeded. */
  const commissionDue = (project: ProjectRow) =>
    projectCommission((project.investments ?? []).reduce((sum, row) => sum + Number(row.amount), 0));

  /** The one transfer the farm owner sends: the investors' share and the commission. */
  const repaymentDue = (project: ProjectRow) =>
    Math.round((investorsDue(project) + commissionDue(project)) * 100) / 100;

  const fundedPercent = (project: ProjectRow) => {
    if (!project.funding_goal) return 0;
    return Math.round((Number(project.current_funding) / Number(project.funding_goal)) * 100);
  };

  /** Two figures per tab, chosen to be the ones worth reading first. */
  const stats: Record<Tab, { label: string; value: string; hint: string }[]> = {
    'My Projects': [
      {
        label: 'Projects Completed',
        value: String(projects.filter((project) => project.status === 'Completed').length),
        hint: `${projects.filter((project) => project.status !== 'Completed').length} rejected, cancelled or under investigation`,
      },
      { label: 'Total Raised', value: peso(totals.raised), hint: `Of ${peso(totals.goal)} sought` },
    ],
    'My Rentals': [
      {
        label: 'Bookings Closed',
        value: String(rentals.length),
        hint: `${totals.days} rental days in total`,
      },
      {
        label: 'Rental Fees Paid',
        value: peso(totals.fees),
        hint:
          totals.damage > 0
            ? `Plus ${peso(totals.damage)} in damage charges`
            : 'No damage charges',
      },
    ],
    'Completed Investments': [
      {
        label: 'Projects Completed',
        value: String(completed.length),
        hint: `Out of ${investments.length} investments`,
      },
      {
        label: 'Invested in Them',
        value: peso(totals.invested),
        hint: `No commission is taken from investors; the farm owner pays FarmVest's ${COMMISSION_RATE * 100}%`,
      },
    ],
    'Cancelled Projects': [
      {
        label: 'Projects Cancelled',
        value: String(cancelled.length),
        hint: `Out of ${investments.length} investments`,
      },
      {
        label: 'Amount Involved',
        value: peso(totals.cancelledTotal),
        hint: 'Whatever had not been released is still held',
      },
    ],
    'Signed Agreements': [
      { label: 'Agreements Signed', value: String(signed.length), hint: 'One per investment' },
      {
        label: 'Value Committed',
        value: peso(totals.signedTotal),
        hint: 'Across every signed agreement',
      },
    ],
  };

  return (
    <IonPage>
      <DashboardHeader
        title="Reports"
        subtitle="Everything you have finished: projects, bookings, investments and agreements."
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          <div className="dash-toolbar-row">
            {TABS.map((value) => (
              <button
                key={value}
                type="button"
                className={`dash-tab${tab === value ? ' dash-tab--active' : ''}`}
                onClick={() => setTab(value)}
              >
                {value} ({countFor(value)})
              </button>
            ))}
          </div>

          {loading ? (
            <Skeleton />
          ) : (
            <>
              <div className="dash-grid dash-grid--stats">
                {stats[tab].map((stat) => (
                  <div className="dash-card dash-stat" key={stat.label}>
                    <div>
                      <p className="dash-stat__label">{stat.label}</p>
                      <p className="dash-stat__value">{stat.value}</p>
                      <p className="dash-stat__hint">{stat.hint}</p>
                    </div>
                  </div>
                ))}
              </div>

              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">{tab}</h2>
                  <span className="dash-stat__hint">{SUBTITLE[tab]}</span>
                </div>

                {tab === 'My Projects' && (
                  <div className="dash-toolbar-row" style={{ padding: '0 20px' }}>
                    {ENDED_STATUSES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`dash-tab${projectStatus === value ? ' dash-tab--active' : ''}`}
                        onClick={() => setProjectStatus(value)}
                      >
                        {value} ({projects.filter((project) => project.status === value).length})
                      </button>
                    ))}
                  </div>
                )}

                <div className="dash-panel__body dash-table-wrap">
                  {tab === 'My Projects' ? (
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Category</th>
                          <th>Funding Goal</th>
                          <th>Amount Raised</th>
                          <th>Funded</th>
                          <th>Milestone Releases</th>
                          <th>You Received</th>
                          <th>Date Posted</th>
                          <th>Status</th>
                          <th>Repayment</th>
                          <th>Your Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.length === 0 ? (
                          <tr>
                            <td colSpan={11}>
                              <EmptyState
                                title={`No ${projectStatus.toLowerCase()} project`}
                                message={`A project appears here once it is ${projectStatus.toLowerCase()}.`}
                                size={120}
                              />
                            </td>
                          </tr>
                        ) : (
                          pagedProjects.slice.map((project) => (
                            <tr key={project.projects_id}>
                              <td>{project.title}</td>
                              <td className="dash-table__muted">{orNone(project.category)}</td>
                              <td className="dash-table__muted">{peso(project.funding_goal)}</td>
                              <td>{peso(project.current_funding)}</td>
                              <td className="dash-table__muted">{fundedPercent(project)}%</td>
                              <td>
                                {/* Each release with when it went and what reached the farm,
                                    so the owner can match it against their own account. */}
                                {(project.fund_releases ?? []).length === 0 ? (
                                  <p className="dash-row__meta">
                                    <span className={pillClass('Pending')}>Pending</span> Not released
                                  </p>
                                ) : (
                                  (project.fund_releases ?? []).map((release) => (
                                    <p key={release.stage} className="dash-row__meta">
                                      <span className={pillClass('Completed')}>
                                        {release.stage === 'Full' ? 'Released' : release.stage}
                                      </span>{' '}
                                      {`${peso(release.net_amount)} on ${shortDate(release.released_at)} (Ref ${release.reference_no})`}
                                    </p>
                                  ))
                                )}
                              </td>
                              <td>
                                <p className="dash-row__title">
                                  {peso(
                                    (project.fund_releases ?? []).reduce((sum, r) => sum + Number(r.net_amount), 0)
                                  )}
                                </p>
                                <p className="dash-row__meta">
                                  in full; the {COMMISSION_RATE * 100}% commission is paid with the repayment
                                </p>
                              </td>
                              <td className="dash-table__muted">{shortDate(project.created_at)}</td>
                              <td>
                                <span className={pillClass(project.status)}>{project.status}</span>
                                {project.status === 'Rejected' && project.rejection_reason && (
                                  <p className="dash-row__meta">Reason: {project.rejection_reason}</p>
                                )}
                              </td>
                              <td>
                                {(() => {
                                  // Only a project that finished owes a repayment.
                                  if (project.status !== 'Completed') {
                                    return <span className="dash-table__muted">None</span>;
                                  }
                                  const latest = [...(project.repayments ?? [])].sort((a, b) =>
                                    b.submitted_at.localeCompare(a.submitted_at)
                                  )[0];
                                  if (latest?.status === 'Confirmed') {
                                    return <span className="dash-pill dash-pill--success">Repaid</span>;
                                  }
                                  if (latest?.status === 'Submitted') {
                                    return <span className="dash-pill dash-pill--gold">Under review</span>;
                                  }
                                  return (
                                    <>
                                      {latest?.status === 'Rejected' && (
                                        <p className="dash-row__meta">Rejected: {latest.admin_notes}</p>
                                      )}
                                      <p className="dash-row__meta">Due {peso(repaymentDue(project))}</p>
                                      <button
                                        type="button"
                                        className="dash-btn dash-btn--primary"
                                        onClick={() => setRepaying(project)}
                                      >
                                        {latest ? 'Repay Again' : 'Repay Investors'}
                                      </button>
                                    </>
                                  );
                                })()}
                              </td>
                              <td>
                                {(() => {
                                  // What the cycle left the farm owner: the funds received
                                  // and the harvest sold, less what was spent and what is
                                  // owed back. Shown once FarmVest has accepted the figures.
                                  const report = firstOf(project.liquidations);
                                  if (!report || report.status !== 'Accepted') {
                                    return <span className="dash-table__muted">After liquidation</span>;
                                  }
                                  const received = (project.fund_releases ?? []).reduce((sum, r) => sum + Number(r.net_amount), 0);
                                  const spent = (report.expenses ?? []).reduce((sum, line) => sum + Number(line.amount), 0);
                                  const net = received + Number(report.sales_amount) - spent - repaymentDue(project);
                                  return (
                                    <div className="result-cell">
                                      <p className="dash-row__meta">Funds received {peso(received)}</p>
                                      <p className="dash-row__meta">+ Sales {peso(report.sales_amount)}</p>
                                      <p className="dash-row__meta">- Spent {peso(spent)}</p>
                                      <p className="dash-row__meta">- Repayment {peso(repaymentDue(project))}</p>
                                      <p className={`dash-row__title${net < 0 ? ' result-cell__loss' : ''}`}>
                                        {net >= 0 ? 'Your earnings' : 'Your loss'} {peso(Math.abs(net))}
                                      </p>
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  ) : tab === 'My Rentals' ? (
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Equipment</th>
                          <th>Unit Code</th>
                          <th>Rental Period</th>
                          <th>Days</th>
                          <th>Rate</th>
                          <th>Rental Fee</th>
                          <th>Returned</th>
                          <th>Condition</th>
                          <th>Damage Charge</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rentals.length === 0 ? (
                          <tr>
                            <td colSpan={9}>
                              <EmptyState
                                title="No closed booking yet"
                                message="A booking appears here once the unit is returned and inspected."
                                size={120}
                              />
                            </td>
                          </tr>
                        ) : (
                          pagedRentals.slice.map((rental) => (
                            <tr key={rental.rentals_id}>
                              <td>{orNone(rental.equipment?.name)}</td>
                              <td className="dash-table__muted">
                                {orNone(rental.equipment?.unit_code)}
                              </td>
                              <td className="dash-table__muted">
                                {shortDate(rental.start_date)} to {shortDate(rental.end_date)}
                              </td>
                              <td className="dash-table__muted">
                                {dayCount(rental.start_date, rental.end_date)}
                              </td>
                              <td className="dash-table__muted">
                                {peso(rental.equipment?.price_per_day ?? 0)}
                              </td>
                              <td>{peso(rentalFee(rental))}</td>
                              <td className="dash-table__muted">{shortDate(rental.returned_at)}</td>
                              <td>
                                <span className={pillClass(rental.return_condition)}>
                                  {rental.return_condition}
                                </span>
                              </td>
                              <td className="dash-table__muted">
                                {Number(rental.damage_charge) > 0
                                  ? peso(rental.damage_charge)
                                  : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  ) : tab !== 'Signed Agreements' ? (
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Category</th>
                          <th>Amount Invested</th>
                          <th>Project Raised</th>
                          <th>Milestone Stage</th>
                          <th>Date Invested</th>
                          <th>Status</th>
                          <th>{tab === 'Cancelled Projects' ? 'Refund' : 'Return Received'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {investmentRows.length === 0 ? (
                          <tr>
                            <td colSpan={8}>
                              <EmptyState
                                title={
                                  tab === 'Cancelled Projects'
                                    ? 'No project you funded was cancelled'
                                    : 'No completed investment yet'
                                }
                                message={
                                  tab === 'Cancelled Projects'
                                    ? 'Nothing you funded has been cancelled.'
                                    : 'An investment appears here once its project reaches Completed.'
                                }
                                size={120}
                              />
                            </td>
                          </tr>
                        ) : (
                          pagedInvestments.slice.map((row) => (
                            <tr key={row.investments_id}>
                              <td>{orNone(row.projects?.title)}</td>
                              <td className="dash-table__muted">
                                {orNone(row.projects?.category)}
                              </td>
                              <td>{peso(row.amount)}</td>
                              <td className="dash-table__muted">
                                {peso(row.projects?.current_funding ?? 0)} of{' '}
                                {peso(row.projects?.funding_goal ?? 0)}
                              </td>
                              <td className="dash-table__muted">{row.milestone_stage}</td>
                              <td className="dash-table__muted">{shortDate(row.created_at)}</td>
                              <td>
                                <span className={pillClass(row.projects?.status ?? '')}>
                                  {orNone(row.projects?.status)}
                                </span>
                              </td>
                              <td>
                                {(() => {
                                  if (tab === 'Cancelled Projects') {
                                    const refund = row.payments?.find((payment) => payment.status === 'Refunded');
                                    return refund ? (
                                      <>
                                        <p className="dash-row__title">{peso(row.amount)} refunded</p>
                                        <p className="dash-row__meta">
                                          Ref {refund.refund_reference}
                                          {refund.refunded_at ? ` · ${shortDate(refund.refunded_at)}` : ''}
                                        </p>
                                      </>
                                    ) : (
                                      <span className="dash-table__muted">Nothing was paid</span>
                                    );
                                  }
                                  // Capital and return, as FarmVest sent them on.
                                  const payout = firstOf(row.investor_payouts);
                                  return payout ? (
                                    <>
                                      <p className="dash-row__title">{peso(payout.total)}</p>
                                      <p className="dash-row__meta">
                                        {peso(payout.principal)} capital + {peso(payout.return_amount)} return
                                      </p>
                                      <p className="dash-row__meta">
                                        Ref {payout.reference_no} · {shortDate(payout.paid_at)}
                                      </p>
                                    </>
                                  ) : (
                                    <span className="dash-pill dash-pill--gold">Awaiting repayment</span>
                                  );
                                })()}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Signed As</th>
                          <th>Date Signed</th>
                          <th>Agreed Amount</th>
                          <th>Terms Version</th>
                          <th>Project Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {investmentRows.length === 0 ? (
                          <tr>
                            <td colSpan={6}>
                              <EmptyState
                                title="No agreement signed yet"
                                message="An agreement is signed at the moment you invest."
                                size={120}
                              />
                            </td>
                          </tr>
                        ) : (
                          pagedInvestments.slice.map((row) => (
                            <tr key={row.investments_id}>
                              <td>{orNone(row.projects?.title)}</td>
                              <td className="dash-table__muted">
                                {orNone(row.contracts[0]?.signatory_name)}
                              </td>
                              <td className="dash-table__muted">
                                {shortDate(row.contracts[0]?.signed_at)}
                              </td>
                              <td>{peso(row.contracts[0]?.agreed_amount ?? row.amount)}</td>
                              <td className="dash-table__muted">
                                {orNone(row.contracts[0]?.terms_version)}
                              </td>
                              <td>
                                <span className={pillClass(row.projects?.status ?? '')}>
                                  {orNone(row.projects?.status)}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                  {!loading && <Pager {...pager} />}
                </div>
              </section>
            </>
          )}
        </div>
        {repaying && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Repay investors"
            onClick={() => setRepaying(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--wide"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Repay Investors</p>
                  <h2 className="dash-modal__title">{repaying.title}</h2>
                </div>
                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setRepaying(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body">
                <table className="dash-table">
                  <tbody>
                    <tr>
                      <td>Capital raised from {repaying.investments?.length ?? 0} investment(s)</td>
                      <td>
                        {peso((repaying.investments ?? []).reduce((sum, row) => sum + Number(row.amount), 0))}
                      </td>
                    </tr>
                    <tr>
                      <td>Agreed return ({Number(repaying.expected_roi_percent)}%)</td>
                      <td>
                        {peso(
                          investorsDue(repaying) -
                            (repaying.investments ?? []).reduce((sum, row) => sum + Number(row.amount), 0)
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td>To the investors</td>
                      <td>{peso(investorsDue(repaying))}</td>
                    </tr>
                    <tr>
                      <td>FarmVest commission ({COMMISSION_RATE * 100}% of the capital raised)</td>
                      <td>{peso(commissionDue(repaying))}</td>
                    </tr>
                    <tr className="dash-table__totals">
                      <td>Total to repay</td>
                      <td>{peso(repaymentDue(repaying))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <PaymentForm
                repaymentProjectId={repaying.projects_id}
                fee={repaymentDue(repaying)}
                cancelLabel="Later"
                onCancel={() => setRepaying(null)}
                onSubmitted={async () => {
                  setRepaying(null);
                  await load();
                }}
              />
            </div>
          </Portal>
        )}
      </IonContent>
    </IonPage>
  );
};

export default CustomerReports;
