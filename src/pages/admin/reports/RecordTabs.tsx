/**
 * The read-only halves of the Reports page.
 *
 * These four tables are records, not queues: nothing here can be acted on, and
 * everything is already finished. The pages under Livestock Projects, Investment
 * Transactions, Rental Bookings and Equipment Fleet remain the places where work
 * actually happens.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { orNone, peso, shortDate } from '../../../lib/format';
import { releaseLabel } from '../../../lib/funding';
import { commissionOf, rentalDays, rentalFee } from '../../../lib/revenue';
import ReportTable, { type ReportColumn } from './ReportTable';
import { applyFilters, type ReportFilters } from './reportFilters';

type TabProps = {
  filters: ReportFilters;
  onError: (message: string | null) => void;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/* ------------------------------------------------------------------ projects */

type CompletedProject = {
  projects_id: string;
  title: string;
  funding_goal: number;
  current_funding: number;
  created_at: string;
  customers: { users: { name: string } | null } | null;
  investments: { amount: number }[];
};

export const CompletedProjectsTab: React.FC<TabProps> = ({ filters, onError }) => {
  const [rows, setRows] = useState<CompletedProject[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select(
        'projects_id, title, funding_goal, current_funding, created_at, customers(users(name)), investments(amount)'
      )
      .eq('status', 'Completed')
      .order('created_at', { ascending: false });

    if (error) onError(error.message);
    else setRows((data ?? []) as unknown as CompletedProject[]);

    setLoading(false);
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: ReportColumn<CompletedProject>[] = [
    { label: 'Project', text: (row) => orNone(row.title) },
    { label: 'Farm Owner', text: (row) => orNone(row.customers?.users?.name) },
    {
      label: 'Funding Goal',
      text: (row) => peso(row.funding_goal),
      total: (all) => peso(sum(all.map((row) => Number(row.funding_goal)))),
    },
    {
      label: 'Total Raised',
      text: (row) => peso(row.current_funding),
      total: (all) => peso(sum(all.map((row) => Number(row.current_funding)))),
    },
    {
      label: 'Investors',
      text: (row) => String(row.investments?.length ?? 0),
      total: (all) => `${sum(all.map((row) => row.investments?.length ?? 0))} total`,
    },
    {
      label: 'Commission Earned',
      text: (row) => peso(commissionOf(row.current_funding)),
      total: (all) => peso(sum(all.map((row) => commissionOf(row.current_funding)))),
    },
    { label: 'Date Posted', text: (row) => shortDate(row.created_at) },
  ];

  const visible = useMemo(
    () => applyFilters(rows, columns, filters, (row) => row.created_at),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filters]
  );

  return (
    <ReportTable
      columns={columns}
      rows={visible}
      rowKey={(row) => row.projects_id}
      loading={loading}
      emptyMessage="No livestock project has been completed yet."
      exportName="completed-livestock-projects"
    />
  );
};

/* --------------------------------------------------------------- investments */

type InvestmentRecord = {
  investments_id: string;
  amount: number;
  milestone_stage: string;
  created_at: string;
  customers: { users: { name: string; email: string } | null } | null;
  projects: {
    title: string;
    status: string;
    customers: { users: { name: string } | null } | null;
  } | null;
};

export const InvestmentsTab: React.FC<TabProps> = ({ filters, onError }) => {
  const [rows, setRows] = useState<InvestmentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('investments')
      .select(
        'investments_id, amount, milestone_stage, created_at, customers(users(name, email)), projects(title, status, customers(users(name)))'
      )
      .order('created_at', { ascending: false });

    if (error) onError(error.message);
    else setRows((data ?? []) as unknown as InvestmentRecord[]);

    setLoading(false);
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  // Every row in the investments table is a transaction that went through, so
  // there is no "failed" state to filter out here.
  const columns: ReportColumn<InvestmentRecord>[] = [
    { label: 'Date', text: (row) => shortDate(row.created_at) },
    { label: 'Investor', text: (row) => orNone(row.customers?.users?.name) },
    { label: 'Email', text: (row) => orNone(row.customers?.users?.email) },
    { label: 'Project', text: (row) => orNone(row.projects?.title) },
    { label: 'Farm Owner', text: (row) => orNone(row.projects?.customers?.users?.name) },
    { label: 'Funds', text: (row) => releaseLabel(row.milestone_stage) },
    {
      label: 'Amount Invested',
      text: (row) => peso(row.amount),
      total: (all) => peso(sum(all.map((row) => Number(row.amount)))),
    },
    {
      // Earned only on a project that succeeded; nothing on the others.
      label: 'Commission (5%)',
      text: (row) => (row.projects?.status === 'Completed' ? peso(commissionOf(row.amount)) : 'Not earned'),
      total: (all) =>
        peso(sum(all.filter((row) => row.projects?.status === 'Completed').map((row) => commissionOf(row.amount)))),
    },
  ];

  const visible = useMemo(
    () => applyFilters(rows, columns, filters, (row) => row.created_at),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filters]
  );

  return (
    <ReportTable
      columns={columns}
      rows={visible}
      rowKey={(row) => row.investments_id}
      loading={loading}
      emptyMessage="No investment transaction has been recorded yet."
      exportName="investment-transactions"
    />
  );
};

