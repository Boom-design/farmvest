import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import {
  barChartOutline,
  cashOutline,
  leafOutline,
  sparklesOutline,
  timeOutline,
  warningOutline,
} from 'ionicons/icons';
import DashboardHeader from '../components/DashboardHeader';
import EmptyState from '../components/EmptyState';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { orNone, peso, pillClass, shortDate } from '../lib/format';
import { isReleasedStage } from '../lib/funding';
import { releaseLabel } from '../lib/funding';
import { categoryLook } from '../lib/categories';
import { loadAdvisory } from '../lib/weather';
import {
  matchLabel,
  matchTone,
  recommend,
  type FarmOutlook,
  type Recommendation,
  type TrackRecord,
} from '../lib/recommend';
import '../theme/dashboard.css';
import './InvestorDashboard.css';
import Skeleton from '../components/Skeleton';

type InvestmentRow = {
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
  } | null;
};

type OpenProject = {
  projects_id: string;
  customers_id: string;
  title: string;
  category: string | null;
  funding_goal: number;
  current_funding: number;
};

type OwnerRow = {
  customers_id: string;
  name: string;
  farm_city: string | null;
  farm_province: string | null;
};

type UpdateRow = {
  progress_updates_id: string;
  projects_id: string;
  captured_at: string;
  notes: string | null;
};

/** Days without a progress update before a funded project is worth flagging. */
const STALE_DAYS = 14;

/** How many recommendations the dashboard puts forward before Browse Projects. */
const TOP_PICKS = 2;

type InvestorDashboardProps = {
  /**
   * Render only the body, with no page chrome. Used by the merged customer
   * dashboard, which supplies one IonPage and one header for both halves.
   */
  embedded?: boolean;
};

