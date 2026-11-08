import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import {
  alertCircleOutline,
  checkmarkCircleOutline,
  cloudyOutline,
  leafOutline,
  locationOutline,
  partlySunnyOutline,
  rainyOutline,
  thunderstormOutline,
  warningOutline,
} from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import EmptyState from '../../components/EmptyState';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { hasValue, peso } from '../../lib/format';
import {
  advisoryFor,
  loadAdvisory,
  suitabilityFor,
  WeatherError,
  type Advisory,
  type ForecastDay,
} from '../../lib/weather';
import '../../theme/dashboard.css';
import './WeatherAdvisory.css';
import Skeleton from '../../components/Skeleton';

type EquipmentRow = {
  equipment_id: string;
  name: string;
  type: string | null;
  price_per_day: number;
};

/** Picks the icon that matches a day's numbers, so the strip reads at a glance. */
const dayIcon = (day: ForecastDay) => {
  if (day.gustKph >= 62) return thunderstormOutline;
  if (day.rainMm >= 20) return rainyOutline;
  if (day.rainMm >= 2) return cloudyOutline;
  return partlySunnyOutline;
};

const weekday = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { weekday: 'short' });

const dayNumber = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' });

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });

/**
 * Units listed before View more.
 *
 * The fleet is ranked worst-fit last, so the three at the top are the three
 * worth booking. Listing every unit turned the page into a long scroll past
 * what does not suit the week, and the advisory above them is the point of the
 * screen.
 */
const EQUIPMENT_PREVIEW = 3;

const verdictIcon = {
  Recommended: checkmarkCircleOutline,
  Caution: alertCircleOutline,
  Postpone: warningOutline,
} as const;

/**
 * Weather Advisory (AI #2).
 *
 * Four blocks, in the order a farm owner needs them: what is coming, what to do
 * about it, which equipment still makes sense to book, and what to plant this
 * season. The forecast is live from Open-Meteo, resolved against the farm
 * address on the account; lib/weather holds the rules that turn it into advice.
 */
