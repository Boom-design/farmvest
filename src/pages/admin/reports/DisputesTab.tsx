import { useCallback, useEffect, useMemo, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { alertCircleOutline, locationOutline } from 'ionicons/icons';
import { supabase } from '../../../supabaseClient';
import EmptyState from '../../../components/EmptyState';
import { useToast } from '../../../components/Toast';
import { useAuth } from '../../../contexts/AuthContext';
import { hasValue, orNone, peso, pillClass, shortDate } from '../../../lib/format';
import { releaseLabel } from '../../../lib/funding';
import ReportTable, { type ReportColumn } from './ReportTable';
import { applyFilters, type ReportFilters } from './reportFilters';
import '../../../theme/dashboard.css';

export type CaseRow = {
  reports_id: string;
  projects_id: string | null;
  category: string;
  reason: string;
  status: string;
  resolution: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  reporter_customers_id: string;
  reported_customers_id: string;
};

export type PartyLite = {
  users_id: string;
  name: string;
  email: string;
  contact_number: string;
  user_type: string;
  account_status: string;
  verification_status: string;
  valid_id_url: string | null;
  customers: { farm_location: string | null } | null;
};

/** The party columns hold a users_id, which customers shares as its own key. */
export const reporterId = (row: CaseRow) => row.reporter_customers_id;

export const reportedId = (row: CaseRow) => row.reported_customers_id;

const CASE_COLUMNS =
  'reports_id, projects_id, category, reason, status, resolution, resolved_at, resolved_by, created_at, reporter_customers_id, reported_customers_id';

const PARTY_COLUMNS =
  'users_id, name, email, contact_number, user_type, account_status, verification_status, valid_id_url, customers(farm_location)';

/** Statuses a case can still be worked on. */
const LIVE = ['Open', 'Reviewing'];

type ProjectEvidence = {
  projects_id: string;
  title: string;
  status: string;
  funding_goal: number;
  current_funding: number;
  created_at: string;
};

type UpdateEvidence = {
  progress_updates_id: string;
  photo_url: string | null;
  captured_at: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
};

type InvestorEvidence = {
  investments_id: string;
  amount: number;
  milestone_stage: string;
  created_at: string;
  customers: { users: { name: string } | null } | null;
};

type DisputesTabProps = {
  filters: ReportFilters;
  onError: (message: string | null) => void;
};

const daysSince = (value: string) =>
  Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 86_400_000));

