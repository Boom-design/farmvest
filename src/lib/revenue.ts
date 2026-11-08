/**
 * Revenue rules for the two FarmVest business models.
 *
 *   Equipment rental  - FarmVest owns the fleet, so the whole rental fee is revenue.
 *   Livestock investment - FarmVest is only the marketplace, so revenue is the
 *                          commission on each funded amount.
 */

/**
 * FarmVest's commission on a livestock project: 5% of what was raised. It is
 * earned only when the project succeeds. The raise goes to the farm owner in
 * full; once the harvest is sold, the farm owner pays it on top of what the
 * investors are owed, and FarmVest keeps it when it confirms that repayment.
 * A cancelled or failed project earns nothing.
 */
export const COMMISSION_RATE = 0.05;

/** The commission a project owes FarmVest on its repayment. */
export const projectCommission = (raised: number | string) =>
  Math.round(Number(raised ?? 0) * COMMISSION_RATE * 100) / 100;

/**
 * Smallest amount an investor may commit.
 *
 * Mirrors the floor enforced inside invest_in_project. The database is the
 * authority: this copy exists so the form can say no before the round trip,
 * and both must move together if the figure ever changes.
 *
 * An amount below this is accepted only when it exactly closes the project's
 * remaining balance, so a final small gap is never left unreachable.
 */
export const MINIMUM_INVESTMENT = 500;

export type RentalForRevenue = {
  start_date: string;
  end_date: string;
  status: string;
  equipment: { name: string; unit_code: string | null; price_per_day: number } | null;
};

export type InvestmentForRevenue = {
  amount: number;
  created_at: string;
};

/** Statuses that count as earned revenue; a pending or cancelled booking does not. */
const EARNING_STATUSES = ['Active', 'Completed'];

/** Rental days are inclusive of both the start and the end date. */
export const rentalDays = (rental: { start_date: string; end_date: string }) => {
  const start = new Date(rental.start_date).getTime();
  const end = new Date(rental.end_date).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
};

export const rentalFee = (rental: RentalForRevenue) =>
  rentalDays(rental) * Number(rental.equipment?.price_per_day ?? 0);

export const isEarning = (rental: RentalForRevenue) => EARNING_STATUSES.includes(rental.status);

export const commissionOf = (amount: number | string) => Number(amount ?? 0) * COMMISSION_RATE;

/** `YYYY-MM` key used to bucket rows into months. */
export const monthKey = (value: string | Date) => {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const monthLabel = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-PH', { month: 'short' });
};

/** The last `count` months, oldest first, ending with the current month. */
export const recentMonths = (count: number): string[] => {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    return monthKey(date);
  });
};

export type MonthlyRevenue = {
  key: string;
  label: string;
  rental: number;
  commission: number;
  total: number;
};

/**
 * Revenue per month. A rental is recognised on its start date, an investment
 * commission on the date FarmVest confirmed the project's repayment.
 */
export const monthlyRevenue = (
  rentals: RentalForRevenue[],
  investments: InvestmentForRevenue[],
  months: number = 6
): MonthlyRevenue[] => {
  const keys = recentMonths(months);
  const rows = new Map<string, MonthlyRevenue>(
    keys.map((key) => [key, { key, label: monthLabel(key), rental: 0, commission: 0, total: 0 }])
  );

  rentals.filter(isEarning).forEach((rental) => {
    const row = rows.get(monthKey(rental.start_date));
    if (row) row.rental += rentalFee(rental);
  });

  investments.forEach((investment) => {
    const row = rows.get(monthKey(investment.created_at));
    if (row) row.commission += commissionOf(investment.amount);
  });

  return keys.map((key) => {
    const row = rows.get(key) as MonthlyRevenue;
    return { ...row, total: row.rental + row.commission };
  });
};

/** Every month of one calendar year, January first. */
export const monthlyRevenueForYear = (
  rentals: RentalForRevenue[],
  investments: InvestmentForRevenue[],
  year: number
): MonthlyRevenue[] => {
  const rows: MonthlyRevenue[] = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, '0')}`;
    return { key, label: monthLabel(key), rental: 0, commission: 0, total: 0 };
  });

  const indexOf = (value: string) => {
    const [rowYear, rowMonth] = monthKey(value).split('-').map(Number);
    return rowYear === year ? rowMonth - 1 : -1;
  };

  rentals.filter(isEarning).forEach((rental) => {
    const index = indexOf(rental.start_date);
    if (index >= 0) rows[index].rental += rentalFee(rental);
  });

  investments.forEach((investment) => {
    const index = indexOf(investment.created_at);
    if (index >= 0) rows[index].commission += commissionOf(investment.amount);
  });

  return rows.map((row) => ({ ...row, total: row.rental + row.commission }));
};

/** Years that have any transaction, newest first, always including this year. */
export const revenueYears = (
  rentals: RentalForRevenue[],
  investments: InvestmentForRevenue[]
): number[] => {
  const years = new Set<number>([new Date().getFullYear()]);

  rentals.filter(isEarning).forEach((rental) => years.add(new Date(rental.start_date).getFullYear()));
  investments.forEach((investment) => years.add(new Date(investment.created_at).getFullYear()));

  return [...years].sort((a, b) => b - a);
};

/**
 * Change against the previous month with activity.
 *
 * Returns null when there is nothing to compare, so the trend arrow stays hidden
 * until real transactions exist.
 */
export const revenueTrend = (
  rows: MonthlyRevenue[]
): { direction: 'up' | 'down'; percent: number; fromLabel: string } | null => {
  const withActivity = rows.filter((row) => row.total > 0);
  if (withActivity.length < 2) return null;

  const latest = withActivity[withActivity.length - 1];
  const previous = withActivity[withActivity.length - 2];
  if (previous.total === 0) return null;

  const change = ((latest.total - previous.total) / previous.total) * 100;
  if (Math.round(change) === 0) return null;

  return {
    direction: change > 0 ? 'up' : 'down',
    percent: Math.abs(Math.round(change)),
    fromLabel: previous.label,
  };
};

/** Total earned rental fee per equipment unit, highest first. */
export const revenueByEquipment = (rentals: RentalForRevenue[], limit = 5) => {
  const totals = new Map<string, number>();

  rentals.filter(isEarning).forEach((rental) => {
    const name = rental.equipment
      ? `${rental.equipment.name}${rental.equipment.unit_code ? ` (${rental.equipment.unit_code})` : ''}`
      : 'Unknown unit';
    totals.set(name, (totals.get(name) ?? 0) + rentalFee(rental));
  });

  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
};
