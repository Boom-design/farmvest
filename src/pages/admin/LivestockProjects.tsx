import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { IonContent, IonIcon, IonPage, IonSpinner } from '@ionic/react';
import {
  closeOutline,
  documentTextOutline,
  expandOutline,
  searchOutline,
} from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import Portal from '../../components/Portal';
import EmptyState from '../../components/EmptyState';
import Pager, { usePaged } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { NONE, orNone, peso, pillClass, shortDate, firstOf } from '../../lib/format';
import { categoryLook } from '../../lib/categories';
import { RELEASE_STAGES, isFullyReleased, releaseSplit } from '../../lib/funding';
import { PAYOUT_COLUMNS, accountsOf, describeAccount, hasPayoutAccount, type PayoutAccount } from '../../lib/payout';
import { compareLiquidation, totalOf, type CostLine, type Liquidation } from '../../lib/liquidation';
import CostEstimateCard from '../../components/CostEstimateCard';
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

type ProjectRow = {
  projects_id: string;
  title: string;
  description: string | null;
  category: string | null;
  funding_goal: number;
  current_funding: number;
  status: string;
  created_at: string;
  customers_id: string;
  rsbsa_name: string;
  rsbsa_number: string;
  expected_roi_percent: number;
  expected_cycle_days: number | null;
  collateral_type: string;
  collateral_description: string;
  collateral_value: number | null;
  image_url: string | null;
  customers: ({ users: { name: string; email: string } | null } & Partial<PayoutAccount>) | null;
  fund_releases: { stage: string; released_at: string }[];
  liquidations: { status: string }[] | { status: string } | null;
  estimated_heads: number | null;
  expected_mortality_percent: number;
  expected_price_per_head: number | null;
  cost_breakdown: CostLine[];
};

/** The newest progress posted since the last release, shown before releasing. */
type EvidenceRow = {
  photo_url: string | null;
  notes: string | null;
  captured_at: string;
  latitude: number | null;
  longitude: number | null;
};

type DocumentRow = {
  project_documents_id: string;
  doc_type: string;
  file_url: string;
  file_name: string;
};

const FILTERS = ['Pending Approval', 'Open', 'Funded', 'In Progress'];

/** One investor's stake in a project being cancelled, with what they paid. */
type RefundRow = {
  investments_id: string;
  amount: number;
  customers: { users: { name: string; email: string } | null } | null;
  payments: { payments_id: string; amount: number; status: string; submitted_at: string }[];
};

/** The payment that was actually received: confirmed, newest first. */
const paidPayment = (row: RefundRow) =>
  [...(row.payments ?? [])]
    .filter((payment) => payment.status === 'Confirmed')
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];

/** Answers "is this a real farmer or farm business". Two are required. */
const CREDENTIAL_TYPES = [
  'RSBSA Registration',
  'Proof of Land',
  'Barangay or LGU Certification',
  'Business Permit',
  'Veterinary or Facility Permit',
];

/** The public RSBSA lookup. It searches by name and birthday, not by number. */
const RSBSA_FINDER = 'https://finder-rsbsa.da.gov.ph/';