/* ------------------------------------------------------------------- rentals */

type RentalRecord = {
  rentals_id: string;
  start_date: string;
  end_date: string;
  status: string;
  returned_at: string | null;
  return_condition: string;
  damage_notes: string | null;
  damage_charge: number;
  customers: { users: { name: string } | null } | null;
  equipment: {
    name: string;
    unit_code: string | null;
    price_per_day: number;
  } | null;
};

export const RentalsTab: React.FC<TabProps> = ({ filters, onError }) => {
  const [rows, setRows] = useState<RentalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('rentals')
      .select(
        'rentals_id, start_date, end_date, status, returned_at, return_condition, damage_notes, damage_charge, customers(users(name)), equipment(name, unit_code, price_per_day)'
      )
      .eq('status', 'Completed')
      .order('end_date', { ascending: false });

    if (error) onError(error.message);
    else setRows((data ?? []) as unknown as RentalRecord[]);

    setLoading(false);
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: ReportColumn<RentalRecord>[] = [
    { label: 'Equipment', text: (row) => orNone(row.equipment?.name) },
    { label: 'Unit Code', text: (row) => orNone(row.equipment?.unit_code) },
    { label: 'Farm Owner', text: (row) => orNone(row.customers?.users?.name) },
    { label: 'Start Date', text: (row) => shortDate(row.start_date) },
    { label: 'Return Date', text: (row) => shortDate(row.end_date) },
    {
      label: 'Days Rented',
      text: (row) => String(rentalDays(row)),
      total: (all) => `${sum(all.map((row) => rentalDays(row)))} days`,
    },
    { label: 'Rate Per Day', text: (row) => peso(row.equipment?.price_per_day ?? 0) },
    {
      label: 'Rental Fee Earned',
      text: (row) => peso(rentalFee(row)),
      total: (all) => peso(sum(all.map((row) => rentalFee(row)))),
    },
    { label: 'Date Returned', text: (row) => shortDate(row.returned_at) },
    { label: 'Condition On Return', text: (row) => orNone(row.return_condition) },
    { label: 'Inspection Notes', text: (row) => orNone(row.damage_notes) },
    {
      // Reimbursement for a repair, so it is reported beside the fee and never
      // added into it.
      label: 'Damage Charged',
      text: (row) => peso(row.damage_charge),
      total: (all) => peso(sum(all.map((row) => Number(row.damage_charge ?? 0)))),
    },
  ];

  const visible = useMemo(
    () => applyFilters(rows, columns, filters, (row) => row.end_date),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filters]
  );

  return (
    <ReportTable
      columns={columns}
      rows={visible}
      rowKey={(row) => row.rentals_id}
      loading={loading}
      emptyMessage="No equipment rental has been completed yet."
      exportName="completed-rental-bookings"
    />
  );
};

/* --------------------------------------------------------------- maintenance */

type MaintenanceRecord = {
  maintenance_logs_id: string;
  service_date: string;
  service_type: string;
  description: string | null;
  cost: number | null;
  next_service_date: string | null;
  equipment: { name: string; unit_code: string | null } | null;
};

export const MaintenanceTab: React.FC<TabProps> = ({ filters, onError }) => {
  const [rows, setRows] = useState<MaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('maintenance_logs')
      .select(
        'maintenance_logs_id, service_date, service_type, description, cost, next_service_date, equipment(name, unit_code)'
      )
      .order('service_date', { ascending: false });

    if (error) onError(error.message);
    else setRows((data ?? []) as unknown as MaintenanceRecord[]);

    setLoading(false);
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: ReportColumn<MaintenanceRecord>[] = [
    { label: 'Equipment', text: (row) => orNone(row.equipment?.name) },
    { label: 'Unit Code', text: (row) => orNone(row.equipment?.unit_code) },
    { label: 'Service Date', text: (row) => shortDate(row.service_date) },
    { label: 'Service Type', text: (row) => orNone(row.service_type) },
    { label: 'Work Done', text: (row) => orNone(row.description) },
    {
      label: 'Maintenance Cost',
      text: (row) => (row.cost === null ? orNone(null) : peso(row.cost)),
      total: (all) => peso(sum(all.map((row) => Number(row.cost ?? 0)))),
    },
    { label: 'Next Service Due', text: (row) => shortDate(row.next_service_date) },
  ];

  const visible = useMemo(
    () => applyFilters(rows, columns, filters, (row) => row.service_date),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filters]
  );

  return (
    <ReportTable
      columns={columns}
      rows={visible}
      rowKey={(row) => row.maintenance_logs_id}
      loading={loading}
      emptyMessage="No maintenance has been logged yet."
      exportName="equipment-maintenance-logs"
    />
  );
};
