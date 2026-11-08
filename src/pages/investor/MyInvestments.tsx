import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import PaymentForm from '../../components/PaymentForm';
import Portal from '../../components/Portal';
import { useToast } from '../../components/Toast';
import EmptyState from '../../components/EmptyState';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { hasValue, orNone, peso, pillClass, shortDate } from '../../lib/format';
import { isReleasedStage } from '../../lib/funding';
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

export type InvestmentRow = {
  investments_id: string;
  amount: number;
  milestone_stage: string;
  created_at: string;
  projects: {
    projects_id: string;
    customers_id: string;
    title: string;
    category: string | null;
    status: string;
    funding_goal: number;
    current_funding: number;
  } | null;
  contracts: { signatory_name: string; signed_at: string; terms_snapshot: string }[];
  payments: { payments_id: string; status: string; admin_notes: string; submitted_at: string }[];
};

/** What an investor can report about a project, as the database allows. */
const REPORT_CATEGORIES = [
  'No progress updates',
  'Fake progress photos',
  'Misuse of funds',
  'Unresponsive',
  'Other',
];

/** The payment that decides where an investment stands: the newest one sent. */
const latestPayment = (row: InvestmentRow) =>
  [...(row.payments ?? [])].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];

/**
 * One tab per status the funded project can still be in, in the order it passes
 * through them.
 *
 * Completed and Cancelled are both absent: neither leaves anything to act on,
 * so both are records, and records are on Reports. What stays here is every
 * status where a milestone can still move or a case can still be filed.
 */
const FILTERS = ['Open', 'Funded', 'In Progress', 'Under Investigation'];

/**
 * Funds are released in full once the project is funded, so the stage says
 * whether the money has left FarmVest for the farm.
 */
const STAGE_NOTE = (stage: string) =>
  isReleasedStage(stage)
    ? 'Released in full to the farm owner.'
    : 'Held by FarmVest until the project is funded and released.';