const LivestockProjects: React.FC = () => {
  const { profile } = useAuth();
  const { showSuccess } = useToast();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const location = useLocation();
  const [filter, setFilter] = useState(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    return tab && FILTERS.includes(tab) ? tab : 'Pending Approval';
  });

  // Ionic keeps the page mounted, so a notification tapped while already here
  // changes only the query; follow it.
  useEffect(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab && FILTERS.includes(tab)) setFilter(tab);
  }, [location.search]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [reviewing, setReviewing] = useState<ProjectRow | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  /**
   * Signed URL per document path, so each one can be shown rather than listed.
   *
   * A list of file names and View buttons made the reviewer open six dialogs to
   * answer one question. Signing them all at once costs a single request and
   * turns the review into looking at the documents instead of fetching them.
   */
  const [docUrls, setDocUrls] = useState<Record<string, string>>({});
  /**
   * The most this project was entitled to ask for.
   *
   * Read from public.project_funding_cap rather than recomputed here, so the
   * Admin is checking the figure the rule produces and not a second
   * implementation of the rule.
   */
  const [cap, setCap] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  /**
   * Whether the Admin has said they intend to reject.
   *
   * The reason box used to sit open under every review, which read as a field
   * that had to be filled before anything could be approved. It appears when
   * the Reject button is pressed, and that press becomes the first of two.
   */
  const [showReject, setShowReject] = useState(false);
  const [viewing, setViewing] = useState<{ doc: DocumentRow; url: string | null } | null>(null);

  /** Cancel and refund: the project, its investors once loaded, and the form. */
  const [refunding, setRefunding] = useState<ProjectRow | null>(null);
  const [refundRows, setRefundRows] = useState<RefundRow[] | null>(null);
  const [refundRefs, setRefundRefs] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState('');

  /**
   * Releasing funds or closing a project. `checks` is what the Admin needs to
   * see before the transfer: who has not paid, and whether there is progress
   * since the last release. Null while it loads.
   */
  const [releasing, setReleasing] = useState<{
    project: ProjectRow;
    mode: 'release' | 'complete';
    checks: { unpaid: string[]; evidenceSince: number; latest: EvidenceRow | null } | null;
  } | null>(null);
  const [releaseRef, setReleaseRef] = useState('');
  /** The farm owner's payout account the release is being sent to. */
  const [releaseAccount, setReleaseAccount] = useState('');

  /** The liquidation behind a completion, with signed links to its receipts. */
  const [liquidation, setLiquidation] = useState<{ report: Liquidation | null; receipts: string[] } | null>(null);
  const [returnNote, setReturnNote] = useState('');

  const load = useCallback(async () => {
    setError(null);

    const { data, error: loadError } = await supabase
      .from('projects')
      .select(
        `projects_id, customers_id, title, description, category, funding_goal, current_funding, status, created_at, rsbsa_name, rsbsa_number, expected_roi_percent, expected_cycle_days, collateral_type, collateral_description, collateral_value, image_url, customers(${PAYOUT_COLUMNS}, users(name, email)), fund_releases(stage, released_at), liquidations(status), estimated_heads, expected_mortality_percent, expected_price_per_head, cost_breakdown`
      )
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
    } else {
      setProjects((data ?? []) as unknown as ProjectRow[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Open the cancel-and-refund form for a project that did not fill.
   *
   * Each investor who paid is listed with the amount FarmVest received from
   * them. The Admin returns it outside the app and records the transfer
   * reference here; an investment that was never paid has nothing to return.
   */
  const openRefund = async (project: ProjectRow) => {
    setRefunding(project);
    setRefundRows(null);
    setRefundRefs({});
    setCancelReason('Did not reach its funding goal.');

    const { data, error: loadError } = await supabase
      .from('investments')
      .select('investments_id, amount, customers(users(name, email)), payments(payments_id, amount, status, submitted_at)')
      .eq('projects_id', project.projects_id)
      .order('created_at');

    if (loadError) {
      setError(loadError.message);
      setRefunding(null);
      return;
    }
    setRefundRows((data ?? []) as unknown as RefundRow[]);
  };

  /** The full release still to send, or null once the funds have gone. */
  const nextStage = (project: ProjectRow) =>
    isFullyReleased(project.fund_releases) ? null : RELEASE_STAGES[0];

  const lastRelease = (project: ProjectRow) =>
    [...(project.fund_releases ?? [])].sort((a, b) => b.released_at.localeCompare(a.released_at))[0];

  const openRelease = async (project: ProjectRow, mode: 'release' | 'complete') => {
    setReleasing({ project, mode, checks: null });
    setReleaseRef('');
    // The default account, unless the Admin picks another.
    setReleaseAccount(accountsOf(project.customers)[0]?.payout_accounts_id ?? '');
    setLiquidation(null);
    setReturnNote('');

    if (mode === 'complete') {
      const { data: report } = await supabase
        .from('liquidations')
        .select('heads_stocked, mortality, mortality_reason, heads_harvested, sales_amount, expenses, receipts, notes, status, admin_notes, submitted_at')
        .eq('projects_id', project.projects_id)
        .maybeSingle();
      const paths = ((report as Liquidation | null)?.receipts ?? []) as string[];
      const { data: signed } = paths.length
        ? await supabase.storage.from('project-documents').createSignedUrls(paths, 300)
        : { data: [] };
      setLiquidation({
        report: (report as Liquidation | null) ?? null,
        receipts: (signed ?? []).map((entry) => entry.signedUrl).filter(Boolean) as string[],
      });
    }

    const since = lastRelease(project)?.released_at ?? project.created_at;
    const [investRes, updatesRes] = await Promise.all([
      supabase
        .from('investments')
        .select('investments_id, customers(users(name)), payments(status)')
        .eq('projects_id', project.projects_id),
      supabase
        .from('progress_updates')
        .select('photo_url, notes, captured_at, latitude, longitude', { count: 'exact' })
        .eq('projects_id', project.projects_id)
        .gt('captured_at', since)
        .order('captured_at', { ascending: false })
        .limit(1),
    ]);

    if (investRes.error || updatesRes.error) {
      setError((investRes.error ?? updatesRes.error)!.message);
      setReleasing(null);
      return;
    }

    // Money that has not reached FarmVest cannot be passed on.
    const unpaid = ((investRes.data ?? []) as unknown as {
      customers: { users: { name: string } | null } | null;
      payments: { status: string }[];
    }[])
      .filter((row) => !row.payments?.some((payment) => payment.status === 'Confirmed'))
      .map((row) => row.customers?.users?.name ?? 'An investor');

    setReleasing({
      project,
      mode,
      checks: {
        unpaid,
        evidenceSince: updatesRes.count ?? 0,
        latest: ((updatesRes.data ?? [])[0] as EvidenceRow | undefined) ?? null,
      },
    });
  };

  const recordRelease = async () => {
    if (!releasing?.checks) return;
    const { project } = releasing;
    const stage = nextStage(project);
    if (!stage) return;

    const account = accountsOf(project.customers).find((row) => row.payout_accounts_id === releaseAccount);
    if (!account) {
      setError('Choose the payout account the funds were sent to.');
      return;
    }
    if (!releaseRef.trim()) {
      setError('Enter the reference of the transfer to the farm owner.');
      return;
    }

    const split = releaseSplit(Number(project.current_funding), stage.share);
    setBusyId(project.projects_id);
    setError(null);

    const { error: releaseError } = await supabase.from('fund_releases').insert({
      projects_id: project.projects_id,
      stage: stage.stage,
      gross_amount: split.gross,
      commission: split.commission,
      net_amount: split.net,
      reference_no: releaseRef.trim(),
      released_by: profile?.email ?? null,
      sent_to: describeAccount(account),
    });

    if (releaseError) {
      setError(releaseError.message);
      setBusyId(null);
      return;
    }

    // Every investor's stake moves to the stage just released.
    await supabase
      .from('investments')
      .update({ milestone_stage: stage.stage })
      .eq('projects_id', project.projects_id);

    if (project.status === 'Funded') {
      await supabase
        .from('projects')
        .update({ status: 'In Progress', started_at: new Date().toISOString() })
        .eq('projects_id', project.projects_id);
    }

    showSuccess(
      `Full release recorded: ${peso(split.net)} sent to the farm owner. The commission is collected on the repayment.`
    );
    setReleasing(null);
    setBusyId(null);
    await load();
  };

  /** Send the liquidation back for correction, with what to fix. */
  const returnLiquidation = async () => {
    if (!releasing) return;
    if (!returnNote.trim()) {
      setError('Say what the farm owner needs to correct.');
      return;
    }
    setBusyId(releasing.project.projects_id);
    const { error: updateError } = await supabase
      .from('liquidations')
      .update({
        status: 'Returned',
        admin_notes: returnNote.trim(),
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile?.email ?? null,
      })
      .eq('projects_id', releasing.project.projects_id);
    if (updateError) {
      setError(updateError.message);
    } else {
      showSuccess('Liquidation returned to the farm owner for correction.');
      setReleasing(null);
      await load();
    }
    setBusyId(null);
  };

  const markCompleted = async () => {
    if (!releasing) return;
    const { project } = releasing;

    setBusyId(project.projects_id);
    setError(null);

    // Accepting the liquidation does not complete the project. It stays In
    // Progress until the farm owner's repayment is confirmed, which is what
    // makes it Completed and counts it toward their track record.
    const { error: acceptError } = await supabase
      .from('liquidations')
      .update({ status: 'Accepted', reviewed_at: new Date().toISOString(), reviewed_by: profile?.email ?? null })
      .eq('projects_id', project.projects_id);

    if (acceptError) {
      setError(acceptError.message);
    } else {
      showSuccess('Liquidation accepted. The project is completed once the farm owner\'s repayment is confirmed.');
      setReleasing(null);
      await load();
    }
    setBusyId(null);
  };

  const confirmRefund = async () => {
    if (!refunding || !refundRows) return;

    const paid = refundRows.filter((row) => paidPayment(row));
    const missing = paid.find((row) => !refundRefs[row.investments_id]?.trim());
    if (missing) {
      setError(
        `Enter the refund reference for ${missing.customers?.users?.name ?? 'every investor who paid'}.`
      );
      return;
    }
    if (!cancelReason.trim()) {
      setError('Say why the project is cancelled. Every investor is told.');
      return;
    }

    setBusyId(refunding.projects_id);
    setError(null);

    for (const row of paid) {
      const payment = paidPayment(row)!;
      const { error: refundError } = await supabase
        .from('payments')
        .update({
          status: 'Refunded',
          refunded_at: new Date().toISOString(),
          refund_reference: refundRefs[row.investments_id].trim(),
          admin_notes: cancelReason.trim(),
          reviewed_by: profile?.email ?? null,
        })
        .eq('payments_id', payment.payments_id);

      if (refundError) {
        setError(refundError.message);
        setBusyId(null);
        return;
      }
    }

    const { error: projectError } = await supabase
      .from('projects')
      .update({ status: 'Cancelled', rejection_reason: cancelReason.trim() })
      .eq('projects_id', refunding.projects_id);

    if (projectError) {
      setError(projectError.message);
    } else {
      showSuccess(
        paid.length > 0
          ? `Project cancelled. ${paid.length} refund${paid.length === 1 ? '' : 's'} recorded.`
          : 'Project cancelled. Nobody had paid, so there was nothing to refund.'
      );
      setRefunding(null);
      await load();
    }

    setBusyId(null);
  };

  /**
   * Open one project for review and fetch what it was posted with.
   *
   * The documents are not loaded with the table: most rows are already decided,
   * and every file needs its own signed URL, so fetching them up front would be
   * work thrown away on all but the row the Admin actually opens.
   */
  const openReview = async (project: ProjectRow) => {
    setReviewing(project);
    setRejectReason('');
    setShowReject(false);
    setDocuments([]);
    setDocsLoading(true);

    const { data, error: docError } = await supabase
      .from('project_documents')
      .select('project_documents_id, doc_type, file_url, file_name')
      .eq('projects_id', project.projects_id)
      .order('uploaded_at', { ascending: true });

    if (docError) {
      setError(docError.message);
      setDocsLoading(false);
      return;
    }

    const docs = (data ?? []) as DocumentRow[];
    setDocuments(docs);
    setDocUrls({});
    setCap(null);

    const { data: capValue } = await supabase.rpc('project_funding_cap', {
      p_projects_id: project.projects_id,
    });

    if (capValue != null) setCap(Number(capValue));

    if (docs.length > 0) {
      const { data: signed } = await supabase.storage
        .from('project-documents')
        .createSignedUrls(
          docs.map((doc) => doc.file_url),
          300
        );

      if (signed) {
        const map: Record<string, string> = {};
        for (const entry of signed) {
          if (entry.path && entry.signedUrl) map[entry.path] = entry.signedUrl;
        }
        setDocUrls(map);
      }
    }

    setDocsLoading(false);
  };

  /**
   * The bucket is private, so a file is reachable only through a short-lived
   * signed URL. Five minutes is the same window the valid ID and payment proof
   * viewers use: long enough to read, short enough that a copied link is dead
   * before it can be passed on.
   *
   * It opens over the review rather than in a new tab. The Admin is working
   * through a checklist of six or seven files, and a tab per file loses the
   * place in the queue and the half-typed rejection reason with it.
   */
  const openDocument = async (doc: DocumentRow) => {
    setViewing({ doc, url: null });

    const { data, error: signError } = await supabase.storage
      .from('project-documents')
      .createSignedUrl(doc.file_url, 300);

    if (signError || !data) {
      setError(signError?.message ?? 'That file could not be opened.');
      setViewing(null);
      return;
    }

    setViewing({ doc, url: data.signedUrl });
  };

  const setStatus = async (
    projectId: string,
    status: string,
    rejectionReason?: string
  ) => {
    setBusyId(projectId);
    setError(null);

    const { error: updateError } = await supabase
      .from('projects')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        rejection_reason: rejectionReason ?? NONE,
      })
      .eq('projects_id', projectId);

    if (updateError) {
      setError(updateError.message);
    } else {
      showSuccess(
        status === 'Open'
          ? 'Project approved. Investors can see it now.'
          : `Project marked ${status}.`
      );
      await load();
    }

    setBusyId(null);
  };

  const approveReviewed = async () => {
    if (!reviewing) return;
    await setStatus(reviewing.projects_id, 'Open');
    setReviewing(null);
  };

  const rejectReviewed = async () => {
    if (!reviewing) return;

    if (rejectReason.trim().length < 10) {
      setError('Say what is missing, so the farm owner can fix it and repost.');
      return;
    }

    await setStatus(reviewing.projects_id, 'Rejected', rejectReason.trim());
    setReviewing(null);
  };

  const documentsOfType = (types: string[]) =>
    documents.filter((doc) => types.includes(doc.doc_type));

  /**
   * One document as a card with its own preview.
   *
   * A PDF cannot be thumbnailed without rendering it, so it keeps an icon and
   * leans on the full-size viewer, which puts it in an iframe.
   */
  const documentCard = (doc: DocumentRow) => {
    const url = docUrls[doc.file_url];
    const isPdf = doc.file_url.toLowerCase().endsWith('.pdf');

    return (
      <article className="doc-card" key={doc.project_documents_id}>
        <button
          type="button"
          className="doc-card__art"
          onClick={() => openDocument(doc)}
          aria-label={`Open ${doc.doc_type} full size`}
        >
          {isPdf ? (
            <span className="doc-card__pdf">
              <IonIcon icon={documentTextOutline} />
              PDF
            </span>
          ) : url ? (
            <img src={url} alt={doc.doc_type} loading="lazy" />
          ) : (
            <IonSpinner name="crescent" />
          )}
        </button>

        <div className="doc-card__foot">
          <div className="doc-card__text">
            <p className="doc-card__type">{doc.doc_type}</p>
            <p className="dash-row__meta">{doc.file_name}</p>
          </div>

          <button
            type="button"
            className="dash-btn dash-btn--ghost doc-card__open"
            onClick={() => openDocument(doc)}
          >
            <IonIcon icon={expandOutline} />
            <span>Full size</span>
          </button>
        </div>
      </article>
    );
  };

  const visible = useMemo(
    () => projects.filter((project) => project.status === filter),
    [projects, filter]
  );

  // Five to a page; changing tab starts again at page one.
  const paged = usePaged(visible, filter);

  const countFor = (value: string) =>
    projects.filter((project) => project.status === value).length;

  const fundedPercent = (project: ProjectRow) => {
    if (!project.funding_goal) return 0;
    return Math.min(100, Math.round((Number(project.current_funding) / Number(project.funding_goal)) * 100));
  };

  return (
    <IonPage>
      <DashboardHeader
        title="Livestock Projects"
        subtitle="Review posted projects before they become visible to investors."
        accountName={profile?.name || 'System Administrator'}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          <div className="dash-toolbar-row">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={`dash-tab${filter === value ? ' dash-tab--active' : ''}`}
                onClick={() => setFilter(value)}
              >
                {value} ({countFor(value)})
              </button>
            ))}
          </div>

          <section className="dash-panel">
            <div className="dash-panel__head">
              <h2 className="dash-panel__title">Posted Projects</h2>
              <span className="dash-stat__hint">{visible.length} shown</span>
            </div>

            <div className="dash-panel__body dash-table-wrap">
              {loading ? (
                <Skeleton />
              ) : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Farm Owner</th>
                      <th>Category</th>
                      <th>Funding Goal</th>
                      <th>Funded</th>
                      <th>Posted</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={8}>
                          <EmptyState title="No project is in this state right now" size={120} />
                        </td>
                      </tr>
                    ) : (
                      paged.slice.map((project) => (
                      <tr key={project.projects_id}>
                        <td>
                          <p className="dash-row__title">{project.title}</p>
                          <p className="dash-row__meta">{orNone(project.description)}</p>
                        </td>
                        <td className="dash-table__muted">{orNone(project.customers?.users?.name)}</td>
                        <td className="dash-table__muted">
                          {categoryLook(project.category).emoji} {project.category ?? 'Other'}
                        </td>
                        <td>{peso(project.funding_goal)}</td>
                        <td>
                          <div className="dash-progress">
                            <div
                              className="dash-progress__fill"
                              style={{ width: `${fundedPercent(project)}%` }}
                            />
                          </div>
                          <span className="dash-row__meta">{fundedPercent(project)}%</span>
                        </td>
                        <td className="dash-table__muted">{shortDate(project.created_at)}</td>
                        <td>
                          <span className={pillClass(project.status)}>{project.status}</span>
                        </td>
                        <td>
                          <div className="dash-actions">
                            {project.status === 'Pending Approval' ? (
                              <button
                                type="button"
                                className="dash-btn dash-btn--primary"
                                disabled={busyId === project.projects_id}
                                onClick={() => openReview(project)}
                              >
                                Review
                              </button>
                            ) : project.status === 'Open' ? (
                              <button
                                type="button"
                                className="dash-btn dash-btn--slate"
                                disabled={busyId === project.projects_id}
                                onClick={() => openRefund(project)}
                              >
                                Cancel &amp; Refund
                              </button>
                            ) : ['Funded', 'In Progress'].includes(project.status) ? (
                              nextStage(project) ? (
                                <button
                                  type="button"
                                  className="dash-btn dash-btn--gold"
                                  disabled={busyId === project.projects_id}
                                  onClick={() => openRelease(project, 'release')}
                                >
                                  Release Funds
                                </button>
                              ) : firstOf(project.liquidations)?.status === 'Accepted' ? (
                                // Waiting on the farm owner's repayment, confirmed in
                                // Investment Transactions; that completes the project.
                                <span className="dash-pill dash-pill--gold">Awaiting repayment</span>
                              ) : (
                                <button
                                  type="button"
                                  className="dash-btn dash-btn--primary"
                                  disabled={busyId === project.projects_id}
                                  onClick={() => openRelease(project, 'complete')}
                                >
                                  Review Liquidation
                                </button>
                              )
                            ) : (
                              <span className="dash-table__muted">-</span>
                            )}
                          </div>
                        </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
              {!loading && <Pager {...paged} />}
            </div>
          </section>
        </div>

        {reviewing && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Review this project"
            onClick={() => setReviewing(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--wide"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Review before investors see it</p>
                  <h2 className="dash-modal__title">{reviewing.title}</h2>
                </div>

                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setReviewing(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body">
                <p className="dash-modal__lead">{orNone(reviewing.description)}</p>

                <CostEstimateCard project={reviewing} />

                <div className="dash-form dash-form--two">
                  <div className="dash-field">
                    <label>Farm Owner</label>
                    <p className="dash-row__title">
                      {orNone(reviewing.customers?.users?.name)}
                    </p>
                    <p className="dash-row__meta">
                      {orNone(reviewing.customers?.users?.email)}
                    </p>
                  </div>

                  <div className="dash-field">
                    <label>Category and Goal</label>
                    <p className="dash-row__title">
                      {categoryLook(reviewing.category).emoji} {reviewing.category ?? 'Other'}
                    </p>
                    <p className="dash-row__meta">{peso(reviewing.funding_goal)}</p>
                  </div>
                </div>

                {/* The finder searches by name and birthday, so the number is
                    context rather than a lookup key. The link is here because
                    the check is a browser step the Admin does themselves: the
                    Department of Agriculture publishes no API, and scraping a
                    government site would break the first time they change it. */}
                <div className="dash-field dash-field--full">
                  <label>The Offer</label>

                  <div className="invest-summary">
                    <div>
                      <p className="dash-stat__label">Return promised</p>
                      <p className="invest-summary__value">
                        +{Number(reviewing.expected_roi_percent)}%
                      </p>
                    </div>
                    <div>
                      <p className="dash-stat__label">Cycle</p>
                      <p className="invest-summary__value">
                        {reviewing.expected_cycle_days
                          ? `${reviewing.expected_cycle_days} days`
                          : 'Not stated'}
                      </p>
                    </div>
                    <div>
                      <p className="dash-stat__label">Entitled to ask</p>
                      <p
                        className={`invest-summary__value${
                          cap != null && Number(reviewing.funding_goal) > cap
                            ? ' match-score--weak'
                            : ''
                        }`}
                      >
                        {cap == null ? '—' : peso(cap)}
                      </p>
                    </div>
                  </div>

                  {cap != null && Number(reviewing.funding_goal) > cap && (
                    <p className="dash-error">
                      This project asks {peso(reviewing.funding_goal)} but its documents and
                      collateral only entitle it to {peso(cap)}. The form should have stopped
                      this, so check how it was posted before approving.
                    </p>
                  )}
                </div>

                <div className="dash-field dash-field--full">
                  <label>Collateral Pledged</label>

                  <div className="invest-security">
                    <p className="invest-security__asset">
                      {orNone(reviewing.collateral_type)}
                    </p>
                    <p className="dash-row__meta">
                      {orNone(reviewing.collateral_description)}
                    </p>
                    <p className="dash-row__meta">
                      Declared value {peso(Number(reviewing.collateral_value ?? 0))}, against a
                      goal of {peso(reviewing.funding_goal)}.
                    </p>
                  </div>

                  <p className="dash-row__meta">
                    The value is the farm owner's own statement. Open the Collateral Proof below
                    and check the document names the same asset and the same owner as the ID.
                  </p>
                </div>

                <div className="dash-field dash-field--full">
                  <label>RSBSA Registration</label>

                  <div className="rsbsa-panel">
                    <div className="rsbsa-panel__detail">
                      {/* The name is what goes into the finder; the number only
                          corroborates the row that comes back. */}
                      <p className="doc-card__type">Registered name</p>
                      <p className="rsbsa-panel__name">{orNone(reviewing.rsbsa_name)}</p>

                      <p className="doc-card__type">Reference</p>
                      <p className="dash-row__meta">{orNone(reviewing.rsbsa_number)}</p>
                    </div>

                    <a
                      className="dash-btn dash-btn--ghost rsbsa-panel__link"
                      href={RSBSA_FINDER}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IonIcon icon={searchOutline} />
                      <span>Open RSBSA Finder</span>
                    </a>
                  </div>

                  <p className="dash-row__meta">
                    The finder searches by name, sex and birthday. Take those from the valid ID on
                    the account, and check the name here matches it: a registered farmer whose
                    RSBSA name differs from their government ID is the thing worth catching. A
                    blank RSBSA is not a rejection -- it covers the basic sector, and a registered
                    farm business is often not in it at all.
                  </p>
                </div>

                <div className="dash-field dash-field--full">
                  <label>Documents Attached</label>

                  {docsLoading ? (
                    <Skeleton />
                  ) : (
                    <>
                      <p className="doc-review__group">Proof that they farm here</p>
                      {documentsOfType(CREDENTIAL_TYPES).length === 0 ? (
                        <p className="doc-review__empty">
                          Nothing attached. Reject and ask for one.
                        </p>
                      ) : (
                        <div className="doc-cards">
                          {documentsOfType(CREDENTIAL_TYPES).map(documentCard)}
                        </div>
                      )}

                      <p className="doc-review__group">About this project</p>
                      {documentsOfType(['Farm Photo', 'Project Proposal', 'Cost Estimate'])
                        .length === 0 ? (
                        <p className="doc-review__empty">
                          Nothing attached. Reject and ask for photos.
                        </p>
                      ) : (
                        <div className="doc-cards">
                          {documentsOfType([
                            'Farm Photo',
                            'Project Proposal',
                            'Cost Estimate',
                          ]).map(documentCard)}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {showReject && (
                  <div className="dash-field dash-field--full">
                    <label htmlFor="review-reject">Why are you rejecting it?</label>
                    <textarea
                      id="review-reject"
                      className="dash-textarea"
                      value={rejectReason}
                      onChange={(event) => setRejectReason(event.target.value)}
                      placeholder="The farm owner reads this and can fix it, so say what is missing."
                      autoFocus
                    />
                  </div>
                )}
              </div>

              <div className="dash-modal__foot">
                <button
                  type="button"
                  className="dash-btn dash-btn--ghost"
                  disabled={busyId === reviewing.projects_id}
                  onClick={() => (showReject ? rejectReviewed() : setShowReject(true))}
                >
                  {showReject ? 'Confirm Rejection' : 'Reject'}
                </button>
                <button
                  type="button"
                  className="dash-btn dash-btn--primary"
                  disabled={busyId === reviewing.projects_id}
                  onClick={approveReviewed}
                >
                  Approve
                </button>
              </div>
            </div>
          </Portal>
        )}
        {viewing && (
          <Portal
            className="dash-modal dash-modal--stacked"
            role="dialog"
            aria-modal="true"
            aria-label={viewing.doc.doc_type}
            onClick={() => setViewing(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--wide"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">{viewing.doc.doc_type}</p>
                  <h2 className="dash-modal__title">{orNone(viewing.doc.file_name)}</h2>
                </div>

                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setViewing(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body">
                {!viewing.url ? (
                  <Skeleton />
                ) : viewing.doc.file_url.toLowerCase().endsWith('.pdf') ? (
                  <iframe
                    className="dash-modal__frame"
                    src={viewing.url}
                    title={viewing.doc.doc_type}
                  />
                ) : (
                  <img
                    className="dash-modal__image"
                    src={viewing.url}
                    alt={viewing.doc.doc_type}
                  />
                )}
              </div>

              <p className="dash-modal__note">
                Check the name and address here against the valid ID on the account. Two documents
                from two offices that do not agree with each other is the thing worth catching.
              </p>
            </div>
          </Portal>
        )}
        {refunding && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Cancel and refund"
            onClick={() => setRefunding(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--wide"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">
                    Cancel &amp; Refund · {peso(refunding.current_funding)} of{' '}
                    {peso(refunding.funding_goal)} raised
                  </p>
                  <h2 className="dash-modal__title">{refunding.title}</h2>
                </div>
                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setRefunding(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body dash-modal__body--form">
                <p className="dash-notice">
                  Funding is all-or-nothing, so nothing is released to the farm owner. Send each
                  investor back what FarmVest received, through GCash or the bank, then enter the
                  transfer reference below.
                </p>

                {refundRows === null ? (
                  <Skeleton />
                ) : refundRows.length === 0 ? (
                  <p className="dash-stat__hint">No one invested in this project.</p>
                ) : (
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th>Investor</th>
                        <th>Paid to FarmVest</th>
                        <th>Refund Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refundRows.map((row) => {
                        const payment = paidPayment(row);
                        return (
                          <tr key={row.investments_id}>
                            <td>
                              <p className="dash-row__title">{orNone(row.customers?.users?.name)}</p>
                              <p className="dash-row__meta">{orNone(row.customers?.users?.email)}</p>
                            </td>
                            <td>{payment ? peso(payment.amount) : 'Not paid'}</td>
                            <td>
                              {payment ? (
                                <input
                                  className="dash-input"
                                  placeholder="GCash or bank reference"
                                  value={refundRefs[row.investments_id] ?? ''}
                                  onChange={(event) =>
                                    setRefundRefs({
                                      ...refundRefs,
                                      [row.investments_id]: event.target.value,
                                    })
                                  }
                                />
                              ) : (
                                <span className="dash-table__muted">Nothing to refund</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                <div className="dash-field">
                  <label htmlFor="cancel-reason">Reason, shown to every investor</label>
                  <input
                    id="cancel-reason"
                    className="dash-input"
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                  />
                </div>
              </div>

              <div className="dash-modal__foot">
                <button type="button" className="dash-btn dash-btn--ghost" onClick={() => setRefunding(null)}>
                  Keep Open
                </button>
                <button
                  type="button"
                  className="dash-btn dash-btn--primary"
                  disabled={busyId === refunding.projects_id || refundRows === null}
                  onClick={confirmRefund}
                >
                  Cancel Project and Record Refunds
                </button>
              </div>
            </div>
          </Portal>
        )}
        {releasing && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label={releasing.mode === 'release' ? 'Release funds' : 'Complete project'}
            onClick={() => setReleasing(null)}
          >
            <div className="dash-modal__panel" onClick={(event) => event.stopPropagation()}>
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">
                    {releasing.mode === 'release'
                      ? `Full release · ${peso(releasing.project.current_funding)} raised`
                      : 'Funds released'}
                  </p>
                  <h2 className="dash-modal__title">{releasing.project.title}</h2>
                </div>
                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setReleasing(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body dash-modal__body--form">
                {!releasing.checks ? (
                  <Skeleton />
                ) : releasing.mode === 'complete' ? (
                  !liquidation ? (
                    <Skeleton />
                  ) : !liquidation.report || liquidation.report.status === 'Returned' ? (
                    <p className="dash-notice">
                      {liquidation.report
                        ? `Returned to the farm owner: ${liquidation.report.admin_notes}. Waiting for the corrected report.`
                        : `Waiting for ${orNone(releasing.project.customers?.users?.name)}'s liquidation report: actual spending with receipts, mortality, and the harvest sold. The project can be completed once it arrives.`}
                    </p>
                  ) : (
                    (() => {
                      const report = liquidation.report;
                      const result = compareLiquidation(
                        {
                          estimated_heads: releasing.project.estimated_heads,
                          expected_mortality_percent: releasing.project.expected_mortality_percent,
                          cost_breakdown: releasing.project.cost_breakdown ?? [],
                        },
                        report
                      );
                      const planned = new Map((releasing.project.cost_breakdown ?? []).map((line) => [line.item, Number(line.amount)]));
                      const items = Array.from(new Set([...planned.keys(), ...report.expenses.map((line) => line.item)]));

                      return (
                        <>
                          <table className="dash-table">
                            <thead>
                              <tr>
                                <th></th>
                                <th>Estimate</th>
                                <th>Actual</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>Head</td>
                                <td>{releasing.project.estimated_heads ?? 'Not given'}</td>
                                <td>{report.heads_stocked} stocked, {report.heads_harvested} harvested</td>
                              </tr>
                              <tr>
                                <td>Mortality</td>
                                <td>{result.expectedMortality}%</td>
                                <td>
                                  {report.mortality} head ({result.mortalityPercent.toFixed(1)}%)
                                  {report.mortality > 0 && <p className="dash-row__meta">{report.mortality_reason}</p>}
                                </td>
                              </tr>
                              {items.map((item) => (
                                <tr key={item}>
                                  <td>{item}</td>
                                  <td>{planned.has(item) ? peso(planned.get(item) ?? 0) : '—'}</td>
                                  <td>{peso(report.expenses.find((line) => line.item === item)?.amount ?? 0)}</td>
                                </tr>
                              ))}
                              <tr className="dash-table__totals">
                                <td>Total spending</td>
                                <td>{peso(totalOf(releasing.project.cost_breakdown))}</td>
                                <td>{peso(result.spent)}</td>
                              </tr>
                              <tr>
                                <td>Sales</td>
                                <td>—</td>
                                <td>{peso(report.sales_amount)}</td>
                              </tr>
                            </tbody>
                          </table>

                          {result.flags.length > 0 ? (
                            <ul className="liq-flags">
                              {result.flags.map((flag) => (
                                <li key={flag}>{flag}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="dash-notice">Spending, mortality and the head count are in line with the budget.</p>
                          )}

                          {liquidation.receipts.length > 0 && (
                            <p className="dash-row__meta">
                              Receipts:{' '}
                              {liquidation.receipts.map((url, index) => (
                                <a key={url} className="dash-panel__link" href={url} target="_blank" rel="noopener noreferrer">
                                  {`#${index + 1} `}
                                </a>
                              ))}
                            </p>
                          )}
                          {report.notes !== 'None' && <p className="dash-row__meta">Notes: {report.notes}</p>}

                          <div className="dash-field">
                            <label htmlFor="liq-return">To return it for correction, say what to fix</label>
                            <input id="liq-return" className="dash-input" value={returnNote}
                              onChange={(event) => setReturnNote(event.target.value)}
                              placeholder="For example: attach the feed receipts for week 3" />
                          </div>
                        </>
                      );
                    })()
                  )
                ) : (
                  (() => {
                    const stage = nextStage(releasing.project)!;
                    const split = releaseSplit(Number(releasing.project.current_funding), stage.share);
                    const noPayout = !hasPayoutAccount(releasing.project.customers);
                    const blocked = releasing.checks.unpaid.length > 0 || noPayout;

                    return (
                      <>
                        <p className="dash-stat__hint">{stage.note}</p>

                        <table className="dash-table">
                          <tbody>
                            <tr>
                              <td>Funds raised (100%)</td>
                              <td>{peso(split.gross)}</td>
                            </tr>
                            <tr>
                              <td>FarmVest commission (5%)</td>
                              <td>Collected on the repayment</td>
                            </tr>
                            <tr className="dash-table__totals">
                              <td>Send to {orNone(releasing.project.customers?.users?.name)}</td>
                              <td>{peso(split.net)}</td>
                            </tr>
                          </tbody>
                        </table>

                        {!noPayout && (
                          <div className="dash-field">
                            <label htmlFor="release-account">Send to This Account</label>
                            <select
                              id="release-account"
                              className="dash-input"
                              value={releaseAccount}
                              onChange={(event) => setReleaseAccount(event.target.value)}
                            >
                              {accountsOf(releasing.project.customers).map((account) => (
                                <option key={account.payout_accounts_id} value={account.payout_accounts_id}>
                                  {describeAccount(account)}
                                  {account.is_default ? ' (Default)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {noPayout && (
                          <p className="dash-error">
                            The farm owner has not added a payout account. They add one in Account
                            Profile, under Payout Accounts, before the funds can be sent.
                          </p>
                        )}

                        {releasing.checks.latest && (
                          <div className="release-evidence">
                            {releasing.checks.latest.photo_url && (
                              <img
                                className="release-evidence__photo"
                                src={releasing.checks.latest.photo_url}
                                alt="Latest progress photo"
                              />
                            )}
                            <div>
                              <p className="dash-row__title">Latest progress</p>
                              <p className="dash-row__meta">
                                Taken {shortDate(releasing.checks.latest.captured_at)}
                              </p>
                              {releasing.checks.latest.notes && (
                                <p className="dash-row__meta">{releasing.checks.latest.notes}</p>
                              )}
                              {releasing.checks.latest.latitude != null &&
                              releasing.checks.latest.longitude != null ? (
                                <a
                                  className="dash-panel__link"
                                  href={`https://www.google.com/maps?q=${releasing.checks.latest.latitude},${releasing.checks.latest.longitude}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  View where it was taken on the map
                                </a>
                              ) : (
                                <p className="dash-row__meta">
                                  No location was captured with this photo.
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {releasing.checks.unpaid.length > 0 && (
                          <p className="dash-error">
                            Not every investment is paid: {releasing.checks.unpaid.join(', ')}. Confirm
                            their payments in Investment Transactions first.
                          </p>
                        )}

                        {!blocked && (
                          <div className="dash-field">
                            <label htmlFor="release-ref">Transfer Reference</label>
                            <input
                              id="release-ref"
                              className="dash-input"
                              placeholder="GCash or bank reference of the transfer"
                              value={releaseRef}
                              onChange={(event) => setReleaseRef(event.target.value)}
                            />
                          </div>
                        )}
                      </>
                    );
                  })()
                )}
              </div>

              <div className="dash-modal__foot">
                <button type="button" className="dash-btn dash-btn--ghost" onClick={() => setReleasing(null)}>
                  Close
                </button>
                {releasing.checks && releasing.mode === 'complete' && liquidation?.report?.status === 'Submitted' && (
                  <>
                    <button
                      type="button"
                      className="dash-btn dash-btn--ghost"
                      disabled={busyId === releasing.project.projects_id}
                      onClick={returnLiquidation}
                    >
                      Return for Correction
                    </button>
                    <button
                      type="button"
                      className="dash-btn dash-btn--primary"
                      disabled={busyId === releasing.project.projects_id}
                      onClick={markCompleted}
                    >
                      Accept Liquidation
                    </button>
                  </>
                )}
                {releasing.checks &&
                  releasing.mode === 'release' &&
                  releasing.checks.unpaid.length === 0 &&
                  hasPayoutAccount(releasing.project.customers) && (
                    <button
                      type="button"
                      className="dash-btn dash-btn--primary"
                      disabled={busyId === releasing.project.projects_id}
                      onClick={recordRelease}
                    >
                      Record Release
                    </button>
                  )}
              </div>
            </div>
          </Portal>
        )}
      </IonContent>
    </IonPage>
  );
};

export default LivestockProjects;
