import { useCallback, useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import DashboardHeader from '../../components/DashboardHeader';
import EmptyState from '../../components/EmptyState';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { orNone, peso, pillClass, shortDate } from '../../lib/format';
import { COMMISSION_RATE } from '../../lib/revenue';
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

type InvestmentRow = {
  investments_id: string;
  amount: number;
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

const TABS = ['Completed Investments', 'Cancelled Projects', 'Signed Agreements'] as const;
type Tab = (typeof TABS)[number];

const SUBTITLE: Record<Tab, string> = {
  'Completed Investments': 'Projects that reached Completed, and what you put into each.',
  'Cancelled Projects': 'Projects you funded that were cancelled before they finished, and what you had in each.',
  'Signed Agreements': 'Every investment agreement you signed, and the terms version behind it.',
};

/**
 * Investor reports.
 *
 * My Investments carries the projects that are still running, where a milestone
 * can still move and a case can still be filed. What is finished has no action
 * left on it, so it is read-only here, with the totals that only mean something
 * once the work is done.
 */
const InvestorReports: React.FC = () => {
  const { profile } = useAuth();

  const [tab, setTab] = useState<Tab>('Completed Investments');
  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    const { data, error: loadError } = await supabase
      .from('investments')
      .select(
        'investments_id, amount, milestone_stage, created_at, projects(title, category, status, funding_goal, current_funding), contracts(signatory_name, signed_at, terms_version, agreed_amount)'
      )
      .eq('customers_id', profile.users_id)
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
    } else {
      setInvestments((data ?? []) as unknown as InvestmentRow[]);
    }

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

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
    const invested = completed.reduce((sum, row) => sum + Number(row.amount), 0);
    // Shown so the figure is not a surprise: the commission is FarmVest's cut of
    // the investment, and it is charged on the way in.
    const commission = invested * COMMISSION_RATE;
    const signedTotal = signed.reduce((sum, row) => sum + Number(row.amount), 0);
    const cancelledTotal = cancelled.reduce((sum, row) => sum + Number(row.amount), 0);

    return { invested, commission, signedTotal, cancelled: cancelledTotal };
  }, [completed, signed, cancelled]);

  const rows =
    tab === 'Completed Investments' ? completed : tab === 'Cancelled Projects' ? cancelled : signed;

  return (
    <IonPage>
      <DashboardHeader
        title="Reports"
        subtitle="Your finished and cancelled projects, and the agreements behind them."
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
                {value} (
                {value === 'Completed Investments'
                  ? completed.length
                  : value === 'Cancelled Projects'
                    ? cancelled.length
                    : signed.length}
                )
              </button>
            ))}
          </div>

          {loading ? (
            <Skeleton />
          ) : (
            <>
              <div className="dash-grid dash-grid--stats">
                {tab === 'Completed Investments' ? (
                  <>
                    <div className="dash-card dash-stat">
                      <div>
                        <p className="dash-stat__label">Projects Completed</p>
                        <p className="dash-stat__value">{completed.length}</p>
                        <p className="dash-stat__hint">Out of {investments.length} investments</p>
                      </div>
                    </div>
                    <div className="dash-card dash-stat">
                      <div>
                        <p className="dash-stat__label">Invested in Them</p>
                        <p className="dash-stat__value">{peso(totals.invested)}</p>
                        <p className="dash-stat__hint">
                          Includes {peso(totals.commission)} FarmVest commission at{' '}
                          {COMMISSION_RATE * 100}%
                        </p>
                      </div>
                    </div>
                  </>
                ) : tab === 'Cancelled Projects' ? (
                  <>
                    <div className="dash-card dash-stat">
                      <div>
                        <p className="dash-stat__label">Projects Cancelled</p>
                        <p className="dash-stat__value">{cancelled.length}</p>
                        <p className="dash-stat__hint">Out of {investments.length} investments</p>
                      </div>
                    </div>
                    <div className="dash-card dash-stat">
                      <div>
                        <p className="dash-stat__label">Amount Involved</p>
                        <p className="dash-stat__value">{peso(totals.cancelled)}</p>
                        <p className="dash-stat__hint">
                          Whatever had not been released is still held
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="dash-card dash-stat">
                      <div>
                        <p className="dash-stat__label">Agreements Signed</p>
                        <p className="dash-stat__value">{signed.length}</p>
                        <p className="dash-stat__hint">One per investment</p>
                      </div>
                    </div>
                    <div className="dash-card dash-stat">
                      <div>
                        <p className="dash-stat__label">Value Committed</p>
                        <p className="dash-stat__value">{peso(totals.signedTotal)}</p>
                        <p className="dash-stat__hint">Across every signed agreement</p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">{tab}</h2>
                  <span className="dash-stat__hint">{SUBTITLE[tab]}</span>
                </div>

                <div className="dash-panel__body dash-table-wrap">
                  {tab !== 'Signed Agreements' ? (
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
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr>
                            <td colSpan={7}>
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
                          rows.map((row) => (
                            <tr key={row.investments_id}>
                              <td>{orNone(row.projects?.title)}</td>
                              <td className="dash-table__muted">{orNone(row.projects?.category)}</td>
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
                        {rows.length === 0 ? (
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
                          rows.map((row) => (
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
                </div>
              </section>
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default InvestorReports;
