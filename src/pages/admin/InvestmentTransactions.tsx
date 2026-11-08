import { useCallback, useEffect, useMemo, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { cashOutline, closeOutline, imageOutline, locationOutline } from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import EmptyState from '../../components/EmptyState';
import Portal from '../../components/Portal';
import { useToast } from '../../components/Toast';
import Pager, { usePaged } from '../../components/Pager';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { orNone, peso, pillClass, shortDate } from '../../lib/format';
import { isReleasedStage } from '../../lib/funding';
import { PAYOUT_COLUMNS, accountsOf, describeAccount, hasPayoutAccount, type PayoutAccount } from '../../lib/payout';
import { COMMISSION_RATE, projectCommission } from '../../lib/revenue';
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

type InvestmentRow = {
  investments_id: string;
  amount: number;
  milestone_stage: string;
  created_at: string;
  customers: { users: { name: string; email: string } | null } | null;
  projects: { projects_id: string; title: string; status: string } | null;
  payments: PaymentRow[];
};

type PaymentRow = {
  payments_id: string;
  amount: number;
  reference_no: string;
  proof_url: string | null;
  status: string;
  admin_notes: string;
  submitted_at: string;
  payment_methods: { method: string; account_number: string } | null;
};

/** A farm owner's repayment of a completed project, waiting on the Admin. */
type RepaymentRow = {
  repayments_id: string;
  projects_id: string;
  amount: number;
  reference_no: string;
  proof_url: string | null;
  status: string;
  submitted_at: string;
  projects: { title: string; expected_roi_percent: number; customers: { users: { name: string } | null } | null } | null;
};

/** One investor's share of a repayment, with the payout reference being typed. */
type ShareRow = {
  investments_id: string;
  amount: number;
  customers: ({ users: { name: string; email: string } | null } & Partial<PayoutAccount>) | null;
};

/** The newest payment sent for an investment decides where it stands. */
const latestPayment = (row: InvestmentRow) =>
  [...(row.payments ?? [])].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];

type ProgressRow = {
  progress_updates_id: string;
  photo_url: string | null;
  captured_at: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  projects: { title: string } | null;
};

const MILESTONES = ['Awaiting Release', 'Released'];

