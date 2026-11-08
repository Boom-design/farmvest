import { useCallback, useEffect, useRef, useState } from 'react';
import { IonIcon, IonSpinner } from '@ionic/react';
import { cloudUploadOutline, copyOutline } from 'ionicons/icons';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';
import { hasValue, NONE, peso } from '../lib/format';
import './PaymentForm.css';

/** A FarmVest account to send payment to, published by the Admin. */
export type PaymentMethod = {
  payment_methods_id: string;
  method: string;
  account_name: string;
  account_number: string;
  bank_name: string;
  instructions: string;
};

/** Half now and the rest on delivery, or the whole fee up front. */
export const PAYMENT_TYPES = ['Full', '50% Downpayment'] as const;

const MAX_PROOF_BYTES = 5 * 1024 * 1024;

type PaymentFormProps = {
  /** Exactly one of these: the booking or the investment being paid for. */
  rentalId?: string;
  investmentId?: string;
  /** A completed project being repaid to its investors, through FarmVest. */
  repaymentProjectId?: string;
  /** The rest of a rental after a 50% downpayment: the form then takes only that. */
  balance?: boolean;
  /** The whole rental fee or investment amount. A downpayment is half of it. */
  fee: number;
  /** Called once the payment row is written, so the caller can reload. */
  onSubmitted: () => void;
  /** Rendered next to Submit, so each caller supplies its own way out. */
  cancelLabel: string;
  onCancel: () => void;
};

/**
 * Record a payment against one booking.
 *
 * FarmVest is not connected to GCash or to any bank. The money moves through the
 * renter's own app; what this form captures is the claim and the evidence, which
 * the Admin then checks against the receiving account. Nothing here touches
 * money, and the wording says so rather than implying a transaction.
 *
 * Shared by the booking dialog and My Rentals: paying is the same act whether it
 * happens at the moment of booking or later, and two copies of it would drift.
 */
