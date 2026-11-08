import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import {
  barChartOutline,
  cashOutline,
  constructOutline,
  leafOutline,
  partlySunnyOutline,
} from 'ionicons/icons';
import DashboardHeader from '../components/DashboardHeader';
import EmptyState from '../components/EmptyState';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { orNone, peso, pillClass, shortDate } from '../lib/format';
import '../theme/dashboard.css';
import Skeleton from '../components/Skeleton';

type ProjectRow = {
  projects_id: string;
  title: string;
  funding_goal: number;
  current_funding: number;
  status: string;
  created_at: string;
};

type RentalRow = {
  rentals_id: string;
  start_date: string;
  end_date: string;
  status: string;
  created_at: string;
  equipment: { name: string; price_per_day: number } | null;
};

type UpdateRow = {
  progress_updates_id: string;
  projects_id: string;
  captured_at: string;
  notes: string | null;
};

/** Statuses that still tie up a booking, so they count as ongoing. */
const ONGOING_RENTAL = ['Pending', 'Confirmed', 'Active', 'Rescheduled', 'On Hold - Weather Advisory'];

type FarmOwnerDashboardProps = {
  /**
   * Render only the body, with no page chrome. Used by the merged customer
   * dashboard, which supplies one IonPage and one header for both halves.
   */
  embedded?: boolean;
};

