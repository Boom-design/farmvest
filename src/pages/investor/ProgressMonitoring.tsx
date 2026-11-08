import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { imageOutline, locationOutline, timeOutline } from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import EmptyState from '../../components/EmptyState';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { orNone, peso, pillClass, shortDate } from '../../lib/format';
import { compareLiquidation, type CostLine, type Liquidation } from '../../lib/liquidation';
import '../../theme/dashboard.css';
import './ProgressMonitoring.css';
import Skeleton from '../../components/Skeleton';
import LiquidationReceipts from '../../components/LiquidationReceipts';

type UpdateRow = {
  progress_updates_id: string;
  projects_id: string;
  photo_url: string | null;
  captured_at: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
};

type FundedProject = {
  projects_id: string;
  title: string;
  status: string;
  estimated_heads: number | null;
  expected_mortality_percent: number;
  expected_price_per_head: number | null;
  cost_breakdown: CostLine[];
};

/** Days without an update before the gap is worth pointing out. */
const STALE_DAYS = 14;

const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/**
 * Progress Monitoring.
 *
 * The evidence trail for the projects this investor funded: timestamped,
 * geotagged photos the farm owner posted. The row level security policy on
 * progress_updates already limits these to projects the caller invested in.
 *
 * An empty trail is the finding, not a blank screen, so a project with no
 * update in a fortnight is called out rather than left to be noticed.
 */
