/** Display helpers shared by the dashboard screens. */

/** The word an empty field shows, in the UI and in the database alike. */
export const NONE = 'None';

/**
 * Anything the user left blank reads as None rather than an empty cell. The
 * optional text columns already hold the literal 'None'; this also covers the
 * columns that stay nullable because their type cannot hold it (dates, numbers
 * and file paths).
 */
export const orNone = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return NONE;

  const text = String(value).trim();
  return text === '' ? NONE : text;
};

/** True when a stored value is a real answer rather than a blank marker. */
export const hasValue = (value: string | null | undefined): value is string =>
  Boolean(value) && value !== NONE && String(value).trim() !== '';

export const peso = (value: number | string | null | undefined) =>
  `₱${Number(value ?? 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const shortDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : NONE;

/** Maps any status string in the system to one of the pill styles. */
export const pillClass = (status: string) => {
  switch (status) {
    case 'Available':
    case 'Approved':
    case 'Active':
    case 'Confirmed':
    case 'Completed':
    case 'Resolved':
    case 'Funded':
      return 'dash-pill dash-pill--success';
    case 'Rented':
    case 'Pending':
    case 'Pending Approval':
    case 'Reviewing':
    case 'On Hold - Weather Advisory':
    case 'Rescheduled':
    case 'In Progress':
    case 'Open':
      return 'dash-pill dash-pill--gold';
    case 'Maintenance':
    case 'Cancelled':
    case 'Rejected':
    case 'Inactive':
      return 'dash-pill dash-pill--danger';
    default:
      return 'dash-pill dash-pill--slate';
  }
};

/**
 * The one row of an embedded relation, however PostgREST returned it.
 *
 * A relation backed by a unique key (liquidations.projects_id,
 * investor_payouts.investments_id) comes back as a single object rather than a
 * list, so reading it with [0] silently gave undefined. This reads either.
 */
export const firstOf = <T,>(value: T[] | T | null | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : (value ?? undefined);