const InvestorDashboard: React.FC<InvestorDashboardProps> = ({ embedded = false }) => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  const [openProjects, setOpenProjects] = useState<OpenProject[]>([]);
  const [owners, setOwners] = useState<Map<string, OwnerRow>>(new Map());
  const [records, setRecords] = useState<Map<string, TrackRecord>>(new Map());
  const [outlooks, setOutlooks] = useState<Map<string, FarmOutlook>>(new Map());
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [picks, setPicks] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    const [investRes, openRes, prefsRes] = await Promise.all([
      supabase
        .from('investments')
        .select(
          'investments_id, amount, milestone_stage, created_at, projects(projects_id, customers_id, title, category, status)'
        )
        .eq('customers_id', profile.users_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('projects')
        .select(
          'projects_id, customers_id, title, category, funding_goal, current_funding'
        )
        .eq('status', 'Open')
        // What to fund next never means your own.
        .neq('customers_id', profile.users_id),
      supabase
        .from('customers')
        .select('investment_budget')
        .eq('customers_id', profile.users_id)
        .maybeSingle(),
    ]);

    const failed = [investRes, openRes].find((result) => result.error);
    if (failed?.error) {
      setError(failed.error.message);
      setLoading(false);
      return;
    }

    const invested = (investRes.data ?? []) as unknown as InvestmentRow[];
    const open = (openRes.data ?? []) as OpenProject[];

    setInvestments(invested);
    setOpenProjects(open);

    // Owners of both sets: the funded projects need a name for the trail, the
    // open ones need a name and a town for the recommendation.
    const ownerIds = Array.from(
      new Set([
        ...invested.map((row) => row.projects?.customers_id).filter(Boolean),
        ...open.map((row) => row.customers_id),
      ] as string[])
    );

    if (ownerIds.length > 0) {
      const [{ data: directory }, { data: trackRecords }] = await Promise.all([
        supabase
          .from('customer_directory')
          .select('customers_id, name, farm_city, farm_province')
          .in('customers_id', ownerIds),
        supabase
          .from('customer_track_record')
          .select(
            'customers_id, completed_projects, total_projects, last_update_at, progress_update_count, average_rating, rating_count, open_disputes'
          )
          .in('customers_id', ownerIds),
      ]);

      const ownerRows = (directory ?? []) as OwnerRow[];
      setOwners(new Map(ownerRows.map((row) => [row.customers_id, row])));

      const recordMap = new Map(
        (trackRecords ?? []).map((row) => [
          (row as { customers_id: string }).customers_id,
          row as unknown as TrackRecord,
        ])
      );
      setRecords(recordMap);

      // One forecast per town, as on Browse Projects. allSettled so a town the
      // geocoder does not know costs that farm its weather line, not the page
      // its recommendations.
      const byPlace = new Map<string, string[]>();
      ownerRows.forEach((row) => {
        if (!row.farm_city || !row.farm_province) return;
        const key = `${row.farm_city}|${row.farm_province}`;
        byPlace.set(key, [...(byPlace.get(key) ?? []), row.customers_id]);
      });

      const forecasts = await Promise.allSettled(
        Array.from(byPlace.keys()).map(async (key) => {
          const [city, province] = key.split('|');
          return { key, advisory: await loadAdvisory(city, province) };
        })
      );

      const nextOutlooks = new Map<string, FarmOutlook>();
      forecasts.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        const { key, advisory } = result.value;
        (byPlace.get(key) ?? []).forEach((ownerId) =>
          nextOutlooks.set(ownerId, {
            level: advisory.level,
            leadTimeDays: advisory.leadTimeDays,
            place: advisory.matchedPlace,
          })
        );
      });
      setOutlooks(nextOutlooks);

      if (open.length > 0) {
        setPicks(
          recommend(
            {
              budget:
                prefsRes.data?.investment_budget != null
                  ? Number(prefsRes.data.investment_budget)
                  : null,
            },
            open.map((row) => ({
              projectsId: row.projects_id,
              farmOwnersId: row.customers_id,
              category: row.category ?? 'Other',
              fundingGoal: Number(row.funding_goal),
              currentFunding: Number(row.current_funding),
            })),
            recordMap,
            nextOutlooks
          )
        );
      }
    }

    // The trail is limited by the read policy to projects this account funded,
    // so no filter is needed beyond the project list itself.
    const fundedIds = Array.from(
      new Set(invested.map((row) => row.projects?.projects_id).filter(Boolean) as string[])
    );

    if (fundedIds.length > 0) {
      const { data: updateRows } = await supabase
        .from('progress_updates')
        .select('progress_updates_id, projects_id, captured_at, notes')
        .in('projects_id', fundedIds)
        .order('captured_at', { ascending: false })
        .limit(20);

      setUpdates((updateRows ?? []) as UpdateRow[]);
    }

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const total = investments.reduce((sum, row) => sum + Number(row.amount), 0);
    const backed = new Set(investments.map((row) => row.projects?.projects_id)).size;
    const held = investments.filter((row) => !isReleasedStage(row.milestone_stage)).length;

    return [
      {
        label: 'Total Invested',
        value: peso(total),
        hint: `Across ${backed} project${backed === 1 ? '' : 's'}`,
        icon: cashOutline,
        tone: 'gold' as const,
      },
      {
        label: 'Projects Backed',
        value: String(backed),
        hint: `${investments.length} investment${investments.length === 1 ? '' : 's'} in total`,
        icon: barChartOutline,
        tone: 'green' as const,
      },
      {
        label: 'Open to Browse',
        value: String(openProjects.length),
        hint: 'Projects taking funding right now',
        icon: leafOutline,
        tone: 'slate' as const,
      },
    ];
  }, [investments, openProjects]);

  /** Funded projects that have gone quiet, and farms with weather coming. */
  const alerts = useMemo(() => {
    const items: { text: string; tone: 'warn' | 'info' }[] = [];

    const funded = new Map<string, { title: string; ownerId: string }>();
    investments.forEach((row) => {
      if (row.projects) {
        funded.set(row.projects.projects_id, {
          title: row.projects.title,
          ownerId: row.projects.customers_id,
        });
      }
    });

    funded.forEach((project, projectId) => {
      const latest = updates.find((row) => row.projects_id === projectId);
      const days = latest
        ? Math.floor((Date.now() - new Date(latest.captured_at).getTime()) / 86_400_000)
        : null;

      if (days === null) {
        items.push({ text: `${project.title} has never posted a progress update.`, tone: 'warn' });
      } else if (days >= STALE_DAYS) {
        items.push({
          text: `${project.title} has not posted an update in ${days} days.`,
          tone: 'warn',
        });
      }

      const outlook = outlooks.get(project.ownerId);
      if (outlook && outlook.level >= 1) {
        items.push({
          text: `Signal No. ${outlook.level} expected at ${outlook.place} in ${outlook.leadTimeDays} day${outlook.leadTimeDays === 1 ? '' : 's'}, where ${project.title} is.`,
          tone: outlook.level >= 2 ? 'warn' : 'info',
        });
      }
    });

    return items;
  }, [investments, updates, outlooks]);

  const projectTitle = (id: string) =>
    investments.find((row) => row.projects?.projects_id === id)?.projects?.title ?? 'Project';

  const shortlist = useMemo(
    () => picks.filter((pick) => pick.score >= 35).slice(0, TOP_PICKS),
    [picks]
  );

  const body = (
    <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          {loading ? (
            <Skeleton />
          ) : (
            <>
              <div className="dash-grid dash-grid--stats">
                {stats.map((stat) => (
                  <div className="dash-card dash-stat" key={stat.label}>
                    <div className={`dash-stat__icon dash-stat__icon--${stat.tone}`}>
                      <IonIcon icon={stat.icon} />
                    </div>
                    <div>
                      <p className="dash-stat__label">{stat.label}</p>
                      <p className="dash-stat__value">{stat.value}</p>
                      <p className="dash-stat__hint">{stat.hint}</p>
                    </div>
                  </div>
                ))}
              </div>

              {alerts.length > 0 && (
                <section className="invest-alerts">
                  <div className="invest-alerts__head">
                    <IonIcon icon={warningOutline} />
                    <h2>Worth your attention</h2>
                  </div>

                  <ul>
                    {alerts.slice(0, 4).map((alert) => (
                      <li key={alert.text} className={`invest-alerts--${alert.tone}`}>
                        {alert.text}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {shortlist.length > 0 && (
                <section className="dash-panel">
                  <div className="dash-panel__head">
                    <h2 className="dash-panel__title">
                      <IonIcon icon={sparklesOutline} className="invest-spark" /> Recommended For
                      You
                    </h2>
                    <button
                      type="button"
                      className="dash-panel__link"
                      onClick={() => navigate('/app/browse')}
                    >
                      See all
                    </button>
                  </div>

                  <div className="dash-panel__body">
                    {shortlist.map((pick) => {
                      const project = openProjects.find(
                        (row) => row.projects_id === pick.projectsId
                      );
                      if (!project) return null;

                      const look = categoryLook(project.category);
                      const owner = owners.get(project.customers_id);

                      return (
                        <div className="dash-row" key={pick.projectsId}>
                          <div
                            className="dash-row__icon invest-emoji"
                            style={{ background: look.tint }}
                          >
                            {look.emoji}
                          </div>

                          <div>
                            <p className="dash-row__title">{project.title}</p>
                            <p className="dash-row__meta">
                              {owner?.name ?? 'Farm owner'}
                              {owner?.farm_city ? ` — ${owner.farm_city}` : ''} ·{' '}
                              {peso(project.current_funding)} of {peso(project.funding_goal)}
                            </p>
                            {/* The top reason, so the row says why it is here
                                rather than only that it is. */}
                            <p className="dash-row__meta invest-reason">
                              {pick.reasons[0]?.text}
                            </p>
                          </div>

                          <div className="dash-row__trailing">
                            <span className={`invest-score invest-score--${matchTone(pick.score)}`}>
                              {pick.score}
                            </span>
                            <p className="dash-stat__hint">{matchLabel(pick.score)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <div className="dash-columns">
                <section className="dash-panel">
                  <div className="dash-panel__head">
                    <h2 className="dash-panel__title">My Investments</h2>
                    <button
                      type="button"
                      className="dash-panel__link"
                      onClick={() => navigate('/app/investments')}
                    >
                      Manage
                    </button>
                  </div>

                  <div className="dash-panel__body">
                    {investments.length === 0 ? (
                      <EmptyState
                        title="You have not invested yet"
                        message="Browse the open projects to find a farm to fund."
                        size={120}
                      />
                    ) : (
                      investments.slice(0, 5).map((row) => (
                        <div className="dash-row" key={row.investments_id}>
                          <div className="dash-row__icon dash-stat__icon--gold">
                            <IonIcon icon={cashOutline} />
                          </div>
                          <div>
                            <p className="dash-row__title">{orNone(row.projects?.title)}</p>
                            <p className="dash-row__meta">
                              {peso(row.amount)} · {releaseLabel(row.milestone_stage)} ·{' '}
                              {shortDate(row.created_at)}
                            </p>
                          </div>
                          <div className="dash-row__trailing">
                            <span className={pillClass(row.projects?.status ?? '')}>
                              {orNone(row.projects?.status)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="dash-panel">
                  <div className="dash-panel__head">
                    <h2 className="dash-panel__title">Latest Farm Updates</h2>
                    <button
                      type="button"
                      className="dash-panel__link"
                      onClick={() => navigate('/app/monitoring')}
                    >
                      Monitor
                    </button>
                  </div>

                  <div className="dash-panel__body">
                    {updates.length === 0 ? (
                      <EmptyState
                        title="No progress update yet"
                        message="Photos from the farms you funded appear here."
                        size={110}
                      />
                    ) : (
                      updates.slice(0, 5).map((update) => (
                        <div className="dash-row" key={update.progress_updates_id}>
                          <div className="dash-row__icon dash-stat__icon--green">
                            <IonIcon icon={timeOutline} />
                          </div>
                          <div>
                            <p className="dash-row__title">{projectTitle(update.projects_id)}</p>
                            <p className="dash-row__meta">{orNone(update.notes)}</p>
                          </div>
                          <div className="dash-row__trailing">
                            {shortDate(update.captured_at)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
    </div>
  );

  if (embedded) return body;

  return (
    <IonPage>
      <DashboardHeader
        title="Investor Dashboard"
        subtitle="Your portfolio, what to fund next, and how the farms you backed are doing."
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">{body}</IonContent>
    </IonPage>
  );
};

export default InvestorDashboard;
