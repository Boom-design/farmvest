import { useCallback, useEffect, useMemo, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import PaymentForm from '../../components/PaymentForm';
import Portal from '../../components/Portal';
import DashboardHeader from '../../components/DashboardHeader';
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
  /** Filled in by the Admin at dispatch, read here so the renter can chase it. */
  dispatched_at: string | null;
  delivery_window: string;
  driver_name: string;
  driver_contact: string;
  delivered_at: string | null;
  received_by: string;
  damage_notes: string | null;
  damage_charge: number;
  equipment: {
    name: string;
    unit_code: string | null;
    type: string | null;
    price_per_day: number;
  } | null;
  contracts: { signatory_name: string; signed_at: string; terms_snapshot: string }[];
};

type PaymentRow = {
  payments_id: string;
  rentals_id: string;
  amount: number;
  payment_type: string;
  reference_no: string;
  status: string;
  admin_notes: string;
  submitted_at: string;
};

/**
 * One tab per status a booking can still be in, in the order it passes through
 * them. Completed bookings are on the Reports page, for the same reason
 * completed projects are: they are a record, not something to act on.
 */
const FILTERS = [
  'Pending',
  'Confirmed',
  'Out for Delivery',
  'On Hold - Weather Advisory',
  'Rescheduled',
  'Active',
  // No Under Inspection tab: the Admin's return inspection closes a booking in
  // one step, so nothing waits in that status and the tab was always empty.
  'Cancelled',
];

/** Inclusive rental length, so a same-day booking still costs one day. */
const dayCount = (start: string, end: string) =>
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;

