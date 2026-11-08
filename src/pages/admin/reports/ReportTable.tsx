import type { ReactNode } from 'react';
import { IonIcon } from '@ionic/react';
import { downloadOutline } from 'ionicons/icons';
import EmptyState from '../../../components/EmptyState';
import Pager, { usePaged } from '../../../components/Pager';
import '../../../theme/dashboard.css';
import Skeleton from '../../../components/Skeleton';

/**
 * One column of a report table.
 *
 * `text` is the plain value: it fills the cell, feeds the search box and is what
 * lands in the exported CSV. `render` is only needed when a cell holds markup,
 * such as a status pill or a button.
 */
export type ReportColumn<T> = {
  label: string;
  text: (row: T) => string;
  render?: (row: T) => ReactNode;
  /** Rendered in the footer, so a money column can carry its own total. */
  total?: (rows: T[]) => string;
};

type ReportTableProps<T> = {
  columns: ReportColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Shown in place of rows when there is nothing to list. */
  emptyMessage: string;
  /** File name for the CSV, without the extension. */
  exportName: string;
};

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Reports are printed and handed in, so every table can leave as a CSV. */
const downloadCsv = <T,>(columns: ReportColumn<T>[], rows: T[], name: string) => {
  const header = columns.map((column) => csvCell(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => csvCell(column.text(row))).join(','));

  const totals = columns.some((column) => column.total)
    ? [columns.map((column) => csvCell(column.total ? column.total(rows) : '')).join(',')]
    : [];

  const csv = [header, ...body, ...totals].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));

  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();

  URL.revokeObjectURL(url);
};

/**
 * The table every report tab draws. It is rendered even with no rows, so a tab
 * always shows the column labels that belong to it.
 */
const ReportTable = <T,>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyMessage,
  exportName,
}: ReportTableProps<T>) => {
  const hasTotals = columns.some((column) => column.total);
  // Five rows to a page. Totals and the CSV export still cover every row.
  const paged = usePaged(rows, exportName);

  if (loading) {
    return (
      <Skeleton />
    );
  }

  return (
    <>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.label}>{column.label}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyMessage} size={120} />
                </td>
              </tr>
            ) : (
              paged.slice.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td key={column.label}>
                      {column.render ? column.render(row) : column.text(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>

          {hasTotals && rows.length > 0 && (
            <tfoot>
              <tr className="dash-table__totals">
                {columns.map((column) => (
                  <td key={column.label}>{column.total ? column.total(rows) : ''}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Pager {...paged} />

      <div className="dash-actions dash-actions--end">
        <button
          type="button"
          className="dash-btn dash-btn--slate"
          disabled={rows.length === 0}
          onClick={() => downloadCsv(columns, rows, exportName)}
        >
          <IonIcon icon={downloadOutline} /> Export CSV
        </button>
      </div>
    </>
  );
};

export default ReportTable;
