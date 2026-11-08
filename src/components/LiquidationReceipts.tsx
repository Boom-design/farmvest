import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

/**
 * The receipts behind a liquidation, as thumbnails that open full size. The
 * files are private, so each is shown through a short-lived signed link.
 */
const LiquidationReceipts = ({ paths }: { paths: string[] }) => {
  const [links, setLinks] = useState<{ path: string; url: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (paths.length === 0) {
      setLinks([]);
      return;
    }
    supabase.storage
      .from('project-documents')
      .createSignedUrls(paths, 600)
      .then(({ data, error: signError }) => {
        if (signError) {
          setError(signError.message);
          return;
        }
        setLinks(
          (data ?? [])
            .filter((row) => row.signedUrl)
            .map((row) => ({ path: row.path ?? '', url: row.signedUrl as string }))
        );
      });
  }, [paths]);

  if (error) return <p className="dash-error">{error}</p>;
  if (!links) return <p className="dash-row__meta">Loading receipts...</p>;
  if (links.length === 0) return <p className="dash-row__meta">No receipts were attached.</p>;

  return (
    <div className="receipt-grid">
      {links.map((link) =>
        /\.pdf$/i.test(link.path) ? (
          <a key={link.path} className="receipt-grid__file" href={link.url} target="_blank" rel="noopener noreferrer">
            PDF receipt
          </a>
        ) : (
          <a key={link.path} href={link.url} target="_blank" rel="noopener noreferrer">
            <img className="receipt-grid__photo" src={link.url} alt="Liquidation receipt" />
          </a>
        )
      )}
    </div>
  );
};

export default LiquidationReceipts;
