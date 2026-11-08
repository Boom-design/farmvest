import { useCallback, useEffect, useMemo, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { closeOutline, imageOutline } from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import Portal from '../../components/Portal';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { hasValue, orNone, peso, pillClass, shortDate } from '../../lib/format';
import { rentalTerms, TERMS_VERSION } from '../../lib/contracts';
import PaymentForm from '../../components/PaymentForm';
import DateRangeCalendar from '../../components/DateRangeCalendar';
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

type EquipmentRow = {
  equipment_id: string;
  unit_code: string | null;
  name: string;
  type: string | null;
  price_per_day: number;
  availability_status: string;
  condition_notes: string | null;
  image_url: string | null;
};

/** Occupied ranges from the equipment_bookings view, which hides who booked. */
type BookingRow = {
  rentals_id: string;
  equipment_id: string;
  start_date: string;
  end_date: string;
  status: string;
};

const today = () => new Date().toISOString().slice(0, 10);

/** Inclusive rental length, so a same-day booking still costs one day. */
const dayCount = (start: string, end: string) => {
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
  return Math.round((to - from) / 86_400_000) + 1;
};

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  aStart <= bEnd && bStart <= aEnd;

const RentEquipment: React.FC = () => {
  const { profile } = useAuth();
  const { showSuccess } = useToast();

  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [typeFilter, setTypeFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<EquipmentRow | null>(null);
  /**
   * The booking the dialog has already written, once it has one.
   *
   * The rental row is created when the agreement is signed rather than when the
   * payment clears, so a renter who closes the dialog to open their GCash app
   * still has a booking waiting for them. My Rentals keeps its own Pay button
   * for exactly that case; this only saves the common path a round trip.
   */
  const [bookedId, setBookedId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [saving, setSaving] = useState(false);

  // The booking is a signed agreement, so the terms are shown and accepted
  // before the request is sent rather than after the Admin confirms it.
  const [signature, setSignature] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  /** Whether the full terms have been opened. The agree box stays locked
   *  until they have, so it cannot be ticked unread. */
  const [termsOpened, setTermsOpened] = useState(false);

  const load = useCallback(async () => {
    setError(null);

    const [fleet, booked] = await Promise.all([
      supabase
        .from('equipment')
        .select(
          'equipment_id, unit_code, name, type, price_per_day, availability_status, condition_notes, image_url'
        )
        .order('name'),
      supabase
        .from('equipment_bookings')
        .select('rentals_id, equipment_id, start_date, end_date, status'),
    ]);

    if (fleet.error) {
      setError(fleet.error.message);
    } else {
      setEquipment((fleet.data ?? []) as EquipmentRow[]);
    }

    if (!fleet.error && booked.error) {
      setError(booked.error.message);
    } else if (booked.data) {
      setBookings(booked.data as BookingRow[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const types = useMemo(() => {
    const found = new Set(equipment.map((unit) => unit.type).filter(Boolean) as string[]);
    return ['All', ...Array.from(found).sort()];
  }, [equipment]);

  const visible = useMemo(
    () => (typeFilter === 'All' ? equipment : equipment.filter((unit) => unit.type === typeFilter)),
    [equipment, typeFilter]
  );

  const bookingsFor = useCallback(
    (equipmentId: string) => bookings.filter((booking) => booking.equipment_id === equipmentId),
    [bookings]
  );

  const days = dayCount(startDate, endDate);
  useEffect(() => {
    if (!selected) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);

  const total = selected ? days * Number(selected.price_per_day) : 0;

  const conflict = useMemo(() => {
    if (!selected || days === 0) return null;
    return (
      bookingsFor(selected.equipment_id).find((booking) =>
        overlaps(startDate, endDate, booking.start_date, booking.end_date)
      ) ?? null
    );
  }, [selected, days, startDate, endDate, bookingsFor]);

  const terms = selected
    ? rentalTerms({
        signatoryName: signature.trim() || profile?.name || 'the Renter',
        equipmentName: selected.name,
        unitCode: hasValue(selected.unit_code) ? selected.unit_code : null,
        startDate,
        endDate,
        days,
        ratePerDay: Number(selected.price_per_day),
        total,
      })
    : '';

  const openBooking = (unit: EquipmentRow) => {
    setSelected(unit);
    setBookedId(null);
    setStartDate(today());
    setEndDate(today());
    setError(null);
    setSignature('');
    setAgreed(false);
    setShowTerms(false);
    setTermsOpened(false);
  };

  const book = async () => {
    if (!profile || !selected) return;

    if (days === 0) {
      setError('The return date cannot be earlier than the start date.');
      return;
    }

    if (startDate < today()) {
      setError('The start date cannot be in the past.');
      return;
    }

    if (conflict) {
      setError('That unit is already booked for part of those dates. Please pick other dates.');
      return;
    }

    if (!agreed) {
      setError('Please read and accept the rental agreement before booking.');
      return;
    }

    if (signature.trim().length < 3) {
      setError('Please type your full name as your signature.');
      return;
    }

    setSaving(true);
    setError(null);

    // status is left to the database default of Pending: the Admin confirms the
    // booking before the equipment is committed.
    const { data: rental, error: insertError } = await supabase
      .from('rentals')
      .insert({
        customers_id: profile.users_id,
        equipment_id: selected.equipment_id,
        start_date: startDate,
        end_date: endDate,
      })
      .select('rentals_id')
      .single();

    if (insertError || !rental) {
      setError(insertError?.message ?? 'Could not create the booking.');
      setSaving(false);
      return;
    }

    // The exact wording is stored with the signature: the terms will change, the
    // agreement that was signed must not.
    const { error: contractError } = await supabase.from('contracts').insert({
      rentals_id: rental.rentals_id,
      signatory_name: signature.trim(),
      terms_version: TERMS_VERSION,
      terms_snapshot: terms,
      agreed_amount: total,
    });

    if (contractError) {
      setError(`The booking was created but the agreement could not be saved: ${contractError.message}`);
    } else {
      // The dialog stays open and moves to the payment step; the booking is
      // already saved, so closing it now loses nothing.
      setBookedId(rental.rentals_id);
      showSuccess('Booking requested and agreement signed.');
      await load();
    }

    setSaving(false);
  };

  return (
    <IonPage>
      <DashboardHeader
        title="Rent Equipment"
        subtitle="Browse the FarmVest fleet and book a unit for your farm operations."
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          <div className="dash-toolbar-row">
            {types.map((value) => (
              <button
                key={value}
                type="button"
                className={`dash-tab${typeFilter === value ? ' dash-tab--active' : ''}`}
                onClick={() => setTypeFilter(value)}
              >
                {value}
              </button>
            ))}
          </div>

          {/* A dialog rather than a panel above the fleet. Dates, the booked
              ranges, the cost estimate and the full agreement together are
              longer than the fleet below them, so opening one unit pushed every
              other unit off the screen. */}
          {selected && (
            <Portal
              className="dash-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`Book ${selected.name}`}
              onClick={() => setSelected(null)}
            >
              <div
                className="dash-modal__panel dash-modal__panel--wide"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="dash-modal__head">
                  <div>
                    <p className="dash-modal__eyebrow">
                      {bookedId
                        ? `Step 2 of 2 · ${peso(total)} for ${days} day${days === 1 ? '' : 's'}`
                        : `Step 1 of 2 · ${peso(selected.price_per_day)} per day${
                            hasValue(selected.unit_code) ? ` · ${selected.unit_code}` : ''
                          }`}
                    </p>
                    <h2 className="dash-modal__title">
                      {bookedId ? `Pay for ${selected.name}` : `Book ${selected.name}`}
                    </h2>
                  </div>

                  <button
                    type="button"
                    className="dash-modal__close"
                    onClick={() => setSelected(null)}
                    aria-label="Close"
                  >
                    <IonIcon icon={closeOutline} />
                  </button>
                </div>

                {bookedId ? (
                  <PaymentForm
                    rentalId={bookedId}
                    fee={total}
                    cancelLabel="Pay later"
                    onCancel={() => setSelected(null)}
                    onSubmitted={() => setSelected(null)}
                  />
                ) : (
                <>
                <div className="dash-modal__body dash-modal__body--form">
                  <div className="booking-dates">
                    {/* The calendar rather than two date inputs and a list of
                        occupied ranges beneath them. The list was correct and
                        unusable: a popular unit collects a dozen bookings, and
                        working out which days are left from twelve date ranges
                        is arithmetic the calendar can just show. */}
                    <DateRangeCalendar
                      blocked={bookingsFor(selected.equipment_id).map((booking) => ({
                        start: booking.start_date,
                        end: booking.end_date,
                      }))}
                      start={startDate}
                      end={endDate}
                      min={today()}
                      onChange={(nextStart, nextEnd) => {
                        setStartDate(nextStart);
                        setEndDate(nextEnd);
                      }}
                    />

                    <div className="booking-dates__summary">
                      <p className="dash-field-label">Your Booking</p>

                      <p className="booking-dates__range">
                        {shortDate(startDate)} to {shortDate(endDate)}
                      </p>

                      <p className="dash-row__meta">
                        {days} day{days === 1 ? '' : 's'} at {peso(selected.price_per_day)} per day
                      </p>

                      <p className="dash-stat__label booking-dates__total-label">
                        Estimated Total
                      </p>
                      <p className="dash-stat__value">{peso(total)}</p>

                      <p className="dash-row__meta">
                        Tap a day to start, then tap the last day. Red days are already booked on
                        this unit.
                      </p>
                    </div>
                  </div>

                <div className="contract-box">
                  <div className="contract-box__head">
                    <p className="dash-field-label">Rental Agreement</p>
                    <button
                      type="button"
                      className="dash-panel__link"
                      onClick={() => {
                        setShowTerms(!showTerms);
                        setTermsOpened(true);
                      }}
                    >
                      {showTerms ? 'Hide full terms' : 'Read full terms'}
                    </button>
                  </div>

                  {showTerms ? (
                    <pre className="contract-box__terms">{terms}</pre>
                  ) : (
                    <p className="dash-row__meta">
                      You pay {peso(total)} for {days} day{days === 1 ? '' : 's'}, provide fuel and
                      an operator, and are responsible for damage beyond normal wear. FarmVest may
                      postpone the booking under a severe weather advisory.
                    </p>
                  )}

                  <div className="dash-field">
                    <label htmlFor="rental-signature">Type your full name to sign</label>
                    <input
                      id="rental-signature"
                      className="dash-input contract-box__signature"
                      value={signature}
                      onChange={(event) => setSignature(event.target.value)}
                      placeholder={profile?.name || 'Juan Dela Cruz'}
                      autoComplete="name"
                    />
                  </div>

                  {!termsOpened && (
                    <p className="contract-box__hint">
                      Open the full terms above before you can agree to them.
                    </p>
                  )}

                  <label className={`contract-box__agree${termsOpened ? '' : ' contract-box__agree--locked'}`}>
                    <input
                      type="checkbox"
                      checked={agreed}
                      disabled={!termsOpened}
                      onChange={(event) => setAgreed(event.target.checked)}
                    />
                    I have read and agree to the rental agreement above.
                  </label>
                </div>

                  {conflict && (
                    <p className="dash-error">
                      Those dates overlap a booking from {shortDate(conflict.start_date)} to{' '}
                      {shortDate(conflict.end_date)}.
                    </p>
                  )}
                </div>

                <div className="dash-modal__foot">
                  <button
                    type="button"
                    className="dash-btn dash-btn--ghost"
                    onClick={() => setSelected(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="dash-btn dash-btn--primary"
                    disabled={saving || days === 0 || Boolean(conflict) || !agreed}
                    onClick={book}
                  >
                    {saving ? 'Sending...' : 'Sign and Continue to Payment'}
                  </button>
                </div>
                </>
                )}
              </div>
            </Portal>
          )}

          <section className="dash-panel">
            <div className="dash-panel__head">
              <h2 className="dash-panel__title">FarmVest Fleet</h2>
              <span className="dash-stat__hint">{visible.length} units</span>
            </div>

            <div className="dash-panel__body">
              {loading ? (
                <Skeleton />
              ) : visible.length === 0 ? (
                <EmptyState title="No equipment listed for this type yet" size={130} />
              ) : (
                <div className="dash-cards">
                  {visible.map((unit) => (
                    <article key={unit.equipment_id} className="dash-card">
                      {hasValue(unit.image_url) ? (
                        <img
                          className="dash-card__photo"
                          src={unit.image_url}
                          alt={unit.name}
                          loading="lazy"
                        />
                      ) : (
                        <span className="dash-card__photo dash-card__photo--empty">
                          <IonIcon icon={imageOutline} />
                        </span>
                      )}

                      <div className="dash-card__head">
                        <div>
                          <p className="dash-row__title">{unit.name}</p>
                          <p className="dash-row__meta">
                            {orNone(unit.type)}
                            {unit.unit_code ? ` - ${unit.unit_code}` : ''}
                          </p>
                        </div>
                        <span className={pillClass(unit.availability_status)}>
                          {unit.availability_status}
                        </span>
                      </div>

                      <p className="dash-card__price">
                        {peso(unit.price_per_day)}
                        <span> / day</span>
                      </p>

                      <p className="dash-row__meta">
                        {orNone(unit.condition_notes)}
                      </p>

                      <p className="dash-row__meta">
                        {bookingsFor(unit.equipment_id).length} booking
                        {bookingsFor(unit.equipment_id).length === 1 ? '' : 's'} on the calendar
                      </p>

                      <button
                        type="button"
                        className="dash-btn dash-btn--primary dash-btn--block"
                        disabled={unit.availability_status === 'Maintenance'}
                        onClick={() => openBooking(unit)}
                      >
                        {unit.availability_status === 'Maintenance'
                          ? 'Under Maintenance'
                          : 'Check Availability'}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default RentEquipment;
