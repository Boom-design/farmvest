import { useCallback, useEffect, useMemo, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import Portal from '../../components/Portal';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { hasValue, NONE, orNone, peso, pillClass, shortDate } from '../../lib/format';
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

type RentalRow = {
  rentals_id: string;
  start_date: string;
  end_date: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  returned_at: string | null;
  return_condition: string;
  damage_notes: string | null;
  damage_charge: number;
  /** Set at dispatch by the Admin. */
  dispatched_at: string | null;
  delivery_window: string;
  driver_name: string;
  driver_contact: string;
  /** Set at receipt by the farm owner, never by the Admin. */
  delivered_at: string | null;
  received_by: string;
  customers: { users: { name: string; contact_number: string } | null } | null;
  equipment: {
    equipment_id: string;
    name: string;
    unit_code: string | null;
    price_per_day: number;
  } | null;
  contracts: { signatory_name: string; signed_at: string; terms_snapshot: string }[];
};

/**
 * A payment the renter says they sent.
 *
 * FarmVest processes nothing: the money moved through the renter's own app, and
 * what arrives here is the claim, the reference and the receipt. Confirming one
 * means the Admin has found it in the receiving account, which is why it cannot
 * be automatic.
 */
type PaymentRow = {
  payments_id: string;
  rentals_id: string;
  amount: number;
  payment_type: string;
  reference_no: string;
  proof_url: string | null;
  status: string;
  admin_notes: string;
  submitted_at: string;
  payment_methods: { method: string; account_number: string; bank_name: string } | null;
};

/** What the Admin fills in when a unit leaves the yard. */
const emptyDispatch = {
  delivery_window: '',
  driver_name: '',
  driver_contact: '',
};

/**
 * The arrival window filled in for the Admin when a unit is dispatched.
 *
 * The unit is due on the booking's first day, so that is the date used -- or
 * today, if the start date has already come and the unit is only leaving now.
 * A same-day dispatch after 12NN can only make the afternoon run.
 */
const expectedArrival = (startDate: string, now = new Date()) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = startDate.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const due = start > today ? start : today;

  const sameDay = due.getTime() === today.getTime();
  const slot = sameDay && now.getHours() >= 12 ? 'afternoon (1PM to 5PM)' : 'morning (8AM to 12NN)';
  const date = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return `${date}, ${slot}`;
};

/** What the Admin can record at the return inspection. */
const RETURN_CONDITIONS = ['Good', 'Minor Damage', 'Major Damage', 'Not Returned'];

/** Conditions that put the unit into Maintenance and open a repair log. */
const DAMAGED = ['Minor Damage', 'Major Damage', 'Not Returned'];

/**
 * Where the Admin can move a booking by hand from each status.
 *
 * The main steps have their own buttons -- Confirm waits for the payment,
 * Dispatch asks for the driver, Inspect Return records the condition -- so the
 * dropdown carries only the side moves. Active is never offered: the farm
 * owner's receipt is what makes a rental Active, because the Admin did not
 * receive the unit.
 */
const NEXT_STATUSES: Record<string, string[]> = {
  Pending: ['On Hold - Weather Advisory', 'Rescheduled', 'Cancelled'],
  Confirmed: ['On Hold - Weather Advisory', 'Rescheduled', 'Cancelled'],
  'Out for Delivery': ['Rescheduled', 'Cancelled'],
  'On Hold - Weather Advisory': ['Confirmed', 'Rescheduled', 'Cancelled'],
  Rescheduled: ['Confirmed', 'Cancelled'],
  Active: [],
  'Under Inspection': [],
  Completed: [],
  Cancelled: [],
};

const FILTERS = [
  'Pending',
  'Confirmed',
  'Out for Delivery',
  'Active',
  // No Under Inspection tab: Inspect Return closes a booking in one step, so
  // nothing waits in that status and the tab could only ever be empty.
  'On Hold - Weather Advisory',
];

