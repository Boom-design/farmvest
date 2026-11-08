import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { IonContent, IonIcon, IonPage, IonSpinner } from '@ionic/react';
import {
  chevronBackOutline,
  chevronForwardOutline,
  closeOutline,
  openOutline,
  searchOutline,
} from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import Pager, { usePaged } from '../../components/Pager';
import Portal from '../../components/Portal';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { hasValue, NONE, orNone, pillClass, shortDate } from '../../lib/format';
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

type UserRow = {
  users_id: string;
  name: string;
  email: string;
  contact_number: string;
  user_type: 'Customer' | 'Admin';
  verification_status: 'Pending' | 'Flagged' | 'Approved' | 'Rejected';
  account_status: 'Active' | 'Inactive';
  verified_at: string | null;
  suspended_reason: string;
  created_at: string;
  /** Identity sits on the account: both roles upload a government ID. */
  valid_id_type: string;
  valid_id_url: string | null;
  /** The live capture taken during verification, and how it scored. */
  selfie_url: string | null;
  face_match_score: number | null;
  liveness_passed_at: string | null;
  verification_notes: string;
  /** Present only for a Farm Owner, who also has a farm address to check. */
  customers: {
    farm_location: string | null;
  } | null;
};

/**
 * The ID being looked at.
 *
 * Opened before the signed URL exists so the panel can show a spinner rather
 * than leaving the Admin on the table with nothing happening, which is what a
 * blocked pop-up looked like.
 */
type IdPreview = {
  /** Whose ID it is, shown in the panel header. */
  name: string;
  idType: string;
  /** A PDF cannot go in an img, so the two are rendered differently. */
  isPdf: boolean;
  url: string | null;
  error: string | null;
  /**
   * The liveness frames, when the panel is showing a live capture rather than
   * the ID. Paged one at a time so each frame is shown at full panel size.
   */
  frames?: CaptureFrame[];
  index?: number;
};

/**
 * The account being deactivated, held while the Admin writes the reason.
 *
 * suspended_reason is what the user is shown and what the next reviewer reads,
 * so it is typed per case rather than defaulted. Common wordings are offered as
 * one-click fills, and any of them can be edited before saving.
 */
/**
 * One frame of a customer's liveness sequence, with a signed URL to show it.
 *
 * Shown as a row of four rather than behind a button each. The whole point of
 * four frames from three angles is that the comparison is visual: a printed
 * photograph held up to a camera produces four near-identical pictures, which
 * is obvious at a glance and invisible one dialog at a time.
 */
type CaptureFrame = {
  step: string;
  url: string;
};

const STEP_LABEL: Record<string, string> = {
  'turn-right': 'Right',
  'turn-left': 'Left',
  front: 'Front',
  blink: 'Blink',
};

/** Sequence order, so the strip reads the way it was performed. */
const STEP_ORDER = ['turn-right', 'turn-left', 'front', 'blink'];

type DeactivateTarget = {
  users_id: string;
  name: string;
};

/** Offered as buttons that fill the box, not as a fixed list to pick from: a
 *  real case usually needs a detail these do not carry. */
const SUSPENSION_REASONS = [
  'Failed identity verification',
  'Fraudulent activity reported',
  'Repeated disputes filed against this account',
  'Requested by the account holder',
  'Inactive for an extended period',
];

/** One tab per account state.: it arrives in Pending, and
 * approval moves it to the tab for the role it registered as.
 *
 * Splitting the approved accounts by role is not only tidier. A farm owner is
 * reviewed on a farm address and a government ID, and an investor has neither,
 * so a single Approved tab had to show columns that were blank for half its
 * rows. Each tab now carries only the columns its rows can fill.
 *
 * The Admin account appears in none of them on purpose: it is created once in
 * the Supabase dashboard rather than registered through the app, so there is no
 * verification to perform on it and no reason to offer a Set Inactive button
 * against the account the reviewer is signed in as.
 */
// Flagged rather than Pending, because verification is no longer a queue. The
// face check runs in the browser and approves a clear pass on the spot; only a
// borderline score reaches a human, and an empty tab here is the system working
// rather than nobody having signed up.
type Tab = 'Flagged' | 'Customers' | 'Inactive';

const TABS: Tab[] = ['Flagged', 'Customers', 'Inactive'];

const PANEL_TITLE: Record<Tab, string> = {
  Flagged: 'Verification Needing a Human',
  Customers: 'Verified Customers',
  Inactive: 'Deactivated Accounts',
};

