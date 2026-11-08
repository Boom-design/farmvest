/** Shared filtering for the report tabs: one date range and one search box. */

import type { ReportColumn } from './ReportTable';

export type ReportFilters = {
  /** Inclusive ISO dates, or an empty string for "no bound". */
  from: string;
  to: string;
  search: string;
};

export const emptyFilters: ReportFilters = { from: '', to: '', search: '' };

/** Compares the date part only, so a timestamp on the "to" day still counts. */
export const withinRange = (value: string | null | undefined, filters: ReportFilters) => {
  if (!value) return true;

  const day = value.slice(0, 10);

  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;

  return true;
};

/** Searches every column the table already knows how to print. */
export const matchesSearch = <T,>(row: T, columns: ReportColumn<T>[], search: string) => {
  const term = search.trim().toLowerCase();
  if (!term) return true;

  return columns
    .map((column) => column.text(row))
    .join(' ')
    .toLowerCase()
    .includes(term);
};

export const applyFilters = <T,>(
  rows: T[],
  columns: ReportColumn<T>[],
  filters: ReportFilters,
  dateOf: (row: T) => string | null | undefined
) => rows.filter((row) => withinRange(dateOf(row), filters) && matchesSearch(row, columns, filters.search));
