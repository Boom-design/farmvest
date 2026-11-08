import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { orNone, pillClass, shortDate } from '../../../lib/format';
import ReportTable, { type ReportColumn } from './ReportTable';
import { applyFilters, type ReportFilters } from './reportFilters';
import { reportedId, reporterId, type CaseRow, type PartyLite } from './DisputesTab';

type CaseHistoryTabProps = {
  filters: ReportFilters;
  onError: (message: string | null) => void;
};

/** Cases that have been decided. Read-only: a closed case is a record. */
const CaseHistoryTab: React.FC<CaseHistoryTabProps> = ({ filters, onError }) => {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [parties, setParties] = useState<Record<string, PartyLite>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [caseRes, partyRes] = await Promise.all([
      supabase
        .from('reports')
        .select(
          'reports_id, projects_id, category, reason, status, resolution, resolved_at, resolved_by, created_at, reporter_customers_id, reporter_customers_id, reported_customers_id, reported_customers_id'
        )
        .in('status', ['Resolved', 'Dismissed'])
        .order('resolved_at', { ascending: false }),
      supabase.from('users').select('users_id, name, user_type').neq('user_type', 'Admin'),
    ]);

    const failed = [caseRes, partyRes].find((result) => result.error);

    if (failed?.error) {
      onError(failed.error.message);
    } else {
      setCases((caseRes.data ?? []) as unknown as CaseRow[]);
      setParties(
        Object.fromEntries(
          ((partyRes.data ?? []) as unknown as PartyLite[]).map((party) => [party.users_id, party])
        )
      );
    }

    setLoading(false);
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: ReportColumn<CaseRow>[] = useMemo(
    () => [
      { label: 'Date Filed', text: (row) => shortDate(row.created_at) },
      { label: 'Date Closed', text: (row) => shortDate(row.resolved_at) },
      { label: 'Reported Account', text: (row) => orNone(parties[reportedId(row)]?.name) },
      { label: 'Filed By', text: (row) => orNone(parties[reporterId(row)]?.name) },
      { label: 'Case Category', text: (row) => orNone(row.category) },
      { label: 'Complaint', text: (row) => orNone(row.reason) },
      {
        label: 'Outcome',
        text: (row) => row.status,
        render: (row) => <span className={pillClass(row.status)}>{row.status}</span>,
      },
      { label: 'Resolution Notes', text: (row) => orNone(row.resolution) },
      { label: 'Closed By', text: (row) => orNone(row.resolved_by) },
    ],
    [parties]
  );

  const visible = useMemo(
    () => applyFilters(cases, columns, filters, (row) => row.resolved_at ?? row.created_at),
    [cases, columns, filters]
  );

  return (
    <ReportTable
      columns={columns}
      rows={visible}
      rowKey={(row) => row.reports_id}
      loading={loading}
      emptyMessage="No case has been decided yet."
      exportName="case-history"
    />
  );
};

export default CaseHistoryTab;