const FarmOwnerDashboard: React.FC<FarmOwnerDashboardProps> = ({ embedded = false }) => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    const [projectsRes, rentalsRes] = await Promise.all([
      supabase
        .from('projects')
        .select('projects_id, title, funding_goal, current_funding, status, created_at')
        .eq('customers_id', profile.users_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('rentals')
        .select('rentals_id, start_date, end_date, status, created_at, equipment(name, price_per_day)')
        .eq('customers_id', profile.users_id)
        .order('created_at', { ascending: false }),
    ]);

    const failed = [projectsRes, rentalsRes].find((result) => result.error);

    if (failed?.error) {
      setError(failed.error.message);
      setLoading(false);
      return;
    }

    const projectRows = (projectsRes.data ?? []) as ProjectRow[];
    setProjects(projectRows);
    setRentals((rentalsRes.data ?? []) as unknown as RentalRow[]);

    if (projectRows.length > 0) {
      const { data: updateData } = await supabase
        .from('progress_updates')
        .select('progress_updates_id, projects_id, captured_at, notes')
        .in(
          'projects_id',
          projectRows.map((row) => row.projects_id)
        )
        .order('captured_at', { ascending: false })
        .limit(5);

      setUpdates((updateData ?? []) as UpdateRow[]);
    } else {
      setUpdates([]);
    }

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const raised = projects.reduce((sum, project) => sum + Number(project.current_funding), 0);
    const ongoing = rentals.filter((rental) => ONGOING_RENTAL.includes(rental.status));
    const awaiting = projects.filter((project) => project.status === 'Pending Approval').length;

    return [
      {
        label: 'My Projects',
        value: String(projects.length),
        hint: `${awaiting} waiting for approval`,
        icon: leafOutline,
        tone: 'green' as const,
      },
      {
        label: 'Funds Raised',
        value: peso(raised),
        hint: 'Across every posted project',
        icon: cashOutline,
        tone: 'gold' as const,
      },
      {
        label: 'Ongoing Rentals',
        value: String(ongoing.length),
        hint: `${rentals.length} booking${rentals.length === 1 ? '' : 's'} in total`,
        icon: constructOutline,
        tone: 'slate' as const,
      },
    ];
  }, [projects, rentals]);

  const fundedPercent = (project: ProjectRow) => {
    if (!project.funding_goal) return 0;
    return Math.min(
      100,
      Math.round((Number(project.current_funding) / Number(project.funding_goal)) * 100)
    );
  };

  const projectTitle = (id: string) =>
    projects.find((project) => project.projects_id === id)?.title ?? 'Project';

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

              <div className="dash-columns">
                <section className="dash-panel">
                  <div className="dash-panel__head">
                    <h2 className="dash-panel__title">My Projects</h2>
                    <button
                      type="button"
                      className="dash-panel__link"
                      onClick={() => navigate('/app/projects')}
                    >
                      Manage
                    </button>
                  </div>

                  <div className="dash-panel__body">
                    {projects.length === 0 ? (
                      <EmptyState
                        title="No project posted yet"
                        message="Post one to start raising funds."
                        size={120}
                      />
                    ) : (
                      projects.slice(0, 5).map((project) => (
                        <div className="dash-row" key={project.projects_id}>
                          <div className="dash-row__icon dash-stat__icon--green">
                            <IonIcon icon={leafOutline} />
                          </div>
                          <div>
                            <p className="dash-row__title">{project.title}</p>
                            <p className="dash-row__meta">
                              {peso(project.current_funding)} of {peso(project.funding_goal)} (
                              {fundedPercent(project)}%)
                            </p>
                          </div>
                          <div className="dash-row__trailing">
                            <span className={pillClass(project.status)}>{project.status}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="dash-panel">
                  <div className="dash-panel__head">
                    <h2 className="dash-panel__title">Latest Updates</h2>
                    <button
                      type="button"
                      className="dash-panel__link"
                      onClick={() => navigate('/app/progress')}
                    >
                      Post
                    </button>
                  </div>

                  <div className="dash-panel__body">
                    {updates.length === 0 ? (
                      <EmptyState title="No progress updates yet" size={110} />
                    ) : (
                      updates.map((update) => (
                        <div className="dash-row" key={update.progress_updates_id}>
                          <div className="dash-row__icon dash-stat__icon--gold">
                            <IonIcon icon={barChartOutline} />
                          </div>
                          <div>
                            <p className="dash-row__title">{projectTitle(update.projects_id)}</p>
                            <p className="dash-row__meta">{orNone(update.notes)}</p>
                          </div>
                          <div className="dash-row__trailing">{shortDate(update.captured_at)}</div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>

              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">Equipment Rentals</h2>
                  <button
                    type="button"
                    className="dash-panel__link"
                    onClick={() => navigate('/app/equipment')}
                  >
                    Rent Equipment
                  </button>
                </div>

                <div className="dash-panel__body">
                  {rentals.length === 0 ? (
                    <EmptyState
                      title="No bookings yet"
                      message="Browse the FarmVest fleet to reserve a unit."
                      size={120}
                    />
                  ) : (
                    rentals.slice(0, 5).map((rental) => (
                      <div className="dash-row" key={rental.rentals_id}>
                        <div className="dash-row__icon dash-stat__icon--slate">
                          <IonIcon icon={constructOutline} />
                        </div>
                        <div>
                          <p className="dash-row__title">{orNone(rental.equipment?.name)}</p>
                          <p className="dash-row__meta">
                            {shortDate(rental.start_date)} to {shortDate(rental.end_date)}
                          </p>
                        </div>
                        <div className="dash-row__trailing">
                          <span className={pillClass(rental.status)}>{rental.status}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">Weather Advisory</h2>
                  <button
                    type="button"
                    className="dash-panel__link"
                    onClick={() => navigate('/app/weather')}
                  >
                    Open
                  </button>
                </div>

                <div className="dash-panel__body">
                  <div className="dash-row">
                    <div className="dash-row__icon dash-stat__icon--gold">
                      <IonIcon icon={partlySunnyOutline} />
                    </div>
                    <div>
                      <p className="dash-row__title">Seven-day outlook for your farm</p>
                      <p className="dash-row__meta">
                        Storm preparation steps, which equipment is worth booking this week, and
                        what to plant this season.
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
    </div>
  );

  if (embedded) return body;

  return (
    <IonPage>
      <DashboardHeader
        title="Farm Owner Dashboard"
        subtitle="Your livestock projects, equipment rentals, and weather advisories."
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">{body}</IonContent>
    </IonPage>
  );
};

export default FarmOwnerDashboard;
