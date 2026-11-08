import { useCallback, useEffect, useMemo, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import {
  alertCircleOutline,
  arrowDownOutline,
  arrowUpOutline,
  cashOutline,
  constructOutline,
  documentTextOutline,
  peopleOutline,
  trendingUpOutline,
  walletOutline,
} from 'ionicons/icons';
import DashboardHeader from '../components/DashboardHeader';
import EmptyState from '../components/EmptyState';
import Pager, { usePaged } from '../components/Pager';
import RevenueChart from '../components/charts/RevenueChart';
import EquipmentRevenueChart from '../components/charts/EquipmentRevenueChart';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { peso, shortDate } from '../lib/format';
import {
  COMMISSION_RATE,
  commissionOf,
  isEarning,
  monthKey,
  monthlyRevenueForYear,
  rentalFee,
  revenueByEquipment,
  revenueTrend,
  revenueYears,
  type InvestmentForRevenue,
  type RentalForRevenue,
} from '../lib/revenue';
import '../theme/dashboard.css';
import Skeleton from '../components/Skeleton';

type RentalRow = RentalForRevenue & {
  rentals_id: string;
  created_at: string;
  customers: { users: { name: string } | null } | null;
};

type InvestmentRow = InvestmentForRevenue & {
  investments_id: string;
  customers: { users: { name: string } | null } | null;
  projects: { title: string } | null;
};

type UserRow = {
  users_id: string;
  name: string;
  user_type: string;
  created_at: string;
};

type ReportRow = {
  reports_id: string;
  reason: string;
  status: string;
  created_at: string;
};

type EquipmentRow = {
  equipment_id: string;
  availability_status: string;
};

type Activity = {
  id: string;
  title: string;
  meta: string;
  amount?: string;
  tone: 'green' | 'gold' | 'slate' | 'red';
  icon: string;
  at: string;
};

const AdminDashboard: React.FC = () => {
  const { profile } = useAuth();

  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  /** Releases to farm owners: the only point at which commission is earned. */
  const [releases, setReleases] = useState<InvestmentForRevenue[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);

    const [rentalsRes, investmentsRes, usersRes, reportsRes, equipmentRes, releasesRes] = await Promise.all([
      supabase
        .from('rentals')
        .select(
          'rentals_id, start_date, end_date, status, created_at, customers(users(name)), equipment(name, unit_code, price_per_day)'
        )
        .order('created_at', { ascending: false }),
      supabase
        .from('investments')
        .select('investments_id, amount, created_at, customers(users(name)), projects(title)')
        .order('created_at', { ascending: false }),
      supabase
        .from('users')
        .select('users_id, name, user_type, created_at')
        .neq('user_type', 'Admin')
        .order('created_at', { ascending: false }),
      supabase
        .from('reports')
        .select('reports_id, reason, status, created_at')
        .order('created_at', { ascending: false }),
      supabase.from('equipment').select('equipment_id, availability_status'),
      // Commission is earned when a succeeded project's repayment is confirmed:
      // 5% of what it raised, dated by that confirmation.
      supabase
        .from('repayments')
        .select('reviewed_at, projects(current_funding)')
        .eq('status', 'Confirmed'),
    ]);

    const failed = [rentalsRes, investmentsRes, usersRes, reportsRes, equipmentRes, releasesRes].find(
      (result) => result.error
    );

    if (failed?.error) {
      setError(failed.error.message);
    } else {
      setRentals((rentalsRes.data ?? []) as unknown as RentalRow[]);
      setInvestments((investmentsRes.data ?? []) as unknown as InvestmentRow[]);
      setUsers((usersRes.data ?? []) as UserRow[]);
      setReports((reportsRes.data ?? []) as ReportRow[]);
      setEquipment((equipmentRes.data ?? []) as EquipmentRow[]);
      setReleases(
        (
          (releasesRes.data ?? []) as unknown as {
            reviewed_at: string | null;
            projects: { current_funding: number } | null;
          }[]
        )
          .filter((row) => row.reviewed_at)
          .map((row) => ({
            amount: Number(row.projects?.current_funding ?? 0),
            created_at: row.reviewed_at as string,
          }))
      );
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const years = useMemo(() => revenueYears(rentals, releases), [rentals, releases]);

  const revenueSeries = useMemo(
    () => monthlyRevenueForYear(rentals, releases, year),
    [rentals, releases, year]
  );

  // Hidden until two months actually carry transactions.
  const trend = useMemo(() => revenueTrend(revenueSeries), [revenueSeries]);

  const perEquipment = useMemo(() => revenueByEquipment(rentals, 5), [rentals]);

  const stats = useMemo(() => {
    const thisMonth = monthKey(new Date());

    const rentalThisMonth = rentals
      .filter((rental) => isEarning(rental) && monthKey(rental.start_date) === thisMonth)
      .reduce((sum, rental) => sum + rentalFee(rental), 0);

    const commissionThisMonth = releases
      .filter((release) => monthKey(release.created_at) === thisMonth)
      .reduce((sum, release) => sum + commissionOf(release.amount), 0);

    const releasedThisMonth = releases
      .filter((release) => monthKey(release.created_at) === thisMonth)
      .reduce((sum, release) => sum + Number(release.amount ?? 0), 0);

    const activeRentals = rentals.filter((rental) => rental.status === 'Active').length;
    const rented = equipment.filter((unit) => unit.availability_status === 'Rented').length;
    const utilisation = equipment.length ? Math.round((rented / equipment.length) * 100) : 0;
    const openReports = reports.filter((report) => report.status === 'Open').length;

    return [
      {
        label: 'Revenue This Month',
        value: peso(rentalThisMonth + commissionThisMonth),
        hint: 'Rental fees plus commission',
        icon: trendingUpOutline,
        tone: 'green',
      },
      {
        label: 'Rental Income',
        value: peso(rentalThisMonth),
        hint: 'FarmVest owns the fleet, so this is the full fee',
        icon: walletOutline,
        tone: 'green',
      },
      {
        label: 'Investment Commission',
        value: peso(commissionThisMonth),
        hint: `${Math.round(COMMISSION_RATE * 100)}% of ${peso(releasedThisMonth)} from projects repaid this month`,
        icon: cashOutline,
        tone: 'gold',
      },
      {
        label: 'Fleet Utilisation',
        value: `${utilisation}%`,
        hint: `${rented} of ${equipment.length} units rented out`,
        icon: constructOutline,
        tone: 'slate',
      },
      {
        label: 'Active Rentals',
        value: String(activeRentals),
        hint: 'Equipment currently in the field',
        icon: constructOutline,
        tone: 'green',
      },
      {
        label: 'Open Reports',
        value: String(openReports),
        hint: 'Disputes waiting for review',
        icon: alertCircleOutline,
        tone: openReports > 0 ? 'red' : 'slate',
      },
    ];
  }, [rentals, releases, equipment, reports]);

  /** One merged feed, so the Admin sees what happened in order rather than per table. */
  const activity = useMemo<Activity[]>(() => {
    const entries: Activity[] = [];

    investments.forEach((investment) => {
      entries.push({
        id: `investment-${investment.investments_id}`,
        title: 'Investment received',
        meta: `${investment.customers?.users?.name ?? 'Investor'} funded ${investment.projects?.title ?? 'a project'}`,
        amount: peso(investment.amount),
        tone: 'green',
        icon: arrowUpOutline,
        at: investment.created_at,
      });
    });

    rentals.forEach((rental) => {
      const label =
        rental.status === 'Completed'
          ? 'Rental completed'
          : rental.status === 'Active'
            ? 'Rental ongoing'
            : rental.status === 'Cancelled'
              ? 'Booking cancelled'
              : 'Booking requested';

      entries.push({
        id: `rental-${rental.rentals_id}`,
        title: label,
        meta: `${rental.equipment?.name ?? 'Equipment'} - ${rental.customers?.users?.name ?? 'Farm Owner'}`,
        amount: isEarning(rental) ? `+ ${peso(rentalFee(rental))}` : undefined,
        tone: rental.status === 'Cancelled' ? 'red' : isEarning(rental) ? 'green' : 'gold',
        icon: rental.status === 'Cancelled' ? arrowDownOutline : constructOutline,
        at: rental.created_at,
      });
    });

    users.forEach((user) => {
      entries.push({
        id: `user-${user.users_id}`,
        title: 'New account registered',
        meta: `${user.name || 'Unnamed'} - ${user.user_type}`,
        tone: 'slate',
        icon: peopleOutline,
        at: user.created_at,
      });
    });

    reports.forEach((report) => {
      entries.push({
        id: `report-${report.reports_id}`,
        title: 'Report filed',
        meta: report.reason,
        tone: 'red',
        icon: documentTextOutline,
        at: report.created_at,
      });
    });

    return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 8);
  }, [investments, rentals, users, reports]);

  // Five entries a page, so the feed does not run the length of the dashboard.
  const pagedActivity = usePaged(activity);

  return (
    <IonPage>
      <DashboardHeader
        title="Admin Dashboard"
        subtitle="Revenue from equipment rentals and investment commission, and what happened today."
        accountName={profile?.name || 'System Administrator'}

      />

      <IonContent className="dash-content">
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
                <div>
                  <section className="dash-panel">
                    <div className="dash-panel__head">
                      <div className="dash-panel__heading">
                        <h2 className="dash-panel__title">Revenue by Month</h2>
                        {trend && (
                          <span className={`dash-trend dash-trend--${trend.direction}`}>
                            <IonIcon
                              icon={trend.direction === 'up' ? arrowUpOutline : arrowDownOutline}
                            />
                            {trend.percent}% vs {trend.fromLabel}
                          </span>
                        )}
                      </div>

                      <select
                        className="dash-select dash-select--compact"
                        value={year}
                        onChange={(event) => setYear(Number(event.target.value))}
                        aria-label="Filter revenue by year"
                      >
                        {years.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="dash-panel__body">
                      <RevenueChart data={revenueSeries} />
                    </div>
                  </section>

                  <section className="dash-panel">
                    <div className="dash-panel__head">
                      <h2 className="dash-panel__title">Rental Income by Unit</h2>
                      <span className="dash-stat__hint">Top 5 earners</span>
                    </div>
                    <div className="dash-panel__body">
                      <EquipmentRevenueChart data={perEquipment} />
                    </div>
                  </section>
                </div>

                <div>
                  <section className="dash-panel">
                    <div className="dash-panel__head">
                      <h2 className="dash-panel__title">Recent Activity</h2>
                    </div>
                    <div className="dash-panel__body">
                      {activity.length === 0 ? (
                        <EmptyState
                          title="Nothing has happened yet"
                          message="Registrations, bookings and investments show up here."
                          size={130}
                        />
                      ) : (
                        pagedActivity.slice.map((entry) => (
                          <div className="dash-row" key={entry.id}>
                            <div className={`dash-row__icon dash-stat__icon--${entry.tone}`}>
                              <IonIcon icon={entry.icon} />
                            </div>
                            <div>
                              <p className="dash-row__title">{entry.title}</p>
                              <p className="dash-row__meta">{entry.meta}</p>
                            </div>
                            <div className="dash-row__trailing">
                              <p style={{ margin: 0 }}>{shortDate(entry.at)}</p>
                              {entry.amount && (
                                <p className="dash-row__title" style={{ margin: 0 }}>
                                  {entry.amount}
                                </p>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                      <Pager {...pagedActivity} />
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default AdminDashboard;
