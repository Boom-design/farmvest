import { useCallback, useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import DashboardHeader from '../../components/DashboardHeader';
import EmptyState from '../../components/EmptyState';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { orNone, peso, pillClass, shortDate } from '../../lib/format';
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

type ProjectRow = {
  projects_id: string;
  title: string;
  category: string | null;
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

const TABS = ['My Projects', 'My Rentals'] as const;
type Tab = (typeof TABS)[number];

const SUBTITLE: Record<Tab, string> = {
  'My Projects': 'Projects that reached Completed, and what each one raised.',
  'My Rentals': 'Bookings that were returned and closed, and what each one cost.',
};

/** Inclusive rental length, so a same-day booking still costs one day. */
const dayCount = (start: string, end: string) =>
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;

/**
 * Farm Owner reports.
 *
 * My Projects and My Rentals are working screens: they carry the statuses that
 * still need something done about them, and each row there has a button. A
 * completed project or a closed booking has neither, so it lives here instead,
 * read-only, with the totals that only make sense once the work is finished.
 *
 * This is the farm owner's half of what the Admin sees under Reports, narrowed
 * by row level security to the account's own rows.
 */
const FarmOwnerReports: React.FC = () => {
  const { profile } = useAuth();

  const [tab, setTab] = useState<Tab>('My Projects');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    const [projectsRes, rentalsRes] = await Promise.all([
      supabase
        .from('projects')
        .select(
          'projects_id, title, category, funding_goal, current_funding, status, created_at'
        )
        .eq('customers_id', profile.users_id)
        .eq('status', 'Completed')
        .order('created_at', { ascending: false }),
      supabase
        .from('rentals')
        .select(
          'rentals_id, start_date, end_date, status, returned_at, return_condition, damage_charge, equipment(name, unit_code, type, price_per_day)'
        )
        .eq('customers_id', profile.users_id)
        .eq('status', 'Completed')
        .order('end_date', { ascending: false }),
    ]);

    const failed = [projectsRes, rentalsRes].find((result) => result.error);
    if (failed?.error) {
      setError(failed.error.message);
      setLoading(false);
      return;
    }

    setProjects((projectsRes.data ?? []) as ProjectRow[]);
    setRentals((rentalsRes.data ?? []) as unknown as RentalRow[]);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const rentalFee = (rental: RentalRow) =>
    dayCount(rental.start_date, rental.end_date) * Number(rental.equipment?.price_per_day ?? 0);

  const totals = useMemo(() => {
    const raised = projects.reduce((sum, project) => sum + Number(project.current_funding), 0);
    const goal = projects.reduce((sum, project) => sum + Number(project.funding_goal), 0);
    const fees = rentals.reduce((sum, rental) => sum + rentalFee(rental), 0);
    // Damage is reimbursement for a repair, so it is counted apart from the fee
    // rather than folded into it, the same way the Admin revenue table does it.
    const damage = rentals.reduce((sum, rental) => sum + Number(rental.damage_charge ?? 0), 0);
    const days = rentals.reduce(
      (sum, rental) => sum + dayCount(rental.start_date, rental.end_date),
      0
    );

    return { raised, goal, fees, damage, days };
  }, [projects, rentals]);

  const fundedPercent = (project: ProjectRow) => {
    if (!project.funding_goal) return 0;
    return Math.round((Number(project.current_funding) / Number(project.funding_goal)) * 100);
  };

  return (
    <IonPage>
      <DashboardHeader
        title="Reports"
        subtitle="Your completed projects and closed equipment bookings."
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
                {value} ({value === 'My Projects' ? projects.length : rentals.length})
              </button>
            ))}
          </div>

          {loading ? (
            <Skeleton />
          ) : (
            <>
              <div className="dash-grid dash-grid--stats">
                {tab === 'My Projects' ? (
                  <>
                    <div className="dash-card dash-stat">
                      <div>
                        <p className="dash-stat__label">Projects Completed</p>
                        <p className="dash-stat__value">{projects.length}</p>
                        <p className="dash-stat__hint">Across every category</p>
                      </div>
                    </div>
                    <div className="dash-card dash-stat">
                      <div>
                        <p className="dash-stat__label">Total Raised</p>
                        <p className="dash-stat__value">{peso(totals.raised)}</p>
                        <p className="dash-stat__hint">Of {peso(totals.goal)} sought</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="dash-card dash-stat">
                      <div>
                        <p className="dash-stat__label">Bookings Closed</p>
                        <p className="dash-stat__value">{rentals.length}</p>
                        <p className="dash-stat__hint">{totals.days} rental days in total</p>
                      </div>
                    </div>
                    <div className="dash-card dash-stat">
                      <div>
                        <p className="dash-stat__label">Rental Fees Paid</p>
                        <p className="dash-stat__value">{peso(totals.fees)}</p>
                        <p className="dash-stat__hint">
                          {totals.damage > 0
                            ? `Plus ${peso(totals.damage)} in damage charges`
                            : 'No damage charges'}
                        </p>
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
                  {tab === 'My Projects' ? (
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Category</th>
                          <th>Funding Goal</th>
                          <th>Amount Raised</th>
                          <th>Funded</th>
                          <th>Date Posted</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.length === 0 ? (
                          <tr>
                            <td colSpan={7}>
                              <EmptyState
                                title="No completed project yet"
                                message="A project appears here once it reaches Completed."
                                size={120}
                              />
                            </td>
                          </tr>
                        ) : (
                          projects.map((project) => (
                            <tr key={project.projects_id}>
                              <td>{project.title}</td>
                              <td className="dash-table__muted">{orNone(project.category)}</td>
                              <td className="dash-table__muted">{peso(project.funding_goal)}</td>
                              <td>{peso(project.current_funding)}</td>
                              <td className="dash-table__muted">{fundedPercent(project)}%</td>
                              <td className="dash-table__muted">{shortDate(project.created_at)}</td>
                              <td>
                                <span className={pillClass(project.status)}>{project.status}</span>
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
                          rentals.map((rental) => (
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

export default FarmOwnerReports;
