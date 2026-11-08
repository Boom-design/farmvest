import { useEffect, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';

/** Rows per page across the admin and customer report tables. */
export const PAGE_SIZE = 5;

/**
 * One page of a list.
 *
 * Goes back to the first page when the list changes length or `resetKey`
 * changes -- a new filter, search or tab -- so a page number is never left
 * pointing past the end of a shorter list.
 */
export const usePaged = <T,>(rows: T[], resetKey: unknown = null, size = PAGE_SIZE) => {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));

  useEffect(() => {
    setPage(1);
  }, [rows.length, resetKey]);

  const current = Math.min(page, pages);

  return {
    page: current,
    pages,
    setPage,
    slice: rows.slice((current - 1) * size, current * size),
    total: rows.length,
    from: rows.length === 0 ? 0 : (current - 1) * size + 1,
    to: Math.min(current * size, rows.length),
  };
};

type PagerProps = {
  page: number;
  pages: number;
  total: number;
  from: number;
  to: number;
  setPage: (page: number) => void;
};

/** Previous, page numbers, next. Hidden when everything fits on one page. */
const Pager: React.FC<PagerProps> = ({ page, pages, total, from, to, setPage }) => {
  if (pages <= 1) return null;

  return (
    <nav className="dash-pager" aria-label="Pages">
      <span className="dash-pager__count">
        {from}-{to} of {total}
      </span>

      <button
        type="button"
        className="dash-btn dash-btn--ghost"
        disabled={page === 1}
        onClick={() => setPage(page - 1)}
        aria-label="Previous page"
      >
        <IonIcon icon={chevronBackOutline} />
      </button>

      {Array.from({ length: pages }, (_, i) => i + 1).map((number) => (
        <button
          key={number}
          type="button"
          className={`dash-btn ${number === page ? 'dash-btn--primary' : 'dash-btn--ghost'}`}
          onClick={() => setPage(number)}
          aria-current={number === page ? 'page' : undefined}
        >
          {number}
        </button>
      ))}

      <button
        type="button"
        className="dash-btn dash-btn--ghost"
        disabled={page === pages}
        onClick={() => setPage(page + 1)}
        aria-label="Next page"
      >
        <IonIcon icon={chevronForwardOutline} />
      </button>
    </nav>
  );
};

export default Pager;
