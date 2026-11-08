import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { peso } from '../../../lib/format';
import {
  COMMISSION_RATE,
  monthlyRevenueForYear,
  revenueYears,
  type InvestmentForRevenue,
  type MonthlyRevenue,
  type RentalForRevenue,
} from '../../../lib/revenue';
import ReportTable, { type ReportColumn } from './ReportTable';
import '../../../theme/dashboard.css';

type RevenueTabProps = {
  onError: (message: string | null) => void;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/**
 * The money view: commission on investments plus the full fee on rentals, month
 * by month. The date range in the toolbar does not apply here — a revenue report
 * is read one calendar year at a time, so the year picker below governs it.
 */
const RevenueTab: React.FC<RevenueTabProps> = ({ onError }) => {
  const [rentals, setRentals] = useState<RentalForRevenue[]>([]);
  const [investments, setInvestments] = useState<InvestmentForRevenue[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [rentalsRes, investmentsRes] = await Promise.all([
      supabase
        .from('rentals')
        .select('start_date, end_date, status, equipment(name, unit_code, price_per_day)'),
      // Commission is earned only when a project succeeds: 5% of what it
      // raised, kept when FarmVest confirms the farm owner's repayment and
      // dated by that confirmation. A cancelled or failed project earns nothing.
      supabase
        .from('repayments')
        .select('reviewed_at, projects(current_funding)')
        .eq('status', 'Confirmed'),
    ]);

    const failed = [rentalsRes, investmentsRes].find((result) => result.error);

    if (failed?.error) {
      onError(failed.error.message);
    } else {
      setRentals((rentalsRes.data ?? []) as unknown as RentalForRevenue[]);
      setInvestments(
        (
          (investmentsRes.data ?? []) as unknown as {
            reviewed_at: string | null;
            projects: { current_funding: number } | null;
          }[]
        )
          .filter((row) => row.reviewed_at)
          .map(
            (row): InvestmentForRevenue => ({
              amount: Number(row.projects?.current_funding ?? 0),
              created_at: row.reviewed_at as string,
            })
          )
      );
    }

    setLoading(false);
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const years = useMemo(() => revenueYears(rentals, investments), [rentals, investments]);

  const rows = useMemo(
    () => monthlyRevenueForYear(rentals, investments, year),
    [rentals, investments, year]
  );

  const columns: ReportColumn<MonthlyRevenue>[] = [
    { label: 'Month', text: (row) => row.label, total: () => 'Year Total' },
    {
      label: `Investment Commission (${COMMISSION_RATE * 100}%)`,
      text: (row) => peso(row.commission),
      total: (all) => peso(sum(all.map((row) => row.commission))),
    },
    {
      label: 'Equipment Rental Fees',
      text: (row) => peso(row.rental),
      total: (all) => peso(sum(all.map((row) => row.rental))),
    },
    {
      label: 'Total Revenue',
      text: (row) => peso(row.total),
      total: (all) => peso(sum(all.map((row) => row.total))),
    },
  ];

  return (
    <>
      <div className="dash-toolbar-row">
        <div className="dash-field">
          <label htmlFor="revenue-year">Calendar Year</label>
          <select
            id="revenue-year"
            className="dash-select dash-select--compact"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          >
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ReportTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        loading={loading}
        emptyMessage="No revenue has been recorded for this year."
        exportName={`revenue-summary-${year}`}
      />

      <p className="dash-note">
        A rental is counted on its start date once the booking is Active or Completed; an
        investment commission is counted on the date the investment was made.
      </p>
    </>
  );
};

export default RevenueTab;