const MyRentals: React.FC = () => {
  const { profile } = useAuth();
  const { showSuccess } = useToast();

  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [filter, setFilter] = useState(FILTERS[0]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [payingFor, setPayingFor] = useState<RentalRow | null>(null);
  const [receiving, setReceiving] = useState<RentalRow | null>(null);
  const [receivedBy, setReceivedBy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [contractOf, setContractOf] = useState<RentalRow | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    const { data, error: loadError } = await supabase
      .from('rentals')
      .select(
        'rentals_id, start_date, end_date, status, admin_notes, created_at, returned_at, return_condition, damage_notes, damage_charge, dispatched_at, delivery_window, driver_name, driver_contact, delivered_at, received_by, equipment(name, unit_code, type, price_per_day), contracts(signatory_name, signed_at, terms_snapshot)'
      )
      .eq('customers_id', profile.users_id)
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    setRentals((data ?? []) as unknown as RentalRow[]);

    // Limited to this renter's own bookings by the policy on the table.
    const { data: paymentRows } = await supabase
      .from('payments')
      .select(
        'payments_id, rentals_id, amount, payment_type, reference_no, status, admin_notes, submitted_at'
      )
      .order('submitted_at', { ascending: false });

    setPayments((paymentRows ?? []) as PaymentRow[]);

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  // Only a booking the Admin has not acted on yet can be withdrawn here; the
  // row level security policy enforces the same rule.
  const cancelRental = async (rentalId: string) => {
    setBusyId(rentalId);
    setError(null);

    const { error: updateError } = await supabase
      .from('rentals')
      .update({ status: 'Cancelled' })
      .eq('rentals_id', rentalId);

    if (updateError) {
      setError(updateError.message);
    } else {
      showSuccess('Booking cancelled.');
      await load();
    }

    setBusyId(null);
  };

  /** The latest payment filed against one booking, if any. */
  const paymentFor = (rentalId: string) =>
    payments.find((payment) => payment.rentals_id === rentalId);

  /**
   * Confirm that the unit arrived.
   *
   * The farm owner does this rather than the Admin, because the farm owner is
   * the one it arrived to. Nothing in the system observed the delivery, so the
   * record is only worth anything if the party that witnessed it is the party
   * that wrote it. This is also what starts the rental: the days run from a
   * confirmed receipt, not from a dispatch note.
   */
  const confirmReceipt = async () => {
    if (!receiving || !profile) return;

    if (receivedBy.trim().length < 3) {
      setError('Type the name of the person who accepted the unit.');
      return;
    }

    setBusyId(receiving.rentals_id);
    setError(null);

    const { error: updateError } = await supabase
      .from('rentals')
      .update({
        status: 'Active',
        delivered_at: new Date().toISOString(),
        received_by: receivedBy.trim(),
      })
      .eq('rentals_id', receiving.rentals_id);

    if (updateError) {
      setError(updateError.message);
    } else {
      showSuccess('Receipt confirmed. The rental has started.');
      setReceiving(null);
      await load();
    }

    setBusyId(null);
  };

  const rentalFeeOf = (rental: RentalRow) =>
    dayCount(rental.start_date, rental.end_date) * Number(rental.equipment?.price_per_day ?? 0);

  const visible = useMemo(
    () => rentals.filter((rental) => rental.status === filter),
    [rentals, filter]
  );

  const countFor = (value: string) =>
    rentals.filter((rental) => rental.status === value).length;

  const rentalFee = (rental: RentalRow) =>
    dayCount(rental.start_date, rental.end_date) * Number(rental.equipment?.price_per_day ?? 0);

  const rentalTotal = (rental: RentalRow) => rentalFee(rental) + Number(rental.damage_charge ?? 0);

  return (
    <IonPage>
      <DashboardHeader
        title="My Rentals"
        subtitle="Track your equipment bookings and their approval status."
        accountName={profile?.name || ''}
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
                <h2 className="dash-panel__title">Your Signed Rental Agreement</h2>
                <button
                  type="button"
                  className="dash-panel__link"
                  onClick={() => setContractOf(null)}
                >
                  Close
                </button>
              </div>
              <div className="dash-panel__body">
                <p className="dash-row__meta">
                  Signed by {orNone(contractOf.contracts[0]?.signatory_name)} on{' '}
                  {shortDate(contractOf.contracts[0]?.signed_at)}
                </p>
                <pre className="contract-box__terms">
                  {contractOf.contracts[0]?.terms_snapshot}
                </pre>
              </div>
            </section>
          )}

          <section className="dash-panel">
            <div className="dash-panel__head">
              <h2 className="dash-panel__title">Bookings</h2>
              <span className="dash-stat__hint">{visible.length} shown</span>
            </div>

            <div className="dash-panel__body dash-table-wrap">
              {loading ? (
                <Skeleton />
              ) : visible.length === 0 ? (
                <EmptyState
                  title={
                    rentals.length === 0
                      ? 'You have not booked any equipment yet'
                      : 'No booking matches this filter'
                  }
                  message={
                    rentals.length === 0
                      ? 'Browse the FarmVest fleet under Rent Equipment.'
                      : undefined
                  }
                />
              ) : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Equipment</th>
                      <th>Dates</th>
                      <th>Days</th>
                      <th>Rental Fee</th>
                      <th>Condition On Return</th>
                      <th>Damage Charge</th>
                      <th>Total Payable</th>
                      <th>Payment</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((rental) => (
                      <tr key={rental.rentals_id}>
                        <td>
                          <p className="dash-row__title">{orNone(rental.equipment?.name)}</p>
                          <p className="dash-row__meta">
                            {orNone(rental.equipment?.type)}
                            {rental.equipment?.unit_code ? ` - ${rental.equipment.unit_code}` : ''}
                          </p>
                          {rental.admin_notes && (
                            <p className="dash-row__meta">Admin: {rental.admin_notes}</p>
                          )}
                        </td>
                        <td className="dash-table__muted">
                          {shortDate(rental.start_date)} to {shortDate(rental.end_date)}
                          {rental.status === 'Out for Delivery' &&
                            hasValue(rental.delivery_window) && (
                              <p className="dash-row__meta">
                                Arriving {rental.delivery_window}
                              </p>
                            )}
                          {rental.status === 'Out for Delivery' &&
                            hasValue(rental.driver_contact) && (
                              <p className="dash-row__meta">
                                Driver {orNone(rental.driver_name)} · {rental.driver_contact}
                              </p>
                            )}
                          {rental.delivered_at && (
                            <p className="dash-row__meta">
                              Received {shortDate(rental.delivered_at)}
                            </p>
                          )}
                        </td>
                        <td className="dash-table__muted">
                          {dayCount(rental.start_date, rental.end_date)}
                        </td>
                        <td>{peso(rentalFee(rental))}</td>
                        <td className="dash-table__muted">
                          {orNone(rental.return_condition)}
                          {rental.returned_at && (
                            <p className="dash-row__meta">
                              Returned {shortDate(rental.returned_at)}
                            </p>
                          )}
                          {rental.damage_notes && rental.damage_notes !== 'None' && (
                            <p className="dash-row__meta">{rental.damage_notes}</p>
                          )}
                        </td>
                        <td>
                          {Number(rental.damage_charge) > 0 ? (
                            <span className="dash-pill dash-pill--danger">
                              {peso(rental.damage_charge)}
                            </span>
                          ) : (
                            <span className="dash-table__muted">{peso(0)}</span>
                          )}
                        </td>
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
                                <p className="dash-row__meta">Ref {payment.reference_no}</p>
                                {payment.status === 'Rejected' && hasValue(payment.admin_notes) && (
                                  <p className="dash-row__meta">{payment.admin_notes}</p>
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
                            {/* A booking is confirmed once the payment behind
                                it clears, so paying is the action on a Pending
                                row that has not been paid or was refused. */}
                            {rental.status === 'Pending' &&
                              ['Rejected', undefined].includes(
                                paymentFor(rental.rentals_id)?.status
                              ) && (
                                <button
                                  type="button"
                                  className="dash-btn dash-btn--primary"
                                  onClick={() => setPayingFor(rental)}
                                >
                                  {paymentFor(rental.rentals_id) ? 'Pay Again' : 'Pay'}
                                </button>
                              )}

                            {rental.status === 'Out for Delivery' && (
                              <button
                                type="button"
                                className="dash-btn dash-btn--primary"
                                onClick={() => {
                                  setReceivedBy('');
                                  setReceiving(rental);
                                }}
                              >
                                Confirm Receipt
                              </button>
                            )}

                            {rental.status === 'Pending' && (
                              <button
                                type="button"
                                className="dash-btn dash-btn--ghost"
                                disabled={busyId === rental.rentals_id}
                                onClick={() => cancelRental(rental.rentals_id)}
                              >
                                Cancel
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
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        {receiving && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm receipt"
            onClick={() => setReceiving(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--narrow"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Confirm receipt</p>
                  <h2 className="dash-modal__title">{orNone(receiving.equipment?.name)}</h2>
                </div>

                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setReceiving(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="dash-modal__body dash-modal__body--form">
                <p className="dash-modal__lead">
                  Confirm only once the unit is with you and you have looked it over. This starts
                  the rental, and the condition it is in now is what it is compared against when
                  it goes back.
                </p>

                {hasValue(receiving.driver_contact) && (
                  <p className="dash-stat__hint account-lead">
                    Not arrived yet? Call {orNone(receiving.driver_name)} on{' '}
                    {receiving.driver_contact}.
                  </p>
                )}

                <div className="dash-field">
                  <label htmlFor="received-by">Received By</label>
                  <input
                    id="received-by"
                    className="dash-input"
                    placeholder="Full name of whoever accepted it"
                    value={receivedBy}
                    onChange={(event) => setReceivedBy(event.target.value)}
                  />
                </div>
              </div>

              <div className="dash-modal__foot">
                <button
                  type="button"
                  className="dash-btn dash-btn--ghost"
                  onClick={() => setReceiving(null)}
                >
                  Not yet
                </button>
                <button
                  type="button"
                  className="dash-btn dash-btn--primary"
                  disabled={!receivedBy.trim() || busyId === receiving.rentals_id}
                  onClick={confirmReceipt}
                >
                  Confirm Receipt
                </button>
              </div>
            </div>
          </Portal>
        )}

        {payingFor && (
          <Portal
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Pay for this booking"
            onClick={() => setPayingFor(null)}
          >
            <div
              className="dash-modal__panel dash-modal__panel--wide"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dash-modal__head">
                <div>
                  <p className="dash-modal__eyebrow">Payment</p>
                  <h2 className="dash-modal__title">{orNone(payingFor.equipment?.name)}</h2>
                </div>

                <button
                  type="button"
                  className="dash-modal__close"
                  onClick={() => setPayingFor(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <PaymentForm
                rentalId={payingFor.rentals_id}
                fee={rentalFeeOf(payingFor)}
                cancelLabel="Cancel"
                onCancel={() => setPayingFor(null)}
                onSubmitted={async () => {
                  setPayingFor(null);
                  await load();
                }}
              />
            </div>
          </Portal>
        )}
      </IonContent>
    </IonPage>
  );
};

export default MyRentals;