const MyInvestments: React.FC = () => {
  const { profile } = useAuth();
  const { showSuccess } = useToast();

  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  const [filter, setFilter] = useState(FILTERS[0]);
  const [contractOf, setContractOf] = useState<InvestmentRow | null>(null);
  const [payingFor, setPayingFor] = useState<InvestmentRow | null>(null);

  /** Cases this investor has filed, by project, so a second one is not opened. */
  const [cases, setCases] = useState<Record<string, string>>({});
  const [reporting, setReporting] = useState<InvestmentRow | null>(null);
  const [reportCategory, setReportCategory] = useState(REPORT_CATEGORIES[0]);
  const [reportReason, setReportReason] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    const { data, error: loadError } = await supabase
      .from('investments')
      .select(
        'investments_id, amount, milestone_stage, created_at, projects(projects_id, customers_id, title, category, status, funding_goal, current_funding), contracts(signatory_name, signed_at, terms_snapshot), payments(payments_id, status, admin_notes, submitted_at)'
      )
      .eq('customers_id', profile.users_id)
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
    } else {
      setInvestments((data ?? []) as unknown as InvestmentRow[]);
    }

    // A case still open or under review blocks another on the same project.
    const { data: caseData } = await supabase
      .from('reports')
      .select('projects_id, status')
      .eq('reporter_customers_id', profile.users_id)
      .in('status', ['Open', 'Reviewing']);
    setCases(
      Object.fromEntries(
        ((caseData ?? []) as { projects_id: string | null; status: string }[])
          .filter((row) => row.projects_id)
          .map((row) => [row.projects_id as string, row.status])
      )
    );

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  // Arriving from Invest or from a payment notification: /app/investments?pay=<id>
  // opens that investment's payment form, on the tab that holds it. The query is
  // cleared afterwards so a refresh or a back step does not reopen it.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('pay');
    if (!id || loading) return;

    const row = investments.find((investment) => investment.investments_id === id);
    if (row) {
      if (row.projects?.status && FILTERS.includes(row.projects.status)) setFilter(row.projects.status);
      const paid = row.payments?.some((payment) => ['Submitted', 'Confirmed'].includes(payment.status));
      if (!paid) setPayingFor(row);
    }
    navigate('/app/investments', { replace: true });
  }, [location.search, loading, investments, navigate]);

  const openReport = (row: InvestmentRow) => {
    setReporting(row);
    setReportCategory(REPORT_CATEGORIES[0]);
    setReportReason('');
    setReportError(null);
  };

  /** File a case with the Admin against the farm owner of this project. */
  const fileReport = async () => {
    if (!reporting?.projects || !profile) return;
    if (reportReason.trim().length < 10) {
      setReportError('Say what happened in a sentence or two, so the Admin knows what to look at.');
      return;
    }

    setFiling(true);
    setReportError(null);

    const { error: insertError } = await supabase.from('reports').insert({
      reporter_customers_id: profile.users_id,
      reported_customers_id: reporting.projects.customers_id,
      projects_id: reporting.projects.projects_id,
      category: reportCategory,
      reason: reportReason.trim(),
      status: 'Open',
    });

    if (insertError) {
      setReportError(insertError.message);
    } else {
      showSuccess('Your report reached the Admin. You will be told when it is resolved.');
      setReporting(null);
      await load();
    }
    setFiling(false);
  };

  const visible = useMemo(
    () => investments.filter((row) => row.projects?.status === filter),
    [investments, filter]
  );

  const countFor = (value: string) =>
    investments.filter((row) => row.projects?.status === value).length;

  const stats = useMemo(() => {
    // Completed projects are on Reports, but the money in them is still money
    // this investor put in, so the totals count every row.
    const total = investments.reduce((sum, row) => sum + Number(row.amount), 0);
    const projects = new Set(investments.map((row) => row.projects?.projects_id)).size;
    const held = investments.filter((row) => !isReleasedStage(row.milestone_stage)).length;

    return { total, projects, held };
  }, [investments]);

  const fundedPercent = (row: InvestmentRow) => {
    const goal = Number(row.projects?.funding_goal ?? 0);
    if (!goal) return 0;
    return Math.min(100, Math.round((Number(row.projects?.current_funding ?? 0) / goal) * 100));
  };

  return (
    <IonPage>
      <DashboardHeader
        title="My Investments"
        subtitle="What you funded, how far each project has come, and what is still held back."
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          <div className="dash-grid dash-grid--stats">
            <div className="dash-card dash-stat">
              <div>
                <p className="dash-stat__label">Total Invested</p>
                <p className="dash-stat__value">{peso(stats.total)}</p>
                <p className="dash-stat__hint">Across every project</p>
              </div>
            </div>
            <div className="dash-card dash-stat">
              <div>
                <p className="dash-stat__label">Projects Backed</p>
                <p className="dash-stat__value">{String(stats.projects)}</p>
                <p className="dash-stat__hint">{investments.length} investments in total</p>
              </div>
            </div>
            <div className="dash-card dash-stat">
              <div>
                <p className="dash-stat__label">Funds Still Held</p>
                <p className="dash-stat__value">{String(stats.held)}</p>
                <p className="dash-stat__hint">Not yet released to the farm owner</p>
              </div>
            </div>
          </div>

          <div className="dash-toolbar-row">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={`dash-tab${filter === value ? ' dash-tab--active' : ''}`}
                onClick={() => setFilter(value)}
              >
                {value} ({countFor(value)})
              </button>
            ))}
          </div>

          {contractOf && (
            <section className="dash-panel">
              <div className="dash-panel__head">
                <h2 className="dash-panel__title">Your Signed Investment Agreement</h2>
                <button
                  type="button"
                  className="dash-panel__link"
                  onClick={() => setContractOf(null)}
                >
                  Close
                </button>
              </div>

              <div className="dash-panel__body">
                <div className="contract-box">{contractOf.contracts[0]?.terms_snapshot}</div>
                <p className="contract-box__signature">{contractOf.contracts[0]?.signatory_name}</p>
                <p className="dash-stat__hint">
                  Signed {shortDate(contractOf.contracts[0]?.signed_at)}
                </p>
              </div>
            </section>
          )}

          <section className="dash-panel">
            <div className="dash-panel__head">
              <h2 className="dash-panel__title">{filter} Projects</h2>
              <span className="dash-stat__hint">
                {visible.length} investment{visible.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="dash-panel__body dash-table-wrap">
              {loading ? (
                <Skeleton />
              ) : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Category</th>
                      <th>Amount Invested</th>
                      <th>Project Funding</th>
                      <th>Funds</th>
                      <th>Date Invested</th>
                      <th>Payment</th>
                      <th>Agreement</th>
                      <th>Problem?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={9}>
                          <EmptyState
                            title={
                              investments.length === 0
                                ? 'You have not invested yet'
                                : `No investment in an ${filter} project`
                            }
                            message={
                              investments.length === 0
                                ? 'Open Browse Projects to find a farm to fund.'
                                : 'Try another tab.'
                            }
                            size={120}
                          />
                        </td>
                      </tr>
                    ) : (
                      visible.map((row) => (
                        <tr key={row.investments_id}>
                          <td>{orNone(row.projects?.title)}</td>
                          <td className="dash-table__muted">{orNone(row.projects?.category)}</td>
                          <td>{peso(row.amount)}</td>
                          <td className="dash-table__muted">
                            {peso(row.projects?.current_funding ?? 0)} of{' '}
                            {peso(row.projects?.funding_goal ?? 0)} ({fundedPercent(row)}%)
                          </td>
                          <td>
                            <span className={pillClass(isReleasedStage(row.milestone_stage) ? 'Completed' : 'Pending')}>
                              {isReleasedStage(row.milestone_stage) ? 'Released' : 'Held'}
                            </span>
                            <p className="dash-row__meta">{STAGE_NOTE(row.milestone_stage)}</p>
                          </td>
                          <td className="dash-table__muted">{shortDate(row.created_at)}</td>
                          <td>
                            {(() => {
                              const payment = latestPayment(row);

                              if (payment?.status === 'Confirmed') {
                                return <span className="dash-pill dash-pill--success">Paid</span>;
                              }
                              if (payment?.status === 'Submitted') {
                                return (
                                  <span className="dash-pill dash-pill--gold">Under review</span>
                                );
                              }

                              // Nothing sent yet, or the last receipt was refused.
                              return (
                                <>
                                  {payment?.status === 'Rejected' && (
                                    <p className="dash-row__meta">
                                      Rejected
                                      {hasValue(payment.admin_notes) ? `: ${payment.admin_notes}` : ''}
                                    </p>
                                  )}
                                  <button
                                    type="button"
                                    className="dash-btn dash-btn--primary"
                                    onClick={() => setPayingFor(row)}
                                  >
                                    {payment ? 'Pay Again' : 'Pay'}
                                  </button>
                                </>
                              );
                            })()}
                          </td>
                          <td>
                            {row.contracts.length > 0 ? (
                              <button
                                type="button"
                                className="dash-btn dash-btn--slate"
                                onClick={() => setContractOf(row)}
                              >
                                View
                              </button>
                            ) : (
                              <span className="dash-table__muted">None</span>
                            )}
                          </td>
                          <td>
                            {row.projects && cases[row.projects.projects_id] ? (
                              <span className="dash-pill dash-pill--gold">
                                Case {cases[row.projects.projects_id]}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="dash-btn dash-btn--ghost"
                                onClick={() => openReport(row)}
                              >
                                Report a Problem
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        {reporting && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Report a problem"
            onClick={() => setReporting(null)}
          >
            <div className="dash-modal__panel" onClick={(event) => event.stopPropagation()}>
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Report a Problem</p>
                  <h2 className="dash-modal__title">{orNone(reporting.projects?.title)}</h2>
                </div>
                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setReporting(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body dash-modal__body--form">
                <p className="dash-notice">
                  The Admin reviews every report against the project's documents, payments and dated
                  progress photos, and can freeze the project while it is looked into.
                </p>

                <div className="dash-field">
                  <label htmlFor="report-category">What is wrong?</label>
                  <select
                    id="report-category"
                    className="dash-select"
                    value={reportCategory}
                    onChange={(event) => setReportCategory(event.target.value)}
                  >
                    {REPORT_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="dash-field">
                  <label htmlFor="report-reason">
                    What happened? <span className="dash-required">*</span>
                  </label>
                  <textarea
                    id="report-reason"
                    className={`dash-textarea${reportError ? ' dash-input--invalid' : ''}`}
                    placeholder="For example: no progress update in three weeks, and messages are not answered."
                    value={reportReason}
                    onChange={(event) => {
                      setReportReason(event.target.value);
                      if (reportError) setReportError(null);
                    }}
                  />
                  {reportError && (
                    <p className="dash-field__error" role="alert">
                      {reportError}
                    </p>
                  )}
                </div>
              </div>

              <div className="dash-modal__foot">
                <button type="button" className="dash-btn dash-btn--ghost" onClick={() => setReporting(null)}>
                  Cancel
                </button>
                <button type="button" className="dash-btn dash-btn--primary" disabled={filing} onClick={fileReport}>
                  {filing ? 'Sending...' : 'Send Report'}
                </button>
              </div>
            </div>
          </Portal>
        )}

        {payingFor && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Pay for this investment"
            onClick={() => setPayingFor(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--wide"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Investment Payment</p>
                  <h2 className="dash-modal__title">{orNone(payingFor.projects?.title)}</h2>
                </div>

                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setPayingFor(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <PaymentForm
                investmentId={payingFor.investments_id}
                fee={Number(payingFor.amount)}
                cancelLabel="Pay Later"
                onCancel={() => setPayingFor(null)}
                onSubmitted={async () => {
                  setPayingFor(null);
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

export default MyInvestments;