const WeatherAdvisory: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [advisory, setAdvisory] = useState<Advisory | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [showAllUnits, setShowAllUnits] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;

    setLoading(true);
    setError(null);
    setWeatherError(null);

    const [ownerRes, fleetRes] = await Promise.all([
      supabase
        .from('customers')
        .select('farm_location, farm_city, farm_province')
        .eq('customers_id', profile.users_id)
        .maybeSingle(),
      supabase
        .from('equipment')
        .select('equipment_id, name, type, price_per_day')
        .eq('availability_status', 'Available')
        .order('name'),
    ]);

    const failed = [ownerRes, fleetRes].find((result) => result.error);
    if (failed?.error) {
      setError(failed.error.message);
      setLoading(false);
      return;
    }

    const owner = ownerRes.data as {
      farm_location: string | null;
      farm_city: string | null;
      farm_province: string | null;
    } | null;

    // farm_location is the readable label the address picker stores; the parts
    // are what the geocoder needs, and what an older account may be missing.
    const city = hasValue(owner?.farm_city) ? owner!.farm_city! : '';
    const province = hasValue(owner?.farm_province) ? owner!.farm_province! : '';

    setPlace(hasValue(owner?.farm_location) ? owner!.farm_location : null);
    setEquipment((fleetRes.data ?? []) as EquipmentRow[]);

    if (!city && !province) {
      setAdvisory(null);
      setWeatherError(
        'Add your farm address under My Account and this page will show the seven-day forecast for it, with what to do about the weather that is coming.'
      );
      setLoading(false);
      return;
    }

    try {
      setAdvisory(await loadAdvisory(city, province));
    } catch (weatherFailure) {
      setAdvisory(null);
      setWeatherError(
        weatherFailure instanceof WeatherError
          ? weatherFailure.message
          : 'The weather advisory could not be loaded.'
      );
    }

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const definition = advisory ? advisoryFor(advisory.level) : null;

  const rainTotal = useMemo(
    () => (advisory ? Math.round(advisory.days.reduce((sum, day) => sum + day.rainMm, 0)) : 0),
    [advisory]
  );

  const peakGust = useMemo(
    () => (advisory ? Math.max(...advisory.days.map((day) => day.gustKph)) : 0),
    [advisory]
  );

  const ranked = useMemo(() => {
    if (!advisory) return [];
    const order = { Recommended: 0, Caution: 1, Postpone: 2 };
    return equipment
      .map((unit) => ({ unit, fit: suitabilityFor(unit.name, unit.type, advisory) }))
      .sort((a, b) => order[a.fit.verdict] - order[b.fit.verdict]);
  }, [equipment, advisory]);

  return (
    <IonPage>
      <DashboardHeader
        title="Weather Advisory"
        subtitle="Seven-day outlook, storm preparation, and what to plant or rent next."
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          {loading ? (
            <Skeleton />
          ) : weatherError || !advisory || !definition ? (
            /* The fleet is still readable, but every panel on this page is
             * written against the forecast, so there is nothing to show without
             * one. The address is the usual cause, so it is named here. */
            <section className="dash-panel">
              <div className="dash-panel__body">
                <EmptyState
                  title="The forecast is unavailable"
                  message={weatherError ?? 'The weather advisory could not be loaded.'}
                  size={140}
                />
                <div className="wx-retry">
                  <button type="button" className="dash-btn dash-btn--primary" onClick={load}>
                    Try again
                  </button>
                  <button
                    type="button"
                    className="dash-btn dash-btn--ghost"
                    onClick={() => navigate('/account')}
                  >
                    Check farm address
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className={`wx-banner wx-banner--${definition.tone}`}>
                <div className="wx-banner__icon">
                  <IonIcon icon={definition.level === 0 ? partlySunnyOutline : warningOutline} />
                </div>

                <div className="wx-banner__body">
                  <p className="wx-banner__level">
                    {definition.label}
                    {definition.level > 0 && (
                      <span className="wx-banner__lead">
                        {advisory.leadTimeDays === 0
                          ? 'today'
                          : `in ${advisory.leadTimeDays} day${
                              advisory.leadTimeDays === 1 ? '' : 's'
                            }`}
                      </span>
                    )}
                  </p>

                  <h2 className="wx-banner__headline">{advisory.headline}</h2>

                  <p className="wx-banner__place">
                    <IonIcon icon={locationOutline} />
                    {place ?? advisory.matchedPlace}
                    <span className="wx-banner__stamp">
                      Updated {clockTime(advisory.fetchedAt)}
                    </span>
                  </p>
                </div>

                <dl className="wx-banner__figures">
                  <div>
                    <dt>Peak gust</dt>
                    <dd>{peakGust} km/h</dd>
                  </div>
                  <div>
                    <dt>7-day rain</dt>
                    <dd>{rainTotal} mm</dd>
                  </div>
                </dl>
              </section>

              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">Seven-Day Outlook</h2>
                  <span className="dash-stat__hint">{advisory.matchedPlace}</span>
                </div>

                <div className="dash-panel__body">
                  <div className="wx-strip">
                    {advisory.days.map((day, index) => (
                      <div
                        className={`wx-day${index === 0 ? ' wx-day--today' : ''}`}
                        key={day.date}
                      >
                        <p className="wx-day__name">{index === 0 ? 'Today' : weekday(day.date)}</p>
                        <p className="wx-day__date">{dayNumber(day.date)}</p>
                        <IonIcon className="wx-day__icon" icon={dayIcon(day)} />
                        <p className="wx-day__temp">
                          {day.tempMax}&deg; <span>{day.tempMin}&deg;</span>
                        </p>
                        <p className="wx-day__summary">{day.summary}</p>
                        <p className="wx-day__metric">{day.rainMm} mm</p>
                        <p
                          className={`wx-day__metric${
                            day.gustKph >= 39 ? ' wx-day__metric--alert' : ''
                          }`}
                        >
                          {day.gustKph} km/h
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <div className="dash-columns">
                <section className="dash-panel">
                  <div className="dash-panel__head">
                    <h2 className="dash-panel__title">What To Do</h2>
                  </div>

                  <div className="dash-panel__body">
                    <ul className="wx-actions">
                      {definition.actions.map((action) => (
                        <li key={action}>
                          <IonIcon icon={checkmarkCircleOutline} />
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>

                <section className="dash-panel">
                  <div className="dash-panel__head">
                    <h2 className="dash-panel__title">Best To Plant Now</h2>
                    <span className="dash-pill dash-pill--gold">{advisory.season} season</span>
                  </div>

                  <div className="dash-panel__body">
                    {advisory.crops.map((crop) => (
                      <div className="dash-row" key={crop.crop}>
                        <div className="dash-row__icon dash-stat__icon--green">
                          <IonIcon icon={leafOutline} />
                        </div>
                        <div>
                          <p className="dash-row__title">{crop.crop}</p>
                          <p className="dash-row__meta">{crop.note}</p>
                        </div>
                        <div className="dash-row__trailing">{crop.window}</div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">Equipment For This Week</h2>
                  <button
                    type="button"
                    className="dash-panel__link"
                    onClick={() => navigate('/app/equipment')}
                  >
                    Book a unit
                  </button>
                </div>

                <div className="dash-panel__body">
                  {ranked.length === 0 ? (
                    <EmptyState
                      title="No unit is available right now"
                      message="Every unit in the fleet is out on rent or under maintenance."
                      size={120}
                    />
                  ) : (
                    <>
                      {(showAllUnits ? ranked : ranked.slice(0, EQUIPMENT_PREVIEW)).map(
                        ({ unit, fit }) => (
                          <div className="dash-row" key={unit.equipment_id}>
                            <div className={`dash-row__icon wx-verdict-icon--${fit.verdict}`}>
                              <IonIcon icon={verdictIcon[fit.verdict]} />
                            </div>
                            <div>
                              <p className="dash-row__title">{unit.name}</p>
                              <p className="dash-row__meta">{fit.reason}</p>
                            </div>
                            <div className="dash-row__trailing">
                              <span className={`wx-verdict wx-verdict--${fit.verdict}`}>
                                {fit.verdict}
                              </span>
                              <p className="wx-verdict__price">{peso(unit.price_per_day)} / day</p>
                            </div>
                          </div>
                        )
                      )}

                      {/* Only when the list is holding something back. The
                          ranking puts the worst fit last, so what is hidden is
                          what suits the week least. */}
                      {ranked.length > EQUIPMENT_PREVIEW && (
                        <div className="wx-more">
                          <button
                            type="button"
                            className="dash-btn dash-btn--ghost"
                            onClick={() => setShowAllUnits((current) => !current)}
                          >
                            {showAllUnits
                              ? 'Show less'
                              : `View more (${ranked.length - EQUIPMENT_PREVIEW})`}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>

              <p className="dash-note">
                <IonIcon icon={partlySunnyOutline} /> Forecast from Open-Meteo. Wind signals apply
                the PAGASA thresholds to the forecast gusts and are not the official PAGASA
                bulletin.
              </p>
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default WeatherAdvisory;