const DisputesTab: React.FC<DisputesTabProps> = ({ filters, onError }) => {
  const { profile } = useAuth();
  const { showSuccess } = useToast();

  const [cases, setCases] = useState<CaseRow[]>([]);
  const [parties, setParties] = useState<Record<string, PartyLite>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [openCase, setOpenCase] = useState<CaseRow | null>(null);
  const [project, setProject] = useState<ProjectEvidence | null>(null);
  const [updates, setUpdates] = useState<UpdateEvidence[]>([]);
  const [investors, setInvestors] = useState<InvestorEvidence[]>([]);
  const [resolution, setResolution] = useState('');

  const load = useCallback(async () => {
    const [caseRes, partyRes] = await Promise.all([
      supabase
        .from('reports')
        .select(CASE_COLUMNS)
        .in('status', LIVE)
        .order('created_at', { ascending: false }),
      supabase.from('users').select(PARTY_COLUMNS).neq('user_type', 'Admin'),
    ]);

    const failed = [caseRes, partyRes].find((result) => result.error);

    if (failed?.error) {
      onError(failed.error.message);
    } else {
      setCases((caseRes.data ?? []) as unknown as CaseRow[]);
      setParties(
        Object.fromEntries(
          ((partyRes.data ?? []) as unknown as PartyLite[]).map((party) => [party.users_id, party])
        )
      );
    }

    setLoading(false);
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  /** Pulls everything the Admin needs to judge one case onto a single screen. */
  const openReview = async (row: CaseRow) => {
    setOpenCase(row);
    setResolution('');
    setProject(null);
    setUpdates([]);
    setInvestors([]);

    if (!row.projects_id) return;

    const [projectRes, updatesRes, investmentsRes] = await Promise.all([
      supabase
        .from('projects')
        .select('projects_id, title, status, funding_goal, current_funding, created_at')
        .eq('projects_id', row.projects_id)
        .maybeSingle(),
      supabase
        .from('progress_updates')
        .select('progress_updates_id, photo_url, captured_at, latitude, longitude, notes')
        .eq('projects_id', row.projects_id)
        .order('captured_at', { ascending: false }),
      supabase
        .from('investments')
        .select('investments_id, amount, milestone_stage, created_at, customers(users(name))')
        .eq('projects_id', row.projects_id)
        .order('created_at', { ascending: false }),
    ]);

    if (projectRes.data) setProject(projectRes.data as ProjectEvidence);
    setUpdates((updatesRes.data ?? []) as UpdateEvidence[]);
    setInvestors((investmentsRes.data ?? []) as unknown as InvestorEvidence[]);
  };

  const patchCase = async (patch: Record<string, unknown>) => {
    if (!openCase) return;

    setBusy(true);
    onError(null);

    const { error } = await supabase
      .from('reports')
      .update(patch)
      .eq('reports_id', openCase.reports_id);

    if (error) onError(error.message);

    setBusy(false);
    return !error;
  };

  const markReviewing = async () => {
    if (await patchCase({ status: 'Reviewing' })) {
      setOpenCase({ ...(openCase as CaseRow), status: 'Reviewing' });
      await load();
    }
  };

  /** The freeze: no new investment, and no further milestone release. */
  const setProjectStatus = async (status: string) => {
    if (!project) return;

    setBusy(true);
    onError(null);

    const { error } = await supabase
      .from('projects')
      .update({ status })
      .eq('projects_id', project.projects_id);

    if (error) {
      onError(error.message);
    } else {
      setProject({ ...project, status });
      showSuccess(
        status === 'Under Investigation'
          ? 'Project frozen. No new investment and no milestone release.'
          : 'Project unfrozen.'
      );
    }

    setBusy(false);
  };

  const closeCase = async (status: 'Resolved' | 'Dismissed', deactivate: boolean) => {
    const text =
      resolution.trim() ||
      (status === 'Dismissed' ? 'Dismissed: no basis found.' : 'Resolved by administrator.');

    const ok = await patchCase({
      status,
      resolution: text,
      resolved_at: new Date().toISOString(),
      resolved_by: profile?.email ?? 'admin',
    });

    if (!ok) return;

    if (deactivate) {
      const reportedUser = parties[reportedId(openCase as CaseRow)];

      if (reportedUser) {
        const { error } = await supabase.rpc('admin_set_account_status', {
          p_users_id: reportedUser.users_id,
          p_status: 'Inactive',
          p_reason: `Deactivated after case ${(openCase as CaseRow).reports_id.slice(0, 8)}`,
        });

        if (error) onError(error.message);
      }
    }

    showSuccess(
      status === 'Dismissed'
        ? 'Case dismissed.'
        : deactivate
          ? 'Case resolved and the account was deactivated.'
          : 'Case resolved.'
    );

    setOpenCase(null);
    await load();
  };

  const columns: ReportColumn<CaseRow>[] = useMemo(
    () => [
      { label: 'Date Filed', text: (row) => shortDate(row.created_at) },
      { label: 'Reported Account', text: (row) => orNone(parties[reportedId(row)]?.name) },
      { label: 'Role', text: (row) => orNone(parties[reportedId(row)]?.user_type) },
      { label: 'Filed By', text: (row) => orNone(parties[reporterId(row)]?.name) },
      { label: 'Case Category', text: (row) => orNone(row.category) },
      { label: 'Complaint', text: (row) => orNone(row.reason) },
      {
        label: 'Case Status',
        text: (row) => row.status,
        render: (row) => <span className={pillClass(row.status)}>{row.status}</span>,
      },
      {
        label: 'Case File',
        text: () => '',
        render: (row) => (
          <button
            type="button"
            className="dash-btn dash-btn--primary"
            onClick={() => openReview(row)}
          >
            Review Case
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parties]
  );

  const visible = useMemo(
    () => applyFilters(cases, columns, filters, (row) => row.created_at),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cases, columns, filters]
  );

  const reported = openCase ? parties[reportedId(openCase)] : undefined;
  const reporter = openCase ? parties[reporterId(openCase)] : undefined;
  const priorCases = openCase
    ? cases.filter(
        (row) => reportedId(row) === reportedId(openCase) && row.reports_id !== openCase.reports_id
      ).length
    : 0;

  return (
    <>
      {openCase && (
        <section className="dash-panel case-panel">
          <div className="dash-panel__head">
            <h2 className="dash-panel__title">
              Case File - {orNone(openCase.category)}
              <span className={`${pillClass(openCase.status)} case-panel__pill`}>
                {openCase.status}
              </span>
            </h2>
            <button type="button" className="dash-panel__link" onClick={() => setOpenCase(null)}>
              Close
            </button>
          </div>

          <div className="dash-panel__body case-grid">
            <div className="dash-card">
              <p className="dash-stat__label">Reported Account</p>
              <p className="dash-row__title">{orNone(reported?.name)}</p>
              <p className="dash-row__meta">{orNone(reported?.user_type)}</p>
              <p className="dash-row__meta">{orNone(reported?.email)}</p>
              <p className="dash-row__meta">{orNone(reported?.contact_number)}</p>
              <p className="dash-row__meta">
                <IonIcon icon={locationOutline} />{' '}
                {orNone(reported?.customers?.farm_location)}
              </p>
              <p className="dash-row__meta">
                Verification: {orNone(reported?.verification_status)} · Account:{' '}
                {orNone(reported?.account_status)}
              </p>
              <p className="dash-row__meta">
                {priorCases === 0
                  ? 'No other open case against this account.'
                  : `${priorCases} other open case${priorCases === 1 ? '' : 's'} against this account.`}
              </p>
            </div>

            <div className="dash-card">
              <p className="dash-stat__label">The Complaint</p>
              <p className="dash-row__title">{orNone(openCase.category)}</p>
              <p className="dash-row__meta">{orNone(openCase.reason)}</p>
              <p className="dash-row__meta">
                Filed by {orNone(reporter?.name)} ({orNone(reporter?.user_type)}) on{' '}
                {shortDate(openCase.created_at)}
              </p>
            </div>

            <div className="dash-card">
              <p className="dash-stat__label">Project Under Dispute</p>
              {project ? (
                <>
                  <p className="dash-row__title">{orNone(project.title)}</p>
                  <p className="dash-row__meta">
                    {peso(project.current_funding)} raised of {peso(project.funding_goal)}
                  </p>
                  <p className="dash-row__meta">Posted {shortDate(project.created_at)}</p>
                  <p className="dash-row__meta">
                    <span className={pillClass(project.status)}>{project.status}</span>
                  </p>
                </>
              ) : (
                <p className="dash-row__meta">
                  This case is not tied to a project, so there is no funding to freeze.
                </p>
              )}
            </div>
          </div>

          {/* The timestamped, geotagged photo trail is the evidence: its absence
            * is just as telling as its content. */}
          <div className="dash-panel__body">
            <p className="dash-field-label">Progress Update Trail</p>

            {!project ? (
              <EmptyState title="No project attached to this case" size={110} />
            ) : updates.length === 0 ? (
              <p className="dash-error">
                <IonIcon icon={alertCircleOutline} /> No progress update has ever been posted for
                this project, {daysSince(project.created_at)} days after it was posted.
              </p>
            ) : (
              <>
                <p className="dash-row__meta">
                  {updates.length} update{updates.length === 1 ? '' : 's'}; the most recent was{' '}
                  {daysSince(updates[0].captured_at)} days ago.
                </p>

                <div className="dash-cards">
                  {updates.map((update) => (
                    <article key={update.progress_updates_id} className="dash-card">
                      {hasValue(update.photo_url) && (
                        <img className="dash-card__photo" src={update.photo_url} alt="" loading="lazy" />
                      )}
                      <p className="dash-row__title">{shortDate(update.captured_at)}</p>
                      <p className="dash-row__meta">
                        <IonIcon icon={locationOutline} /> {orNone(update.latitude)},{' '}
                        {orNone(update.longitude)}
                      </p>
                      <p className="dash-row__meta">{orNone(update.notes)}</p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="dash-panel__body dash-table-wrap">
            <p className="dash-field-label">Investors Affected</p>

            {investors.length === 0 ? (
              <EmptyState title="No investment recorded on this project" size={110} />
            ) : (
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Investor</th>
                    <th>Amount at Risk</th>
                    <th>Funds</th>
                    <th>Date Invested</th>
                  </tr>
                </thead>
                <tbody>
                  {investors.map((row) => (
                    <tr key={row.investments_id}>
                      <td>{orNone(row.customers?.users?.name)}</td>
                      <td>{peso(row.amount)}</td>
                      <td className="dash-table__muted">{releaseLabel(row.milestone_stage)}</td>
                      <td className="dash-table__muted">{shortDate(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="dash-table__totals">
                    <td>Total at risk</td>
                    <td>
                      {peso(investors.reduce((total, row) => total + Number(row.amount), 0))}
                    </td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          <div className="dash-panel__body">
            <p className="dash-field-label">Administrator Action</p>

            <div className="dash-actions">
              {openCase.status === 'Open' && (
                <button
                  type="button"
                  className="dash-btn dash-btn--gold"
                  disabled={busy}
                  onClick={markReviewing}
                >
                  Mark as Reviewing
                </button>
              )}

              {project &&
                (project.status === 'Under Investigation' ? (
                  <button
                    type="button"
                    className="dash-btn dash-btn--slate"
                    disabled={busy}
                    onClick={() => setProjectStatus('In Progress')}
                  >
                    Unfreeze Project
                  </button>
                ) : (
                  <button
                    type="button"
                    className="dash-btn dash-btn--ghost"
                    disabled={busy}
                    onClick={() => setProjectStatus('Under Investigation')}
                  >
                    Freeze Project
                  </button>
                ))}
            </div>

            <p className="dash-note">
              Freezing hides the project from investors, blocks any new investment, and holds the
              remaining milestone release. FarmVest does not move money itself, so a refund is
              arranged outside the app and recorded below.
            </p>

            <div className="dash-field dash-field--full">
              <label htmlFor="case-resolution">Resolution Notes</label>
              <textarea
                id="case-resolution"
                className="dash-textarea"
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
                placeholder="What was decided, what the farm owner said, and what happens to the funds."
              />
            </div>

            <div className="dash-actions dash-actions--end">
              <button
                type="button"
                className="dash-btn dash-btn--slate"
                disabled={busy}
                onClick={() => closeCase('Dismissed', false)}
              >
                Dismiss Case
              </button>
              <button
                type="button"
                className="dash-btn dash-btn--primary"
                disabled={busy}
                onClick={() => closeCase('Resolved', false)}
              >
                Resolve Case
              </button>
              <button
                type="button"
                className="dash-btn dash-btn--ghost"
                disabled={busy}
                onClick={() => closeCase('Resolved', true)}
              >
                Resolve and Deactivate Account
              </button>
            </div>
          </div>
        </section>
      )}

      <ReportTable
        columns={columns}
        rows={visible}
        rowKey={(row) => row.reports_id}
        loading={loading}
        emptyMessage="No open dispute. Cases filed by investors or farm owners appear here."
        exportName="open-disputes"
      />
    </>
  );
};

export default DisputesTab;