const emptyInspection = {
  returned_at: new Date().toISOString().slice(0, 10),
  return_condition: 'Good',
  damage_notes: '',
  damage_charge: '',
  repair_cost: '',
};

const RentalBookings: React.FC = () => {
  const { profile } = useAuth();
  const { showSuccess } = useToast();

  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [filter, setFilter] = useState('Pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [inspecting, setInspecting] = useState<RentalRow | null>(null);
  const [inspection, setInspection] = useState(emptyInspection);
  const [contractOf, setContractOf] = useState<RentalRow | null>(null);

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [proofOf, setProofOf] = useState<{ payment: PaymentRow; url: string | null } | null>(null);
  const [rejecting, setRejecting] = useState<PaymentRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [dispatching, setDispatching] = useState<RentalRow | null>(null);
  const [dispatch, setDispatch] = useState(emptyDispatch);

  const load = useCallback(async () => {
    setError(null);

    const { data, error: loadError } = await supabase
      .from('rentals')
      .select(
        'rentals_id, start_date, end_date, status, admin_notes, created_at, returned_at, return_condition, damage_notes, damage_charge, delivery_window, driver_name, driver_contact, dispatched_at, delivered_at, received_by, customers(users(name, contact_number)), equipment(equipment_id, name, unit_code, price_per_day), contracts(signatory_name, signed_at, terms_snapshot)'
      )
      .order('start_date', { ascending: true });

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    setRentals((data ?? []) as unknown as RentalRow[]);

    const { data: paymentRows } = await supabase
      .from('payments')
      .select(
        'payments_id, rentals_id, amount, payment_type, reference_no, proof_url, status, admin_notes, submitted_at, payment_methods(method, account_number, bank_name)'
      )
      .order('submitted_at', { ascending: false });

    setPayments((paymentRows ?? []) as unknown as PaymentRow[]);

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const paymentFor = (rentalId: string) =>
    payments.find((payment) => payment.rentals_id === rentalId);

  /** Receipts live in a private bucket, opened through a short-lived signed URL. */
  const viewProof = async (payment: PaymentRow) => {
    if (!payment.proof_url) return;

    setProofOf({ payment, url: null });

    const { data, error: signError } = await supabase.storage
      .from('payment-proofs')
      .createSignedUrl(payment.proof_url, 300);

    if (signError || !data) {
      setError(signError?.message ?? 'Could not open the receipt.');
      setProofOf(null);
      return;
    }

    setProofOf({ payment, url: data.signedUrl });
  };

  const confirmPayment = async (payment: PaymentRow) => {
    setBusyId(payment.rentals_id);
    setError(null);

    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'Confirmed',
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile?.email ?? null,
      })
      .eq('payments_id', payment.payments_id);

    if (updateError) {
      setError(updateError.message);
    } else {
      showSuccess('Payment confirmed. The booking can now be confirmed.');
      setProofOf(null);
      await load();
    }

    setBusyId(null);
  };

  const rejectPayment = async () => {
    if (!rejecting) return;

    const reason = rejectReason.trim();
    if (!reason) return;

    setBusyId(rejecting.rentals_id);
    setError(null);

    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'Rejected',
        admin_notes: reason,
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile?.email ?? null,
      })
      .eq('payments_id', rejecting.payments_id);

    if (updateError) {
      setError(updateError.message);
    } else {
      showSuccess('Payment rejected. The renter can submit another.');
      setRejecting(null);
      setProofOf(null);
      await load();
    }

    setBusyId(null);
  };

  const openDispatch = (rental: RentalRow) => {
    setDispatching(rental);
    setDispatch({ ...emptyDispatch, delivery_window: expectedArrival(rental.start_date) });
  };

  /**
   * Send the unit out.
   *
   * This does not mark the booking delivered, and cannot: nothing here observed
   * it arrive. It records what FarmVest knows -- that the unit left, when it is
   * expected, and who is driving -- and hands the confirmation to the farm
   * owner, who is the one who will actually receive it.
   */
  const confirmDispatch = async () => {
    if (!dispatching) return;

    if (!dispatch.delivery_window.trim()) {
      setError('Say when the unit is expected, so the farm owner can be there.');
      return;
    }

    const contact = dispatch.driver_contact.trim();
    if (contact && !/^\d{11}$/.test(contact)) {
      setError('The driver contact must be an 11-digit number, for example 09171234567.');
      return;
    }

    setBusyId(dispatching.rentals_id);
    setError(null);

    const { error: updateError } = await supabase
      .from('rentals')
      .update({
        status: 'Out for Delivery',
        dispatched_at: new Date().toISOString(),
        delivery_window: dispatch.delivery_window.trim(),
        driver_name: dispatch.driver_name.trim() || NONE,
        driver_contact: dispatch.driver_contact.trim() || NONE,
      })
      .eq('rentals_id', dispatching.rentals_id);

    if (updateError) {
      setError(updateError.message);
    } else {
      showSuccess('Unit dispatched. The farm owner confirms receipt on arrival.');
      setDispatching(null);
      await load();
    }

    setBusyId(null);
  };

  const setStatus = async (rentalId: string, status: string) => {
    setBusyId(rentalId);
    setError(null);

    const { error: updateError } = await supabase
      .from('rentals')
      .update({ status })
      .eq('rentals_id', rentalId);

    if (updateError) {
      setError(updateError.message);
    } else {
      showSuccess(
        status === 'Confirmed' ? 'Booking confirmed.' : `Booking marked ${status}.`
      );
      await load();
    }

    setBusyId(null);
  };

  const openInspection = (rental: RentalRow) => {
    setInspecting(rental);
    setInspection({ ...emptyInspection, returned_at: new Date().toISOString().slice(0, 10) });
  };

  /**
   * Closing a rental. A damaged return does three things at once: it records the
   * condition and the charge on the booking, sends the unit to Maintenance, and
   * opens a repair log pointing back at this rental. A clean return just closes.
   */
  const saveInspection = async () => {
    if (!inspecting) return;

    const damaged = DAMAGED.includes(inspection.return_condition);

    setBusyId(inspecting.rentals_id);
    setError(null);

    const { error: rentalError } = await supabase
      .from('rentals')
      .update({
        status: 'Completed',
        returned_at: inspection.returned_at,
        return_condition: inspection.return_condition,
        damage_notes: inspection.damage_notes.trim() || NONE,
        damage_charge: damaged ? Number(inspection.damage_charge || 0) : 0,
      })
      .eq('rentals_id', inspecting.rentals_id);

    if (rentalError) {
      setError(rentalError.message);
      setBusyId(null);
      return;
    }

    if (damaged && inspecting.equipment) {
      const { error: unitError } = await supabase
        .from('equipment')
        .update({
          availability_status: 'Maintenance',
          condition_notes:
            inspection.damage_notes.trim() ||
            `${inspection.return_condition} recorded at return inspection`,
        })
        .eq('equipment_id', inspecting.equipment.equipment_id);

      if (unitError) setError(unitError.message);

      const { error: logError } = await supabase.from('maintenance_logs').insert([
        {
          equipment_id: inspecting.equipment.equipment_id,
          rentals_id: inspecting.rentals_id,
          service_date: inspection.returned_at,
          service_type: 'Repair',
          description:
            inspection.damage_notes.trim() ||
            `${inspection.return_condition} found at return inspection`,
          cost: inspection.repair_cost ? Number(inspection.repair_cost) : null,
        },
      ]);

      if (logError) setError(logError.message);
    } else if (inspecting.equipment) {
      // A clean return puts the unit straight back on the market.
      await supabase
        .from('equipment')
        .update({ availability_status: 'Available' })
        .eq('equipment_id', inspecting.equipment.equipment_id);
    }

    showSuccess(
      damaged
        ? 'Inspection recorded. The unit is in Maintenance and a repair log was opened.'
        : 'Inspection recorded. The unit is Available again.'
    );

    setInspecting(null);
    setBusyId(null);
    await load();
  };

  const visible = useMemo(
    () => rentals.filter((rental) => rental.status === filter),
    [rentals, filter]
  );

  const countFor = (value: string) =>
    rentals.filter((rental) => rental.status === value).length;

  /** Rental days are inclusive of both the start and end date. */
  const rentalDays = (rental: RentalRow) => {
    const start = new Date(rental.start_date).getTime();
    const end = new Date(rental.end_date).getTime();
    return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  };

  const rentalTotal = (rental: RentalRow) =>
    rentalDays(rental) * Number(rental.equipment?.price_per_day ?? 0);

  return (
    <IonPage>
      <DashboardHeader
        title="Rental Bookings"
        subtitle="Approve bookings, and place them on hold when a weather advisory is in effect."
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

          {contractOf && (
            <section className="dash-panel">
              <div className="dash-panel__head">
                <h2 className="dash-panel__title">Signed Rental Agreement</h2>
                <button
                  type="button"
                  className="dash-panel__link"
                  onClick={() => setContractOf(null)}
                >
                  Close
                </button>
              </div>
              <div className="dash-panel__body">
                {contractOf.contracts?.length ? (
                  <>
                    <p className="dash-row__meta">
                      Signed by {orNone(contractOf.contracts[0].signatory_name)} on{' '}
                      {shortDate(contractOf.contracts[0].signed_at)}
                    </p>
                    <pre className="contract-box__terms">
                      {contractOf.contracts[0].terms_snapshot}
                    </pre>
                  </>
                ) : (
                  <EmptyState
                    title="No signed copy on file"
                    message="This booking was made before agreements were recorded."
                    size={130}
                  />
                )}
              </div>
            </section>
          )}

          {inspecting && (
            <section className="dash-panel">
              <div className="dash-panel__head">
                <h2 className="dash-panel__title">
                  Return Inspection - {orNone(inspecting.equipment?.name)}
                </h2>
                <button
                  type="button"
                  className="dash-panel__link"
                  onClick={() => setInspecting(null)}
                >
                  Cancel
                </button>
              </div>

              <div className="dash-panel__body">
                <div className="dash-form">
                  <div className="dash-field">
                    <label htmlFor="return-date">Date Returned</label>
                    <input
                      id="return-date"
                      type="date"
                      className="dash-input"
                      value={inspection.returned_at}
                      onChange={(e) =>
                        setInspection({ ...inspection, returned_at: e.target.value })
                      }
                    />
                  </div>

                  <div className="dash-field">
                    <label htmlFor="return-condition">Condition On Return</label>
                    <select
                      id="return-condition"
                      className="dash-select"
                      value={inspection.return_condition}
                      onChange={(e) =>
                        setInspection({ ...inspection, return_condition: e.target.value })
                      }
                    >
                      {RETURN_CONDITIONS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>

                  {DAMAGED.includes(inspection.return_condition) && (
                    <>
                      <div className="dash-field">
                        <label htmlFor="repair-cost">Repair Cost to FarmVest</label>
                        <input
                          id="repair-cost"
                          type="number"
                          min="0"
                          step="0.01"
                          className="dash-input"
                          placeholder="0.00"
                          value={inspection.repair_cost}
                          // The renter pays what the repair costs, no more and
                          // no less, so the charge follows this figure.
                          onChange={(e) =>
                            setInspection({
                              ...inspection,
                              repair_cost: e.target.value,
                              damage_charge: e.target.value,
                            })
                          }
                        />
                      </div>

                      <div className="dash-field">
                        <label htmlFor="damage-charge">Charged to Renter (same as repair cost)</label>
                        <input
                          id="damage-charge"
                          type="number"
                          className="dash-input"
                          placeholder="0.00"
                          value={inspection.damage_charge}
                          readOnly
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="dash-field dash-field--full">
                  <label htmlFor="damage-notes">Inspection Notes</label>
                  <textarea
                    id="damage-notes"
                    className="dash-textarea"
                    placeholder="What was found, and whether it is wear, misuse or mechanical failure."
                    value={inspection.damage_notes}
                    onChange={(e) => setInspection({ ...inspection, damage_notes: e.target.value })}
                  />
                </div>

                <p className="dash-note">
                  Damage puts the unit into Maintenance and opens a repair log against this
                  booking. Charge the renter only for damage beyond normal wear; mechanical
                  failure is carried by FarmVest under clause 4 of the agreement.
                </p>

                <div className="dash-actions dash-actions--end">
                  <button
                    type="button"
                    className="dash-btn dash-btn--primary"
                    disabled={busyId === inspecting.rentals_id}
                    onClick={saveInspection}
                  >
                    Record Inspection and Close Booking
                  </button>
                </div>
              </div>
            </section>
          )}

          <section className="dash-panel">
            <div className="dash-panel__head">
              <h2 className="dash-panel__title">Booking Schedule</h2>
              <span className="dash-stat__hint">{visible.length} shown</span>
            </div>

            <div className="dash-panel__body dash-table-wrap">
              {loading ? (
                <Skeleton />
              ) : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Equipment</th>
                      <th>Farm Owner</th>
                      <th>Schedule</th>
                      <th>Days</th>
                      <th>Estimated Total</th>
                      <th>Payment</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={8}>
                          <EmptyState title="No booking is in this state right now" size={120} />
                        </td>
                      </tr>
                    ) : (
                      visible.map((rental) => (
                      <tr key={rental.rentals_id}>
                        <td>
                          <p className="dash-row__title">{orNone(rental.equipment?.name)}</p>
                          <p className="dash-row__meta">{orNone(rental.equipment?.unit_code)}</p>
                        </td>
                        <td>
                          <p className="dash-row__title">{orNone(rental.customers?.users?.name)}</p>
                          <p className="dash-row__meta">{orNone(rental.customers?.users?.contact_number)}</p>
                        </td>
                        <td className="dash-table__muted">
                          {shortDate(rental.start_date)} to {shortDate(rental.end_date)}
                          {hasValue(rental.delivery_window) && (
                            <p className="dash-row__meta">Expected {rental.delivery_window}</p>
                          )}
                          {hasValue(rental.driver_name) && (
                            <p className="dash-row__meta">
                              Driver {rental.driver_name}
                              {hasValue(rental.driver_contact) ? ` · ${rental.driver_contact}` : ''}
                            </p>
                          )}
                          {rental.delivered_at && (
                            <p className="dash-row__meta">
                              Received {shortDate(rental.delivered_at)} by{' '}
                              {orNone(rental.received_by)}
                            </p>
                          )}
                        </td>
                        <td>{rentalDays(rental)}</td>
                        <td>{peso(rentalTotal(rental))}</td>
                        <td>
                          {(() => {
                            const payment = paymentFor(rental.rentals_id);
                            if (!payment) {
                              return <span className="dash-table__muted">Not paid</span>;
                            }

                            return (
                              <>
                                <span className={pillClass(payment.status)}>{payment.status}</span>
                                <p className="dash-row__meta">
                                  {peso(payment.amount)} · {payment.payment_type}
                                </p>
                                <p className="dash-row__meta">
                                  {payment.payment_methods?.method ?? 'Method removed'} · Ref{' '}
                                  {payment.reference_no}
                                </p>
                                {payment.proof_url && (
                                  <button
                                    type="button"
                                    className="dash-btn dash-btn--slate"
                                    onClick={() => viewProof(payment)}
                                  >
                                    View Receipt
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          <span className={pillClass(rental.status)}>{rental.status}</span>
                        </td>
                        <td>
                          <div className="dash-actions">
                            {/* Confirming the booking is held until the money
                                is accounted for. The unit is hauled to the farm
                                on the strength of this, and a booking called off
                                after the driver has left costs FarmVest the
                                whole trip. */}
                            {rental.status === 'Pending' && (
                              <button
                                type="button"
                                className="dash-btn dash-btn--primary"
                                disabled={
                                  busyId === rental.rentals_id ||
                                  paymentFor(rental.rentals_id)?.status !== 'Confirmed'
                                }
                                title={
                                  paymentFor(rental.rentals_id)?.status === 'Confirmed'
                                    ? undefined
                                    : 'Confirm the payment first.'
                                }
                                onClick={() => setStatus(rental.rentals_id, 'Confirmed')}
                              >
                                Confirm
                              </button>
                            )}

                            {rental.status === 'Confirmed' && (
                              <button
                                type="button"
                                className="dash-btn dash-btn--gold"
                                disabled={busyId === rental.rentals_id}
                                onClick={() => openDispatch(rental)}
                              >
                                Dispatch
                              </button>
                            )}

                            {['Active', 'Under Inspection'].includes(rental.status) && (
                              <button
                                type="button"
                                className="dash-btn dash-btn--gold"
                                disabled={busyId === rental.rentals_id}
                                onClick={() => openInspection(rental)}
                              >
                                Inspect Return
                              </button>
                            )}

                            {rental.contracts?.length > 0 && (
                              <button
                                type="button"
                                className="dash-btn dash-btn--slate"
                                onClick={() => setContractOf(rental)}
                              >
                                View Agreement
                              </button>
                            )}

                            {rental.status === 'Out for Delivery' && (
                              <span className="dash-row__meta">
                                Waiting for the farm owner to confirm receipt.
                              </span>
                            )}

                            {(NEXT_STATUSES[rental.status] ?? []).length > 0 && (
                              <select
                                className="dash-select"
                                style={{ maxWidth: 220 }}
                                aria-label="Change status"
                                value=""
                                disabled={busyId === rental.rentals_id}
                                onChange={(e) => {
                                  if (e.target.value) setStatus(rental.rentals_id, e.target.value);
                                }}
                              >
                                <option value="" disabled>
                                  Change status…
                                </option>
                                {NEXT_STATUSES[rental.status].map((status) => (
                                  <option key={status} value={status}>
                                    {status}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        {proofOf && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Proof of payment"
            onClick={() => setProofOf(null)}
          >
            <div
              className="dash-modal__panel"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">
                    {peso(proofOf.payment.amount)} · {proofOf.payment.payment_type}
                  </p>
                  <h2 className="dash-modal__title">Ref {proofOf.payment.reference_no}</h2>
                </div>

                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setProofOf(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body">
                {!proofOf.url ? (
                  <Skeleton />
                ) : proofOf.payment.proof_url?.toLowerCase().endsWith('.pdf') ? (
                  <iframe
                    className="dash-modal__frame"
                    src={proofOf.url}
                    title="Proof of payment"
                  />
                ) : (
                  <img className="dash-modal__image" src={proofOf.url} alt="Proof of payment" />
                )}
              </div>

              <p className="dash-modal__note">
                Check this reference against{' '}
                {proofOf.payment.payment_methods
                  ? `${proofOf.payment.payment_methods.method} ${proofOf.payment.payment_methods.account_number}`
                  : 'the receiving account'}{' '}
                before confirming. FarmVest cannot verify a payment on its own.
              </p>

              {proofOf.payment.status === 'Submitted' && (
                <div className="dash-modal__foot">
                  <button
                    type="button"
                    className="dash-btn dash-btn--ghost"
                    onClick={() => {
                      setRejectReason('');
                      setRejecting(proofOf.payment);
                    }}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="dash-btn dash-btn--primary"
                    disabled={busyId === proofOf.payment.rentals_id}
                    onClick={() => confirmPayment(proofOf.payment)}
                  >
                    Confirm Payment
                  </button>
                </div>
              )}
            </div>
          </Portal>
        )}

        {dispatching && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Dispatch this unit"
            onClick={() => setDispatching(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--narrow"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Dispatch</p>
                  <h2 className="dash-modal__title">
                    {orNone(dispatching.equipment?.name)}
                  </h2>
                </div>

                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setDispatching(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body dash-modal__body--form">
                <p className="dash-modal__lead">
                  This records that the unit left, not that it arrived.{' '}
                  {dispatching.customers?.users?.name ?? 'The farm owner'} confirms receipt on
                  arrival, and that confirmation is what starts the rental.
                </p>

                <div className="dash-field">
                  <label htmlFor="dispatch-window">
                    Expected Arrival (filled in from the booking start date)
                  </label>
                  <input
                    id="dispatch-window"
                    className="dash-input"
                    placeholder="Nov 10, morning (8AM to 12NN)"
                    value={dispatch.delivery_window}
                    onChange={(event) =>
                      setDispatch({ ...dispatch, delivery_window: event.target.value })
                    }
                  />
                </div>

                {/* Without tracking, the driver's number is the answer to
                    "where is my unit". It is the one field the farm owner will
                    actually use. */}
                <div className="dash-form dash-form--two">
                  <div className="dash-field">
                    <label htmlFor="dispatch-driver">Driver</label>
                    <input
                      id="dispatch-driver"
                      className="dash-input"
                      placeholder="Pedro Cruz"
                      value={dispatch.driver_name}
                      onChange={(event) =>
                        setDispatch({ ...dispatch, driver_name: event.target.value })
                      }
                    />
                  </div>

                  <div className="dash-field">
                    <label htmlFor="dispatch-contact">Driver Contact</label>
                    <input
                      id="dispatch-contact"
                      className="dash-input"
                      placeholder="09171234567"
                      inputMode="numeric"
                      maxLength={11}
                      value={dispatch.driver_contact}
                      // Digits only, at most 11: a Philippine mobile number.
                      onChange={(event) =>
                        setDispatch({
                          ...dispatch,
                          driver_contact: event.target.value.replace(/\D/g, '').slice(0, 11),
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="dash-modal__foot">
                <button
                  type="button"
                  className="dash-btn dash-btn--ghost"
                  onClick={() => setDispatching(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dash-btn dash-btn--primary"
                  disabled={busyId === dispatching.rentals_id}
                  onClick={confirmDispatch}
                >
                  Mark Out for Delivery
                </button>
              </div>
            </div>
          </Portal>
        )}

        {rejecting && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Reject payment"
            onClick={() => setRejecting(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--narrow"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Reject payment</p>
                  <h2 className="dash-modal__title">Ref {rejecting.reference_no}</h2>
                </div>

                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setRejecting(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body dash-modal__body--form">
                <p className="dash-modal__lead">
                  The renter sees this reason and can submit another payment. Say what was wrong so
                  they can fix it rather than guess.
                </p>

                <div className="dash-field">
                  <label htmlFor="reject-reason">Reason</label>
                  <textarea
                    id="reject-reason"
                    className="dash-textarea"
                    rows={3}
                    maxLength={300}
                    placeholder="No payment with this reference reached the account."
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                  />
                </div>
              </div>

              <div className="dash-modal__foot">
                <button
                  type="button"
                  className="dash-btn dash-btn--ghost"
                  onClick={() => setRejecting(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dash-btn dash-btn--primary"
                  disabled={!rejectReason.trim() || busyId === rejecting.rentals_id}
                  onClick={rejectPayment}
                >
                  Reject Payment
                </button>
              </div>
            </div>
          </Portal>
        )}
      </IonContent>
    </IonPage>
  );
};

export default RentalBookings;