const ProgressMonitoring: React.FC = () => {
  const { profile } = useAuth();
  const location = useLocation();

  const [projects, setProjects] = useState<FundedProject[]>([]);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  /** The liquidation each funded project closed with, once the farm owner filed it. */
  const [reports, setReports] = useState<Map<string, Liquidation>>(new Map());
  const [selected, setSelected] = useState('All');

  // A notification opens the page on one project: ?project=<id>. Read again on
  // every visit, since the page stays mounted when only the query changes.
  useEffect(() => {
    const project = new URLSearchParams(location.search).get('project');
    if (project) setSelected(project);
  }, [location.search]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    const { data: invested, error: investError } = await supabase
      .from('investments')
      .select('projects(projects_id, title, status, estimated_heads, expected_mortality_percent, expected_price_per_head, cost_breakdown)')
      .eq('customers_id', profile.users_id);

    if (investError) {
      setError(investError.message);
      setLoading(false);
      return;
    }

    const rows = (invested ?? []) as unknown as { projects: FundedProject | null }[];

    // One entry per project: several investments in the same farm are still one
    // trail to follow.
    const unique = new Map<string, FundedProject>();
    rows.forEach((row) => {
      if (row.projects) unique.set(row.projects.projects_id, row.projects);
    });

    const funded = Array.from(unique.values()).sort((a, b) => a.title.localeCompare(b.title));
    setProjects(funded);

    if (funded.length > 0) {
      const { data: updateRows, error: updateError } = await supabase
        .from('progress_updates')
        .select('progress_updates_id, projects_id, photo_url, captured_at, latitude, longitude, notes')
        .in(
          'projects_id',
          funded.map((project) => project.projects_id)
        )
        .order('captured_at', { ascending: false });

      if (updateError) setError(updateError.message);
      else setUpdates((updateRows ?? []) as UpdateRow[]);

      const { data: liquidationRows } = await supabase
        .from('liquidations')
        .select('projects_id, heads_stocked, mortality, mortality_reason, heads_harvested, sales_amount, expenses, receipts, notes, status, admin_notes, submitted_at')
        .in('projects_id', funded.map((project) => project.projects_id));
      setReports(
        new Map(
          ((liquidationRows ?? []) as (Liquidation & { projects_id: string })[]).map((row) => [row.projects_id, row])
        )
      );
    } else {
      setUpdates([]);
    }

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const titleOf = (id: string) =>
    projects.find((project) => project.projects_id === id)?.title ?? 'Project';

  const visible = useMemo(
    () => (selected === 'All' ? updates : updates.filter((row) => row.projects_id === selected)),
    [updates, selected]
  );

  /** Projects whose most recent update is old, or which have none at all. */
  const quiet = useMemo(
    () =>
      projects.filter((project) => {
        const latest = updates.find((row) => row.projects_id === project.projects_id);
        if (!latest) return true;
        return daysSince(latest.captured_at) >= STALE_DAYS;
      }),
    [projects, updates]
  );

  return (
    <IonPage>
      <DashboardHeader
        title="Progress Monitoring"
        subtitle="Timestamped, geotagged photos from the farms you funded."
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          {loading ? (
            <Skeleton />
          ) : projects.length === 0 ? (
            <section className="dash-panel">
              <div className="dash-panel__body">
                <EmptyState
                  title="Nothing to monitor yet"
                  message="Once you fund a project, the farm owner's progress photos appear here."
                  size={140}
                />
              </div>
            </section>
          ) : (
            <>
              {quiet.length > 0 && (
                <section className="monitor-alert">
                  <IonIcon icon={timeOutline} />
                  <div>
                    <p className="monitor-alert__title">
                      {quiet.length} project{quiet.length === 1 ? '' : 's'} has gone quiet
                    </p>
                    <p className="monitor-alert__body">
                      No progress update in {STALE_DAYS} days or more:{' '}
                      {quiet.map((project) => project.title).join(', ')}. Ask the farm owner, or
                      report it to the administrator if it continues.
                    </p>
                  </div>
                </section>
              )}

              <div className="dash-toolbar-row">
                {['All', ...projects.map((project) => project.projects_id)].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`dash-tab${selected === value ? ' dash-tab--active' : ''}`}
                    onClick={() => setSelected(value)}
                  >
                    {value === 'All' ? `All (${updates.length})` : titleOf(value)}
                  </button>
                ))}
              </div>

              {(() => {
                const project = projects.find((row) => row.projects_id === selected);
                const report = project ? reports.get(project.projects_id) : undefined;
                if (!project || !report) return null;
                const result = compareLiquidation(project, report);

                return (
                  <section className="dash-panel">
                    <div className="dash-panel__head">
                      <h2 className="dash-panel__title">Liquidation Report</h2>
                      <span className={pillClass(report.status === 'Accepted' ? 'Completed' : 'Pending')}>
                        {report.status === 'Accepted' ? 'Accepted by FarmVest' : 'Under review'}
                      </span>
                    </div>
                    <div className="dash-panel__body">
                      <table className="dash-table">
                        <tbody>
                          <tr>
                            <td>Head stocked</td>
                            <td>
                              {report.heads_stocked}
                              {project.estimated_heads ? ` of ${project.estimated_heads} planned` : ''}
                            </td>
                          </tr>
                          <tr>
                            <td>Mortality</td>
                            <td>
                              {report.mortality} head ({result.mortalityPercent.toFixed(1)}% against{' '}
                              {result.expectedMortality}% expected)
                              {report.mortality > 0 && <p className="dash-row__meta">{report.mortality_reason}</p>}
                            </td>
                          </tr>
                          <tr>
                            <td>Harvested and sold</td>
                            <td>
                              {report.heads_harvested} head for {peso(report.sales_amount)}
                              {report.heads_harvested > 0 && (
                                <p className="dash-row__meta">
                                  {peso(Number(report.sales_amount) / report.heads_harvested)} per head
                                  {project.expected_price_per_head
                                    ? `, against ${peso(project.expected_price_per_head)} expected`
                                    : ''}
                                </p>
                              )}
                            </td>
                          </tr>
                          <tr>
                            <td>Spending</td>
                            <td>
                              {peso(result.spent)} of {peso(result.planned)} budgeted
                              {report.receipts.length > 0 && ` · ${report.receipts.length} receipt(s) on file`}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <p className="dash-field-label" style={{ marginTop: 14 }}>
                        Receipts
                      </p>
                      <LiquidationReceipts paths={report.receipts} />
                      <p className="dash-stat__hint">
                        Your return is fixed by your agreement, so it does not depend on these
                        figures. They show the money and the animals are accounted for.
                      </p>
                    </div>
                  </section>
                );
              })()}

              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">Progress Updates</h2>
                  <span className="dash-stat__hint">
                    {visible.length} update{visible.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="dash-panel__body">
                  {visible.length === 0 ? (
                    <EmptyState
                      title="No progress update posted yet"
                      message="The farm owner has not uploaded a photo for this project."
                      size={130}
                    />
                  ) : (
                    <div className="monitor-grid">
                      {visible.map((update) => (
                        <article className="monitor-card" key={update.progress_updates_id}>
                          <div className="monitor-card__art">
                            {update.photo_url ? (
                              <img src={update.photo_url} alt="" loading="lazy" />
                            ) : (
                              <IonIcon icon={imageOutline} />
                            )}
                          </div>

                          <div className="monitor-card__body">
                            <p className="monitor-card__title">{titleOf(update.projects_id)}</p>
                            <p className="monitor-card__notes">{orNone(update.notes)}</p>

                            <div className="monitor-card__meta">
                              <span>
                                <IonIcon icon={timeOutline} /> {shortDate(update.captured_at)}
                              </span>

                              {update.latitude != null && update.longitude != null && (
                                <span>
                                  <IonIcon icon={locationOutline} />
                                  {update.latitude.toFixed(4)}, {update.longitude.toFixed(4)}
                                </span>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
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

export default ProgressMonitoring;