const EMPTY_MESSAGE: Record<Tab, string> = {
  Flagged: 'Nothing needs reviewing. Every account so far passed or failed the face check outright.',
  Customers: 'No account has been approved yet.',
  Inactive: 'No account has been deactivated.',
};

/** Below this the match is weak enough that the Admin should expect a mismatch. */
const WEAK_MATCH = 0.5;

type Column = {
  label: string;
  render: (user: UserRow) => ReactNode;
};

const UserManagement: React.FC = () => {
  const { profile } = useAuth();
  const { showSuccess } = useToast();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [idPreview, setIdPreview] = useState<IdPreview | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<DeactivateTarget | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [tab, setTab] = useState<Tab>('Flagged');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Liveness frames per account, loaded when a row is expanded. */
  const [frames, setFrames] = useState<Record<string, CaptureFrame[]>>({});
  const [framesFor, setFramesFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);

    const { data, error: loadError } = await supabase
      .from('users')
      .select(
        'users_id, name, email, contact_number, user_type, verification_status, account_status, verified_at, suspended_reason, valid_id_type, valid_id_url, selfie_url, face_match_score, liveness_passed_at, verification_notes, created_at, customers(farm_location)'
      )
      .neq('user_type', 'Admin')
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
    } else {
      setUsers((data ?? []) as unknown as UserRow[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Run one of the Admin's account functions.
   *
   * A plain update cannot be used here any more. UPDATE on public.users is
   * revoked from every authenticated role so a customer cannot approve
   * themselves, and column privileges are checked before row level security,
   * so a policy calling is_admin() never gets its say. These functions run as
   * their owner and re-check is_admin() inside.
   */
  const run = async (
    userId: string,
    call: () => PromiseLike<{ error: { message: string } | null }>,
    done: string
  ) => {
    setBusyId(userId);
    setError(null);

    const { error: rpcError } = await call();

    if (rpcError) {
      setError(rpcError.message);
    } else {
      showSuccess(done);
      await load();
    }

    setBusyId(null);
  };

  /**
   * Open the submitted ID.
   *
   * IDs live in a private bucket, so the file is reached through a signed URL
   * that expires in five minutes. It is shown in a panel over the table rather
   * than in a new tab: the Admin is comparing the document against the row they
   * are about to approve, and a tab switch loses that row.
   */
  const viewValidId = async (user: UserRow) => {
    const path = user.valid_id_url;
    if (!hasValue(path)) return;

    setError(null);
    setIdPreview({
      name: user.name,
      idType: orNone(user.valid_id_type),
      isPdf: path.toLowerCase().endsWith('.pdf'),
      url: null,
      error: null,
    });

    const { data, error: signError } = await supabase.storage
      .from('valid-ids')
      .createSignedUrl(path, 300);

    setIdPreview((current) => {
      // The Admin may have closed the panel or opened another ID while the
      // signature was in flight; that later choice wins.
      if (!current || current.name !== user.name) return current;
      if (signError || !data) {
        return { ...current, error: signError?.message ?? 'Could not open the ID file.' };
      }
      return { ...current, url: data.signedUrl };
    });
  };

  /**
   * Load and sign a customer's liveness frames.
   *
   * Signed in one request rather than four, and only for the account the Admin
   * actually opened: most rows are already decided and would be work thrown
   * away.
   */
  const loadFrames = async (user: UserRow) => {
    if (framesFor === user.users_id) {
      setFramesFor(null);
      return;
    }

    setFramesFor(user.users_id);

    if (frames[user.users_id]) return;

    await fetchFrames(user.users_id);
  };

  /** Signed frames for one account, cached so the strip and the panel share them. */
  const fetchFrames = async (userId: string): Promise<CaptureFrame[]> => {
    if (frames[userId]) return frames[userId];

    const { data, error: loadError } = await supabase
      .from('identity_captures')
      .select('step, file_url, captured_at')
      .eq('users_id', userId)
      .order('captured_at', { ascending: false });

    if (loadError || !data || data.length === 0) {
      if (loadError) setError(loadError.message);
      setFrames((current) => ({ ...current, [userId]: [] }));
      return [];
    }

    // A second attempt writes new rows and the old ones stay, so only the most
    // recent frame per step is of interest.
    const latest = new Map<string, string>();
    for (const row of data as { step: string; file_url: string }[]) {
      if (!latest.has(row.step)) latest.set(row.step, row.file_url);
    }

    const paths = [...latest.values()];

    const { data: signed } = await supabase.storage.from('valid-ids').createSignedUrls(paths, 300);

    const byPath = new Map<string, string>();
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) byPath.set(entry.path, entry.signedUrl);
    }

    const signedFrames = STEP_ORDER.filter((step) => latest.has(step))
      .map((step) => ({ step, url: byPath.get(latest.get(step)!) ?? '' }))
      .filter((frame) => frame.url);

    setFrames((current) => ({ ...current, [userId]: signedFrames }));
    return signedFrames;
  };

  /**
   * Open the live capture: every liveness frame, paged Right, Left, Front,
   * Blink. Falls back to the single selfie for an account verified before the
   * four-frame sequence existed.
   */
  const viewSelfie = async (user: UserRow) => {
    const path = user.selfie_url;
    if (!hasValue(path)) return;

    setError(null);
    setIdPreview({
      name: user.name,
      idType: 'Live capture taken at verification',
      isPdf: false,
      url: null,
      error: null,
    });

    const captured = await fetchFrames(user.users_id);

    if (captured.length > 0) {
      setIdPreview((current) =>
        !current || current.name !== user.name
          ? current
          : { ...current, frames: captured, index: 0, url: captured[0].url }
      );
      return;
    }

    const { data, error: signError } = await supabase.storage
      .from('valid-ids')
      .createSignedUrl(path, 300);

    setIdPreview((current) => {
      if (!current || current.name !== user.name) return current;
      if (signError || !data) {
        return { ...current, error: signError?.message ?? 'Could not open the photo.' };
      }
      return { ...current, url: data.signedUrl };
    });
  };

  /** Move to another liveness frame: by offset when `relative`, else to an index. */
  const showFrame = (value: number, relative = false) => {
    setIdPreview((current) => {
      if (!current?.frames?.length) return current;
      const count = current.frames.length;
      const next = relative ? ((current.index ?? 0) + value + count) % count : value;
      return { ...current, index: next, url: current.frames[next].url };
    });
  };

  // Escape is what a reviewer reaches for after a glance at the document, and
  // the same key should back out of the deactivation box.
  useEffect(() => {
    if (!idPreview && !deactivateTarget) return;

    const onKey = (event: KeyboardEvent) => {
      // Arrow keys page through the liveness frames while they are open.
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        showFrame(event.key === 'ArrowRight' ? 1 : -1, true);
        return;
      }
      if (event.key !== 'Escape') return;
      setIdPreview(null);
      setDeactivateTarget(null);
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [idPreview, deactivateTarget]);

  const approve = (userId: string) =>
    run(
      userId,
      () =>
        supabase.rpc('admin_set_verification', { p_users_id: userId, p_status: 'Approved' }),
      'Verification cleared. The customer can now sign in.'
    );

  const reject = (userId: string) =>
    run(
      userId,
      () =>
        supabase.rpc('admin_set_verification', { p_users_id: userId, p_status: 'Rejected' }),
      'Verification refused.'
    );

  const askDeactivate = (user: UserRow) => {
    setSuspendReason('');
    setDeactivateTarget({ users_id: user.users_id, name: user.name });
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;

    const reason = suspendReason.trim();
    if (!reason) return;

    const target = deactivateTarget;
    setDeactivateTarget(null);

    await run(
      target.users_id,
      () =>
        supabase.rpc('admin_set_account_status', {
          p_users_id: target.users_id,
          p_status: 'Inactive',
          p_reason: reason,
        }),
      'Account set to Inactive.'
    );
  };

  const reactivate = (userId: string) =>
    run(
      userId,
      () =>
        supabase.rpc('admin_set_account_status', {
          p_users_id: userId,
          p_status: 'Active',
          p_reason: NONE,
        }),
      'Account set back to Active.'
    );

  const actionButton = (label: string, userId: string, style: string, onClick: () => void) => (
    <button
      type="button"
      className={`dash-btn ${style}`}
      disabled={busyId === userId}
      onClick={onClick}
    >
      {label}
    </button>
  );

  // Who the account belongs to. Every tab opens with these.
  const contactColumns: Column[] = [
    { label: 'Name', render: (user) => orNone(user.name) },
    { label: 'Email', render: (user) => <span className="dash-table__muted">{user.email}</span> },
    {
      label: 'Contact Number',
      render: (user) => <span className="dash-table__muted">{orNone(user.contact_number)}</span>,
    },
  ];

  // Only the tabs that mix the two roles need to say which one a row is; on a
  // role tab the column would repeat the tab label on every line.
  const identityColumns: Column[] = [
    contactColumns[0],
    {
      label: 'User Type',
      render: (user) => <span className="dash-table__muted">{user.user_type}</span>,
    },
    ...contactColumns.slice(1),
  ];

  const farmLocationColumn: Column = {
    label: 'Farm Location',
    render: (user) => (
      <span className="dash-table__muted">{orNone(user.customers?.farm_location)}</span>
    ),
  };

  // Each tab labels its columns after the state being reviewed, so a date column
  // says which date it is instead of just "Date".
  /** The two images and the score, as the Admin needs them on any approved row. */
  const compareColumn: Column = {
    label: 'Identity',
    render: (user) => (
      <>
        <p className="dash-row__meta">
          {orNone(user.valid_id_type)}
          {user.face_match_score != null
            ? ` · matched ${Math.round(user.face_match_score * 100)}%`
            : ''}
        </p>

        <div className="dash-actions">
          {hasValue(user.valid_id_url) && (
            <button
              type="button"
              className="dash-btn dash-btn--slate"
              onClick={() => viewValidId(user)}
            >
              View ID
            </button>
          )}
          {hasValue(user.selfie_url) && (
            <button
              type="button"
              className="dash-btn dash-btn--slate"
              onClick={() => viewSelfie(user)}
            >
              View Photo
            </button>
          )}
          {hasValue(user.selfie_url) && (
            <button
              type="button"
              className="dash-btn dash-btn--ghost"
              onClick={() => loadFrames(user)}
            >
              {framesFor === user.users_id ? 'Hide frames' : 'All frames'}
            </button>
          )}

          {!hasValue(user.valid_id_url) && !hasValue(user.selfie_url) && (
            <span className="dash-table__muted">Not verified yet</span>
          )}
        </div>

        {framesFor === user.users_id && (
          <div className="face-strip face-strip--review">
            {frames[user.users_id] === undefined ? (
              <IonSpinner name="crescent" />
            ) : frames[user.users_id].length === 0 ? (
              <span className="dash-table__muted">
                No sequence on file. This account verified before the liveness sequence existed.
              </span>
            ) : (
              frames[user.users_id].map((frame) => (
                <figure className="face-strip__shot" key={frame.step}>
                  <img src={frame.url} alt={STEP_LABEL[frame.step] ?? frame.step} />
                  <figcaption>{STEP_LABEL[frame.step] ?? frame.step}</figcaption>
                </figure>
              ))
            )}
          </div>
        )}
      </>
    ),
  };

  const columns: Record<Tab, Column[]> = {
    Flagged: [
      ...identityColumns,
      {
        label: 'Face Match',
        render: (user) => (
          <>
            <p
              className={`match-score${
                (user.face_match_score ?? 0) < WEAK_MATCH ? ' match-score--weak' : ''
              }`}
            >
              {user.face_match_score == null
                ? 'Not scored'
                : `${Math.round(user.face_match_score * 100)}%`}
            </p>
            <p className="dash-row__meta">
              {user.liveness_passed_at ? 'Liveness passed' : 'Liveness not proven'}
            </p>
          </>
        ),
      },
      {
        label: 'Why It Was Flagged',
        render: (user) => (
          <span className="dash-table__muted">{orNone(user.verification_notes)}</span>
        ),
      },
      {
        // The two pictures side by side are the decision. The score is a hint;
        // the Admin is here because the machine was not sure.
        label: 'Compare',
        render: (user) => (
          <div className="dash-actions">
            {hasValue(user.valid_id_url) && (
              <button
                type="button"
                className="dash-btn dash-btn--slate"
                onClick={() => viewValidId(user)}
              >
                View ID
              </button>
            )}
            {hasValue(user.selfie_url) && (
              <button
                type="button"
                className="dash-btn dash-btn--slate"
                onClick={() => viewSelfie(user)}
              >
                View Photo
              </button>
            )}
          </div>
        ),
      },
      {
        label: 'Date Registered',
        render: (user) => <span className="dash-table__muted">{shortDate(user.created_at)}</span>,
      },
      {
        label: 'Verification Decision',
        render: (user) => (
          <div className="dash-actions">
            {actionButton('Approve', user.users_id, 'dash-btn--primary', () =>
              approve(user.users_id)
            )}
            {actionButton('Reject', user.users_id, 'dash-btn--ghost', () => reject(user.users_id))}
          </div>
        ),
      },
    ],

    // The ID stays reachable after approval: a case filed later is reviewed
    // against the same document. The farm address reads None for a customer who
    // only invests, which is a fact about them rather than a gap.
    Customers: [
      ...contactColumns,
      farmLocationColumn,
      compareColumn,
      {
        label: 'Date Approved',
        render: (user) => <span className="dash-table__muted">{shortDate(user.verified_at)}</span>,
      },
      {
        label: 'Deactivate Account',
        render: (user) => (
          <div className="dash-actions">
            {actionButton('Set Inactive', user.users_id, 'dash-btn--ghost', () =>
              askDeactivate(user)
            )}
          </div>
        ),
      },
    ],

    Inactive: [
      ...identityColumns,
      compareColumn,
      {
        label: 'Verification',
        render: (user) => (
          <span className={pillClass(user.verification_status)}>{user.verification_status}</span>
        ),
      },
      {
        label: 'Reason Deactivated',
        render: (user) => (
          <span className="dash-table__muted">{orNone(user.suspended_reason)}</span>
        ),
      },
      {
        label: 'Date Registered',
        render: (user) => <span className="dash-table__muted">{shortDate(user.created_at)}</span>,
      },
      {
        label: 'Restore Account',
        render: (user) => (
          <div className="dash-actions">
            {actionButton('Set Active', user.users_id, 'dash-btn--primary', () =>
              reactivate(user.users_id)
            )}
          </div>
        ),
      },
    ],
  };

  /**
   * A deactivated account is listed under Inactive only, whatever its
   * verification, so a row never shows in two tabs at once. The role tabs hold
   * the approved accounts, which is why they also test user_type and leave the
   * Admin account out.
   */
  const inTab = (user: UserRow, value: Tab) => {
    if (value === 'Inactive') return user.account_status === 'Inactive';
    if (user.account_status !== 'Active') return false;
    // Pending means the customer never finished the camera step, so there is
    // nothing for the Admin to judge; they are waiting on themselves.
    if (value === 'Flagged') return user.verification_status === 'Flagged';
    return user.verification_status === 'Approved' && user.user_type === 'Customer';
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    return users.filter((user) => {
      if (!inTab(user, tab)) return false;
      if (!term) return true;

      return [
        user.name,
        user.email,
        user.contact_number,
        user.user_type,
        user.customers?.farm_location ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [users, tab, search]);

  // Five accounts a page; a new tab or search starts again at page one.
  const paged = usePaged(visible, `${tab}|${search}`);

  const countFor = (value: Tab) => users.filter((user) => inTab(user, value)).length;

  const activeColumns = columns[tab];
  const term = search.trim();

  return (
    <IonPage>
      <DashboardHeader
        title="User Management"
        subtitle="Verify new accounts, and deactivate accounts that have been reported."
        accountName={profile?.name || 'System Administrator'}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          <div className="dash-toolbar-row">
            {TABS.map((value) => (
              <button
                key={value}
                type="button"
                className={`dash-tab${tab === value ? ' dash-tab--active' : ''}`}
                onClick={() => setTab(value)}
              >
                {value} ({countFor(value)})
              </button>
            ))}

            <label className="dash-search dash-spacer">
              <IonIcon icon={searchOutline} />
              <input
                type="search"
                placeholder="Search name, email, contact, location"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          <section className="dash-panel">
            <div className="dash-panel__head">
              <h2 className="dash-panel__title">{PANEL_TITLE[tab]}</h2>
              <span className="dash-stat__hint">
                {visible.length} shown{term ? ` for "${term}"` : ''}
              </span>
            </div>

            <div className="dash-panel__body dash-table-wrap">
              {loading ? (
                <Skeleton />
              ) : (
                /* The table is drawn even with no rows, so every tab keeps its own
                 * column labels on screen. */
                <table className="dash-table">
                  <thead>
                    <tr>
                      {activeColumns.map((column) => (
                        <th key={column.label}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={activeColumns.length}>
                          <EmptyState
                            title={term ? `No account matches "${term}"` : EMPTY_MESSAGE[tab]}
                            size={120}
                          />
                        </td>
                      </tr>
                    ) : (
                      paged.slice.map((user) => (
                        <tr key={user.users_id}>
                          {activeColumns.map((column) => (
                            <td key={column.label}>{column.render(user)}</td>
                          ))}
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

        {idPreview && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Submitted valid ID"
            onClick={() => setIdPreview(null)}
          >
            {/* The backdrop closes the panel, so a click that lands on the
                document itself must not travel up to it. */}
            <div className="dash-modal__panel" onClick={(event) => event.stopPropagation()}>
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">
                    {idPreview.frames?.length
                      ? `Live capture: ${STEP_LABEL[idPreview.frames[idPreview.index ?? 0].step] ?? ''} (${(idPreview.index ?? 0) + 1} of ${idPreview.frames.length})`
                      : idPreview.idType}
                  </p>
                  <h2 className="dash-modal__title">{idPreview.name}</h2>
                </div>

                <div className="dash-modal__tools">
                  {idPreview.url && (
                    <a
                      className="dash-btn dash-btn--ghost"
                      href={idPreview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IonIcon icon={openOutline} />
                      Full size
                    </a>
                  )}

                  <button
                    type="button"
                    className="dash-modal__close"
                    onClick={() => setIdPreview(null)}
                    aria-label="Close"
                  >
                    <IonIcon icon={closeOutline} />
                  </button>
                </div>
              </div>

              <div className="dash-modal__body">
                {idPreview.error ? (
                  <p className="dash-error">{idPreview.error}</p>
                ) : !idPreview.url ? (
                  <Skeleton />
                ) : idPreview.isPdf ? (
                  <iframe
                    className="dash-modal__frame"
                    src={idPreview.url}
                    title={`Valid ID submitted by ${idPreview.name}`}
                  />
                ) : (
                  <img
                    className="dash-modal__image"
                    src={idPreview.url}
                    alt={
                      idPreview.frames?.length
                        ? `${STEP_LABEL[idPreview.frames[idPreview.index ?? 0].step] ?? 'Live'} capture of ${idPreview.name}`
                        : `Valid ID submitted by ${idPreview.name}`
                    }
                  />
                )}
              </div>

              {idPreview.frames && idPreview.frames.length > 1 && (
                <div className="dash-modal__pager">
                  <button
                    type="button"
                    className="dash-btn dash-btn--ghost"
                    onClick={() => showFrame(-1, true)}
                    aria-label="Previous frame"
                  >
                    <IonIcon icon={chevronBackOutline} />
                  </button>

                  {idPreview.frames.map((frame, i) => (
                    <button
                      key={frame.step}
                      type="button"
                      className={`dash-btn ${i === idPreview.index ? 'dash-btn--primary' : 'dash-btn--ghost'}`}
                      onClick={() => showFrame(i)}
                      aria-current={i === idPreview.index}
                    >
                      {STEP_LABEL[frame.step] ?? frame.step}
                    </button>
                  ))}

                  <button
                    type="button"
                    className="dash-btn dash-btn--ghost"
                    onClick={() => showFrame(1, true)}
                    aria-label="Next frame"
                  >
                    <IonIcon icon={chevronForwardOutline} />
                  </button>
                </div>
              )}

              <p className="dash-modal__note">
                This link expires five minutes after opening. Reopen the ID if it stops loading.
              </p>
            </div>
          </Portal>
        )}
        {deactivateTarget && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Deactivate account"
            onClick={() => setDeactivateTarget(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--narrow"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Deactivate account</p>
                  <h2 className="dash-modal__title">{deactivateTarget.name}</h2>
                </div>

                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setDeactivateTarget(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body dash-modal__body--form">
                <p className="dash-modal__lead">
                  The account cannot sign in until it is set back to Active. The reason is stored
                  on the account and shown in the Inactive tab.
                </p>

                <div className="dash-reason-picks">
                  {SUSPENSION_REASONS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="dash-tab"
                      onClick={() => setSuspendReason(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div className="dash-field">
                  <label htmlFor="suspend-reason">Reason</label>
                  <textarea
                    id="suspend-reason"
                    className="dash-textarea"
                    rows={3}
                    maxLength={300}
                    placeholder="Say what happened, in the words the account holder will read."
                    value={suspendReason}
                    onChange={(event) => setSuspendReason(event.target.value)}
                  />
                </div>
              </div>

              <div className="dash-modal__foot">
                <button
                  type="button"
                  className="dash-btn dash-btn--ghost"
                  onClick={() => setDeactivateTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dash-btn dash-btn--primary"
                  disabled={!suspendReason.trim() || busyId === deactivateTarget.users_id}
                  onClick={confirmDeactivate}
                >
                  Set Inactive
                </button>
              </div>
            </div>
          </Portal>
        )}
      </IonContent>
    </IonPage>
  );
};

export default UserManagement;