const PaymentForm: React.FC<PaymentFormProps> = ({
  rentalId,
  investmentId,
  repaymentProjectId,
  balance = false,
  fee,
  onSubmitted,
  cancelLabel,
  onCancel,
}) => {
  const { profile } = useAuth();
  const { showSuccess } = useToast();

  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [payType, setPayType] = useState<string>(balance ? 'Balance' : PAYMENT_TYPES[0]);
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A missing field is reported beside the field itself, and the form scrolls
   * to it. A message at the foot of a long form, below the fold, read to a
   * renter as the button doing nothing.
   */
  const [fieldErrors, setFieldErrors] = useState<{ reference?: string; proof?: string }>({});
  const referenceRef = useRef<HTMLInputElement>(null);
  const proofRef = useRef<HTMLLabelElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const showFieldError = (field: 'reference' | 'proof', message: string) => {
    setError(null);
    setFieldErrors({ [field]: message });
    const target = field === 'reference' ? referenceRef.current : proofRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (field === 'reference') referenceRef.current?.focus({ preventScroll: true });
  };

  // A server error has no field to sit beside, so it is brought into view.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('payment_methods')
      .select('payment_methods_id, method, account_name, account_number, bank_name, instructions')
      .eq('is_active', true)
      .order('created_at');

    const rows = (data ?? []) as PaymentMethod[];
    setMethods(rows);
    setMethodId(rows[0]?.payment_methods_id ?? '');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // An investment is paid in full: half a pledge would leave the project short
  // of what it was counted as having raised.
  const types: readonly string[] = balance
    ? ['Balance']
    : investmentId || repaymentProjectId
      ? PAYMENT_TYPES.filter((type) => type === 'Full')
      : PAYMENT_TYPES;
  const subject = repaymentProjectId ? 'repayment' : investmentId ? 'investment' : 'booking';

  const amountFor = (type: string) => (type === 'Full' || type === 'Balance' ? fee : Math.round(fee / 2));

  const submit = async () => {
    if (!profile) return;

    if (!methodId) {
      setError('Pick the account you sent the payment to.');
      return;
    }

    if (!reference.trim()) {
      showFieldError('reference', 'Enter the reference number from your GCash or bank receipt.');
      return;
    }

    if (!proof) {
      showFieldError('proof', 'Upload a screenshot or photo of the receipt.');
      return;
    }

    if (proof.size > MAX_PROOF_BYTES) {
      showFieldError('proof', 'The receipt must be 5 MB or smaller.');
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    // Stored under the renter's own id, which is what the storage policy checks.
    const extension = proof.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${profile.users_id}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('payment-proofs')
      .upload(path, proof, { contentType: proof.type || undefined });

    if (uploadError) {
      setError(uploadError.message);
      setSaving(false);
      return;
    }

    // A repayment has its own table: it runs the other way, farm owner to
    // investors, and is paid out per investor once confirmed.
    const { error: insertError } = repaymentProjectId
      ? await supabase.from('repayments').insert({
          projects_id: repaymentProjectId,
          payment_methods_id: methodId,
          amount: amountFor(payType),
          reference_no: reference.trim(),
          proof_url: path,
          status: 'Submitted',
          admin_notes: NONE,
        })
      : await supabase.from('payments').insert({
          ...(investmentId ? { investments_id: investmentId } : { rentals_id: rentalId }),
          payment_methods_id: methodId,
          amount: amountFor(payType),
          payment_type: payType,
          reference_no: reference.trim(),
          proof_url: path,
          status: 'Submitted',
          admin_notes: NONE,
        });

    if (insertError) {
      setError(insertError.message);
    } else {
      showSuccess('Payment submitted. The administrator will verify it.');
      onSubmitted();
    }

    setSaving(false);
  };

  return (
    <>
      <div className="dash-modal__body dash-modal__body--form">
        <p className="dash-modal__lead">
          Send the amount through your own GCash or bank app, then record the reference here.
          FarmVest confirms the {subject} once the administrator has checked it against the
          receiving account{repaymentProjectId ? ', then pays each investor their share' : ''}.
        </p>

        {methods === null ? (
          <div className="dash-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : methods.length === 0 ? (
          <p className="dash-error">
            No payment account has been published yet. Ask the administrator to add one, then pay
            from {repaymentProjectId ? 'Reports' : investmentId ? 'My Investments' : 'My Rentals'}.
          </p>
        ) : (
          <>
            <div className="pay-choice" role="group" aria-label="How much to pay">
              {types.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`pay-option${payType === type ? ' pay-option--on' : ''}`}
                  onClick={() => setPayType(type)}
                >
                  <span className="pay-option__label">{type}</span>
                  <span className="pay-option__amount">{peso(amountFor(type))}</span>
                  <span className="pay-option__note">
                    {repaymentProjectId
                      ? 'Capital plus the agreed return, for every investor.'
                      : investmentId
                      ? 'The full amount you committed.'
                      : type === 'Balance'
                      ? 'The rest of the rental fee, after your downpayment.'
                      : type === 'Full'
                        ? 'Nothing left to settle on delivery.'
                        : `${peso(fee - amountFor(type))} due on delivery.`}
                  </span>
                </button>
              ))}
            </div>

            {/* The account details are the point of the screen, so they are laid
                out to be read off and typed into another app, not folded into a
                dropdown label. */}
            <div className="pay-accounts">
              {methods.map((method) => (
                <label
                  key={method.payment_methods_id}
                  className={`pay-account${
                    methodId === method.payment_methods_id ? ' pay-account--on' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="payment-method"
                    value={method.payment_methods_id}
                    checked={methodId === method.payment_methods_id}
                    onChange={() => setMethodId(method.payment_methods_id)}
                  />

                  <span className="pay-account__body">
                    <span className="pay-account__head">
                      {method.method}
                      {hasValue(method.bank_name) ? ` — ${method.bank_name}` : ''}
                    </span>
                    <span className="pay-account__number">{method.account_number}</span>
                    <span className="pay-account__name">{method.account_name}</span>
                    {hasValue(method.instructions) && (
                      <span className="pay-account__note">{method.instructions}</span>
                    )}
                  </span>

                  <button
                    type="button"
                    className="dash-btn dash-btn--slate pay-account__copy"
                    onClick={(event) => {
                      event.preventDefault();
                      navigator.clipboard?.writeText(method.account_number);
                      showSuccess('Account number copied.');
                    }}
                  >
                    <IonIcon icon={copyOutline} />
                    Copy
                  </button>
                </label>
              ))}
            </div>

            <div className="dash-form dash-form--two">
              <div className="dash-field">
                <label htmlFor="pay-reference">
                  Reference Number <span className="dash-required">*</span>
                </label>
                <input
                  id="pay-reference"
                  ref={referenceRef}
                  className={`dash-input${fieldErrors.reference ? ' dash-input--invalid' : ''}`}
                  placeholder="From your GCash or bank receipt"
                  value={reference}
                  aria-invalid={Boolean(fieldErrors.reference)}
                  aria-describedby={fieldErrors.reference ? 'pay-reference-error' : undefined}
                  onChange={(event) => {
                    setReference(event.target.value);
                    if (fieldErrors.reference) setFieldErrors({});
                  }}
                />
                {fieldErrors.reference && (
                  <p id="pay-reference-error" className="dash-field__error" role="alert">
                    {fieldErrors.reference}
                  </p>
                )}
              </div>

              <div className="dash-field">
                <label htmlFor="pay-proof">
                  Proof of Payment <span className="dash-required">*</span>
                </label>
                <label
                  ref={proofRef}
                  className={`dash-upload${fieldErrors.proof ? ' dash-upload--invalid' : ''}`}
                  htmlFor="pay-proof"
                >
                  <IonIcon icon={cloudUploadOutline} />
                  <span>{proof ? proof.name : 'Screenshot or photo, up to 5 MB'}</span>
                </label>
                <input
                  id="pay-proof"
                  type="file"
                  accept="image/*,application/pdf"
                  hidden
                  onChange={(event) => {
                    setProof(event.target.files?.[0] ?? null);
                    if (fieldErrors.proof) setFieldErrors({});
                  }}
                />
                {fieldErrors.proof && (
                  <p className="dash-field__error" role="alert">
                    {fieldErrors.proof}
                  </p>
                )}
              </div>
            </div>

            {error && (
              <p ref={errorRef} className="dash-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>

      <div className="dash-modal__foot">
        <button type="button" className="dash-btn dash-btn--ghost" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className="dash-btn dash-btn--primary"
          disabled={saving || !methods || methods.length === 0}
          onClick={submit}
        >
          {saving ? 'Submitting...' : `Submit ${peso(amountFor(payType))}`}
        </button>
      </div>
    </>
  );
};

export default PaymentForm;