const InvestmentTransactions: React.FC = () => {
  const { profile } = useAuth();
  const { showSuccess } = useToast();

  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  /** The receipt open for review, with its signed link once it arrives. */
  const [reviewing, setReviewing] = useState<{
    payment: PaymentRow;
    investor: string;
    url: string | null;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [repayments, setRepayments] = useState<RepaymentRow[]>([]);
  /** The repayment open for review: its receipt, and each investor's share. */
  const [settling, setSettling] = useState<{
    repayment: RepaymentRow;
    url: string | null;
    shares: ShareRow[] | null;
  } | null>(null);
  const [payoutRefs, setPayoutRefs] = useState<Record<string, string>>({});
  const [repayReject, setRepayReject] = useState('');
  /** The project whose progress is open in the panel, with its updates once loaded. */
  const [progressOf, setProgressOf] = useState<{ title: string; rows: ProgressRow[] | null } | null>(null);
  const [milestone, setMilestone] = useState('Awaiting Release');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);

    const [investmentsRes, repaymentsRes] = await Promise.all([
      supabase
        .from('investments')
        .select(
          'investments_id, amount, milestone_stage, created_at, customers(users(name, email)), projects(projects_id, title, status), payments(payments_id, amount, reference_no, proof_url, status, admin_notes, submitted_at, payment_methods(method, account_number))'
        )
        .order('created_at', { ascending: false }),
      supabase
        .from('repayments')
        .select(
          'repayments_id, projects_id, amount, reference_no, proof_url, status, submitted_at, projects(title, expected_roi_percent, customers(users(name)))'
        )
        .eq('status', 'Submitted')
        .order('submitted_at', { ascending: false }),
    ]);

    const failed = [investmentsRes, repaymentsRes].find((result) => result.error);

    if (failed?.error) {
      setError(failed.error.message);
    } else {
      setInvestments((investmentsRes.data ?? []) as unknown as InvestmentRow[]);
      setRepayments((repaymentsRes.data ?? []) as unknown as RepaymentRow[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () =>
      investments.filter(
        (row) => isReleasedStage(row.milestone_stage) === (milestone === 'Released')
      ),
    [investments, milestone]
  );

  const totals = useMemo(() => {
    const sum = (rows: InvestmentRow[]) =>
      rows.reduce((total, row) => total + Number(row.amount ?? 0), 0);

    return {
      all: sum(investments),
      shown: sum(visible),
      investors: new Set(investments.map((row) => row.customers?.users?.email).filter(Boolean)).size,
    };
  }, [investments, visible]);

  const paged = usePaged(visible, milestone);
  const pagedProgress = usePaged(progressOf?.rows ?? [], progressOf?.title);

  const openProgress = async (row: InvestmentRow) => {
    if (!row.projects) return;
    setProgressOf({ title: row.projects.title, rows: null });

    const { data, error: loadError } = await supabase
      .from('progress_updates')
      .select('progress_updates_id, photo_url, captured_at, latitude, longitude, notes, projects(title)')
      .eq('projects_id', row.projects.projects_id)
      .order('captured_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
      setProgressOf(null);
      return;
    }
    setProgressOf({ title: row.projects.title, rows: (data ?? []) as unknown as ProgressRow[] });
  };

  /** Receipts live in a private bucket, opened through a five-minute signed link. */
  const openReview = async (payment: PaymentRow, investor: string) => {
    setRejectReason('');
    setReviewing({ payment, investor, url: null });
    if (!payment.proof_url) return;

    const { data, error: signError } = await supabase.storage
      .from('payment-proofs')
      .createSignedUrl(payment.proof_url, 300);

    if (signError || !data) {
      setError(signError?.message ?? 'Could not open the receipt.');
      return;
    }
    setReviewing((current) => (current ? { ...current, url: data.signedUrl } : current));
  };

  const roiOf = (repayment: RepaymentRow) => Number(repayment.projects?.expected_roi_percent ?? 0) / 100;
  const cents = (value: number) => Math.round(value * 100) / 100;

  const openSettle = async (repayment: RepaymentRow) => {
    setSettling({ repayment, url: null, shares: null });
    setPayoutRefs({});
    setRepayReject('');

    const [signed, sharesRes] = await Promise.all([
      repayment.proof_url
        ? supabase.storage.from('payment-proofs').createSignedUrl(repayment.proof_url, 300)
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('investments')
        .select(`investments_id, amount, customers(${PAYOUT_COLUMNS}, users(name, email))`)
        .eq('projects_id', repayment.projects_id),
    ]);

    if (sharesRes.error) {
      setError(sharesRes.error.message);
      setSettling(null);
      return;
    }
    setSettling({
      repayment,
      url: signed.data?.signedUrl ?? null,
      shares: (sharesRes.data ?? []) as unknown as ShareRow[],
    });
  };

  /**
   * Confirm the repayment and record what went to each investor. Every share
   * needs its own transfer reference, because each investor checks their own
   * account, not the farm owner's.
   */
  const settle = async (confirm: boolean) => {
    if (!settling?.shares) return;
    const { repayment, shares } = settling;

    if (!confirm) {
      if (!repayReject.trim()) {
        setError('Say why the repayment is rejected, so the farm owner knows what to fix.');
        return;
      }
    } else {
      const missing = shares.find((share) => !payoutRefs[share.investments_id]?.trim());
      if (missing) {
        setError(`Enter the payout reference for ${missing.customers?.users?.name ?? 'every investor'}.`);
        return;
      }
    }

    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase
      .from('repayments')
      .update({
        status: confirm ? 'Confirmed' : 'Rejected',
        admin_notes: confirm ? 'None' : repayReject.trim(),
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile?.email ?? null,
      })
      .eq('repayments_id', repayment.repayments_id);

    if (!updateError && confirm) {
      const { error: payoutError } = await supabase.from('investor_payouts').insert(
        shares.map((share) => ({
          investments_id: share.investments_id,
          principal: Number(share.amount),
          return_amount: cents(Number(share.amount) * roiOf(repayment)),
          total: cents(Number(share.amount) * (1 + roiOf(repayment))),
          reference_no: payoutRefs[share.investments_id].trim(),
          paid_by: profile?.email ?? null,
        }))
      );
      if (payoutError) {
        setError(payoutError.message);
        setBusy(false);
        return;
      }

      // The repayment is what completes a project: only now does it count
      // toward the farm owner's track record and funding ceiling.
      const { error: completeError } = await supabase
        .from('projects')
        .update({ status: 'Completed', completed_at: new Date().toISOString() })
        .eq('projects_id', repayment.projects_id);
      if (completeError) {
        setError(completeError.message);
        setBusy(false);
        return;
      }
    }

    if (updateError) {
      setError(updateError.message);
    } else {
      showSuccess(
        confirm
          ? `Repayment confirmed, ${shares.length} investor payout${shares.length === 1 ? '' : 's'} recorded, and the project is completed.`
          : 'Repayment rejected. The farm owner can send it again.'
      );
      setSettling(null);
      await load();
    }
    setBusy(false);
  };

  const decide = async (status: 'Confirmed' | 'Rejected') => {
    if (!reviewing) return;
    if (status === 'Rejected' && !rejectReason.trim()) {
      setError('Say why the payment is rejected, so the investor knows what to fix.');
      return;
    }

    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status,
        admin_notes: status === 'Rejected' ? rejectReason.trim() : 'None',
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile?.email ?? null,
      })
      .eq('payments_id', reviewing.payment.payments_id);

    if (updateError) {
      setError(updateError.message);
    } else {
      showSuccess(
        status === 'Confirmed'
          ? 'Payment confirmed. The investment is now paid.'
          : 'Payment rejected. The investor can send another.'
      );
      setReviewing(null);
      await load();
    }

    setBusy(false);
  };

  return (
    <IonPage>
      <DashboardHeader
        title="Investment Transactions"
        subtitle="Monitor funding, milestone releases, and the progress evidence posted by farm owners."
        accountName={profile?.name || 'System Administrator'}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          <div className="dash-grid dash-grid--stats">
            <div className="dash-card dash-stat">
              <div className="dash-stat__icon dash-stat__icon--gold">
                <IonIcon icon={cashOutline} />
              </div>
              <div>
                <p className="dash-stat__label">Total Invested</p>
                <p className="dash-stat__value">{peso(totals.all)}</p>
                <p className="dash-stat__hint">{investments.length} transactions</p>
              </div>
            </div>

            <div className="dash-card dash-stat">
              <div className="dash-stat__icon dash-stat__icon--green">
                <IonIcon icon={cashOutline} />
              </div>
              <div>
                <p className="dash-stat__label">Shown in This Milestone</p>
                <p className="dash-stat__value">{peso(totals.shown)}</p>
                <p className="dash-stat__hint">{visible.length} transactions</p>
              </div>
            </div>

            <div className="dash-card dash-stat">
              <div className="dash-stat__icon dash-stat__icon--slate">
                <IonIcon icon={cashOutline} />
              </div>
              <div>
                <p className="dash-stat__label">Investors Participating</p>
                <p className="dash-stat__value">{totals.investors}</p>
                <p className="dash-stat__hint">Unique investors</p>
              </div>
            </div>
          </div>

          {repayments.length > 0 && (
            <section className="dash-panel" style={{ marginTop: 16 }}>
              <div className="dash-panel__head">
                <h2 className="dash-panel__title">Repayments to Verify</h2>
                <span className="dash-stat__hint">{repayments.length} waiting</span>
              </div>
              <div className="dash-panel__body dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Farm Owner</th>
                      <th>Project</th>
                      <th>Amount</th>
                      <th>Reference</th>
                      <th>Sent</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repayments.map((row) => (
                      <tr key={row.repayments_id}>
                        <td>{orNone(row.projects?.customers?.users?.name)}</td>
                        <td className="dash-table__muted">{orNone(row.projects?.title)}</td>
                        <td>{peso(row.amount)}</td>
                        <td className="dash-table__muted">{row.reference_no}</td>
                        <td className="dash-table__muted">{shortDate(row.submitted_at)}</td>
                        <td>
                          <button type="button" className="dash-btn dash-btn--gold" onClick={() => openSettle(row)}>
                            Review and Pay Out
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div>
            <div>
              <div className="dash-toolbar-row" style={{ marginTop: 16 }}>
                {MILESTONES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`dash-tab${milestone === value ? ' dash-tab--active' : ''}`}
                    onClick={() => setMilestone(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>

              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">Investment Records</h2>
                  <span className="dash-stat__hint">{visible.length} shown</span>
                </div>

                <div className="dash-panel__body dash-table-wrap">
                  {loading ? (
                    <Skeleton />
                  ) : (
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Investor</th>
                          <th>Project</th>
                          <th>Amount Invested</th>
                          <th>Payment</th>
                          <th>Progress</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.length === 0 ? (
                          <tr>
                            <td colSpan={5}>
                              <EmptyState
                                title="No investment here yet"
                                size={120}
                              />
                            </td>
                          </tr>
                        ) : (
                          paged.slice.map((row) => (
                          <tr key={row.investments_id}>
                            <td>
                              <p className="dash-row__title">{orNone(row.customers?.users?.name)}</p>
                              <p className="dash-row__meta">{orNone(row.customers?.users?.email)}</p>
                            </td>
                            <td>
                              <p className="dash-row__title">{orNone(row.projects?.title)}</p>
                              <span className={pillClass(row.projects?.status ?? '')}>
                                {orNone(row.projects?.status)}
                              </span>
                            </td>
                            <td>
                              <p className="dash-row__title">{peso(row.amount)}</p>
                              <p className="dash-row__meta">Invested {shortDate(row.created_at)}</p>
                            </td>
                            <td>
                              {(() => {
                                const payment = latestPayment(row);
                                if (!payment) {
                                  return (
                                    <span className="dash-pill dash-pill--slate">Awaiting payment</span>
                                  );
                                }
                                return (
                                  <button
                                    type="button"
                                    className={`dash-btn ${
                                      payment.status === 'Submitted' ? 'dash-btn--gold' : 'dash-btn--slate'
                                    }`}
                                    onClick={() => openReview(payment, orNone(row.customers?.users?.name))}
                                  >
                                    {payment.status === 'Submitted'
                                      ? 'Review Payment'
                                      : payment.status === 'Confirmed'
                                        ? 'Paid'
                                        : payment.status === 'Refunded'
                                          ? 'Refunded'
                                          : 'Rejected'}
                                  </button>
                                );
                              })()}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="dash-btn dash-btn--slate"
                                onClick={() => openProgress(row)}
                              >
                                View Progress
                              </button>
                            </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                  <Pager {...paged} />
                </div>
              </section>
            </div>

          </div>
        </div>
        {progressOf && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Progress updates"
            onClick={() => setProgressOf(null)}
          >
            <div className="dash-modal__panel" onClick={(event) => event.stopPropagation()}>
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">
                    Progress Updates
                    {progressOf.rows ? ` · ${progressOf.rows.length} posted` : ''}
                  </p>
                  <h2 className="dash-modal__title">{progressOf.title}</h2>
                </div>
                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setProgressOf(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body">
                {progressOf.rows === null ? (
                  <Skeleton />
                ) : progressOf.rows.length === 0 ? (
                  <EmptyState
                    title="No progress posted yet"
                    message="The farm owner has not posted an update on this project."
                    size={120}
                  />
                ) : (
                  <>
                    {pagedProgress.slice.map((update) => (
                      <div className="progress-item" key={update.progress_updates_id}>
                        {update.photo_url ? (
                          <a href={update.photo_url} target="_blank" rel="noopener noreferrer">
                            <img className="progress-item__photo" src={update.photo_url} alt="" />
                          </a>
                        ) : (
                          <div className="progress-item__photo progress-item__photo--empty">
                            <IonIcon icon={imageOutline} />
                          </div>
                        )}
                        <div className="progress-item__body">
                          <p className="progress-item__meta">
                            Taken {shortDate(update.captured_at)}
                            {update.latitude !== null && update.longitude !== null && (
                              <>
                                {' · '}
                                <a
                                  href={`https://www.google.com/maps?q=${update.latitude},${update.longitude}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <IonIcon icon={locationOutline} /> View on map
                                </a>
                              </>
                            )}
                          </p>
                          <p className="progress-item__notes">{update.notes || 'No notes.'}</p>
                        </div>
                      </div>
                    ))}
                    <Pager {...pagedProgress} />
                  </>
                )}
              </div>
            </div>
          </Portal>
        )}

        {settling && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Repayment"
            onClick={() => setSettling(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--wide"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">
                    Repayment · {peso(settling.repayment.amount)} · Ref {settling.repayment.reference_no}
                  </p>
                  <h2 className="dash-modal__title">{orNone(settling.repayment.projects?.title)}</h2>
                </div>
                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setSettling(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body dash-modal__body--form">
                {settling.url && (
                  <img className="dash-modal__image" src={settling.url} alt="Repayment receipt" />
                )}

                <p className="dash-notice">
                  Check the receipt against FarmVest's account. Then send each investor their capital
                  plus the {Number(settling.repayment.projects?.expected_roi_percent ?? 0)}% return and
                  enter the reference of each transfer. The rest of the repayment is FarmVest's{' '}
                  {COMMISSION_RATE * 100}% commission, earned now that the project has succeeded.
                </p>

                {settling.shares === null ? (
                  <Skeleton />
                ) : (
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th>Investor</th>
                        <th>Capital</th>
                        <th>Return</th>
                        <th>Send</th>
                        <th>Payout Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settling.shares.map((share) => (
                        <tr key={share.investments_id}>
                          <td>
                            <p className="dash-row__title">{orNone(share.customers?.users?.name)}</p>
                            <p className="dash-row__meta">{orNone(share.customers?.users?.email)}</p>
                            {hasPayoutAccount(share.customers) ? (
                              accountsOf(share.customers).map((account) => (
                                <p key={account.payout_accounts_id} className="dash-row__meta">
                                  Send to: {describeAccount(account)}
                                  {account.is_default ? ' (Default)' : ''}
                                </p>
                              ))
                            ) : (
                              <p className="dash-error">No payout account set</p>
                            )}
                          </td>
                          <td>{peso(share.amount)}</td>
                          <td>{peso(cents(Number(share.amount) * roiOf(settling.repayment)))}</td>
                          <td className="dash-row__title">
                            {peso(cents(Number(share.amount) * (1 + roiOf(settling.repayment))))}
                          </td>
                          <td>
                            <input
                              className="dash-input"
                              placeholder="GCash or bank reference"
                              value={payoutRefs[share.investments_id] ?? ''}
                              onChange={(event) =>
                                setPayoutRefs({ ...payoutRefs, [share.investments_id]: event.target.value })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                      <tr className="dash-table__totals">
                        <td>FarmVest commission ({COMMISSION_RATE * 100}%)</td>
                        <td colSpan={2}>
                          of {peso(settling.shares.reduce((sum, share) => sum + Number(share.amount), 0))} raised
                        </td>
                        <td className="dash-row__title">
                          {peso(projectCommission(settling.shares.reduce((sum, share) => sum + Number(share.amount), 0)))}
                        </td>
                        <td className="dash-table__muted">Kept by FarmVest</td>
                      </tr>
                    </tbody>
                  </table>
                )}

                <div className="dash-field">
                  <label htmlFor="repay-reject">Reason, if rejecting</label>
                  <input
                    id="repay-reject"
                    className="dash-input"
                    placeholder="Amount short, reference not found, ..."
                    value={repayReject}
                    onChange={(event) => setRepayReject(event.target.value)}
                  />
                </div>
              </div>

              <div className="dash-modal__foot">
                <button type="button" className="dash-btn dash-btn--ghost" disabled={busy} onClick={() => settle(false)}>
                  Reject
                </button>
                <button
                  type="button"
                  className="dash-btn dash-btn--primary"
                  disabled={busy || settling.shares === null}
                  onClick={() => settle(true)}
                >
                  Confirm and Record Payouts
                </button>
              </div>
            </div>
          </Portal>
        )}

        {reviewing && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Investment payment"
            onClick={() => setReviewing(null)}
          >
            <div className="dash-modal__panel" onClick={(event) => event.stopPropagation()}>
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">
                    {reviewing.investor} · {peso(reviewing.payment.amount)}
                  </p>
                  <h2 className="dash-modal__title">Ref {reviewing.payment.reference_no}</h2>
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
                {!reviewing.payment.proof_url ? (
                  <p className="dash-stat__hint">No receipt file was attached to this payment.</p>
                ) : !reviewing.url ? (
                  <Skeleton />
                ) : reviewing.payment.proof_url.toLowerCase().endsWith('.pdf') ? (
                  <iframe className="dash-modal__frame" src={reviewing.url} title="Proof of payment" />
                ) : (
                  <img className="dash-modal__image" src={reviewing.url} alt="Proof of payment" />
                )}
              </div>

              <p className="dash-modal__note">
                Check this reference against{' '}
                {reviewing.payment.payment_methods
                  ? `${reviewing.payment.payment_methods.method} ${reviewing.payment.payment_methods.account_number}`
                  : 'the receiving account'}{' '}
                before confirming. FarmVest cannot verify a payment on its own.
                {reviewing.payment.status === 'Rejected' && ` Rejected: ${reviewing.payment.admin_notes}`}
              </p>

              {reviewing.payment.status === 'Submitted' && (
                <>
                  <div className="dash-modal__body dash-modal__body--form">
                    <div className="dash-field">
                      <label htmlFor="reject-reason">Reason, if rejecting</label>
                      <input
                        id="reject-reason"
                        className="dash-input"
                        placeholder="Amount does not match, reference not found, ..."
                        value={rejectReason}
                        onChange={(event) => setRejectReason(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="dash-modal__foot">
                    <button
                      type="button"
                      className="dash-btn dash-btn--ghost"
                      disabled={busy}
                      onClick={() => decide('Rejected')}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="dash-btn dash-btn--primary"
                      disabled={busy}
                      onClick={() => decide('Confirmed')}
                    >
                      Confirm Payment
                    </button>
                  </div>
                </>
              )}
            </div>
          </Portal>
        )}
      </IonContent>
    </IonPage>
  );
};

export default InvestmentTransactions;
