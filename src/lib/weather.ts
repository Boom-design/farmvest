/**
 * Weather advisory data for the Farm Owner page (AI #2).
 *
 * The forecast is live, from Open-Meteo: free, no API key, no account. Two of
 * its endpoints are used, geocoding to turn the registered farm address into
 * coordinates and the forecast itself.
 *
 * Open-Meteo is the data source, not the advice. What FarmVest adds is the
 * knowledge base below: PAGASA wind-signal thresholds applied to the forecast
 * gusts, preparation steps per signal, an equipment rule set read against the
 * week's rain and wind, and a seasonal planting calendar. The forecast says what
 * the weather will be; these rules say what to do about it.
 */

import { familyOf } from './equipment';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** Days of forecast to request. Open-Meteo serves up to 16. */
const FORECAST_DAYS = 7;

/** Coordinates never move, so they are kept until the browser is cleared. */
const GEO_CACHE_PREFIX = 'farmvest.geo.';

/** A forecast older than this is refetched. Open-Meteo updates hourly. */
const FORECAST_CACHE_PREFIX = 'farmvest.wx.';
const FORECAST_CACHE_MS = 3 * 60 * 60 * 1000;

/** Neither endpoint should hold the page if the network is unreachable. */
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * PAGASA Tropical Cyclone Wind Signal, as the app applies it to a gust
 * forecast. Level 0 is the ordinary case: no signal is in effect.
 *
 * The wind ranges are the PAGASA thresholds; the actions are what the farm
 * owner is told to do, which is the part FarmVest supplies. A signal here is
 * raised from a forecast rather than from a bulletin, so the wording says
 * "expected" and the page never claims to be the official advisory.
 */
export type AdvisoryLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type AdvisoryDefinition = {
  level: AdvisoryLevel;
  /** Short name for the banner. */
  label: string;
  /** Lower bound of the gust range, in km/h. */
  windFrom: number;
  /** Upper bound, or null for the open-ended top signal. */
  windTo: number | null;
  /** Drives the banner colour and the equipment verdicts. */
  tone: 'calm' | 'watch' | 'warning' | 'severe';
  actions: string[];
};

export const ADVISORY_LEVELS: AdvisoryDefinition[] = [
  {
    level: 0,
    label: 'No Signal',
    windFrom: 0,
    windTo: 38,
    tone: 'calm',
    actions: [
      'Normal farm operations.',
      'Keep drainage clear before the next rain band.',
      'Check the outlook again before booking equipment.',
    ],
  },
  {
    level: 1,
    label: 'Signal No. 1',
    windFrom: 39,
    windTo: 61,
    tone: 'watch',
    actions: [
      'Secure loose roofing, tarpaulins, and feed sacks.',
      'Harvest crops that are already mature.',
      'Move portable equipment under cover.',
    ],
  },
  {
    level: 2,
    label: 'Signal No. 2',
    windFrom: 62,
    windTo: 88,
    tone: 'warning',
    actions: [
      'Postpone equipment bookings that fall inside the window.',
      'Reinforce livestock shelters and tie down roofing.',
      'Move animals to higher, sheltered ground.',
      'Stock three days of feed and clean water.',
    ],
  },
  {
    level: 3,
    label: 'Signal No. 3',
    windFrom: 89,
    windTo: 117,
    tone: 'severe',
    actions: [
      'Evacuate livestock to the strongest available shelter.',
      'Stop all field work.',
      'Cut power to farm equipment and move it indoors.',
      'Keep records and documents in a waterproof container.',
    ],
  },
  {
    level: 4,
    label: 'Signal No. 4',
    windFrom: 118,
    windTo: 184,
    tone: 'severe',
    actions: [
      'Suspend every farm activity.',
      'Follow the local evacuation order.',
      'Expect severe damage to light structures and standing crops.',
    ],
  },
  {
    level: 5,
    label: 'Signal No. 5',
    windFrom: 185,
    windTo: null,
    tone: 'severe',
    actions: [
      'Suspend every farm activity.',
      'Evacuate. Do not return until the local authority clears the area.',
    ],
  },
];

export const advisoryFor = (level: AdvisoryLevel): AdvisoryDefinition =>
  ADVISORY_LEVELS.find((entry) => entry.level === level) ?? ADVISORY_LEVELS[0];

/** Classify a gust speed in km/h into a wind signal. */
export const signalForGust = (gustKph: number): AdvisoryLevel => {
  const match = [...ADVISORY_LEVELS].reverse().find((entry) => gustKph >= entry.windFrom);
  return match?.level ?? 0;
};

export type ForecastDay = {
  /** ISO date, as Open-Meteo returns it. */
  date: string;
  /** Plain-language reading of the WMO weather code. */
  summary: string;
  tempMax: number;
  tempMin: number;
  rainMm: number;
  gustKph: number;
};

export type CropTip = {
  crop: string;
  /** When to plant, in words: "Now through late October". */
  window: string;
  note: string;
};

export type Advisory = {
  level: AdvisoryLevel;
  /** One sentence for the banner, naming the day the weather arrives. */
  headline: string;
  /** Days until the worst day, so the banner can say how much time is left. */
  leadTimeDays: number;
  /** Season the crop advice is based on. */
  season: 'Dry' | 'Wet';
  /** The place Open-Meteo actually matched, which may be spelled differently. */
  matchedPlace: string;
  /** When the forecast was fetched, so the page can say how fresh it is. */
  fetchedAt: string;
  days: ForecastDay[];
  crops: CropTip[];
};

/** Verdict shown on each unit in the equipment panel. */
export type Suitability = {
  verdict: 'Recommended' | 'Caution' | 'Postpone';
  reason: string;
};

/**
 * Thrown when the advisory cannot be produced, with a message written for the
 * farm owner rather than for a log file.
 */
export class WeatherError extends Error {}

// ---------------------------------------------------------------------------
// WMO weather codes
// ---------------------------------------------------------------------------

/**
 * Open-Meteo reports the day's weather as a WMO code. Only the codes that occur
 * in the Philippines are spelled out; the freezing and snow ranges are kept for
 * completeness so an unexpected code never prints as a bare number.
 */
const WEATHER_CODES: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Rain showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Severe thunderstorm',
};

const describeCode = (code: number) => WEATHER_CODES[code] ?? 'Mixed conditions';

// ---------------------------------------------------------------------------
// Equipment rules
// ---------------------------------------------------------------------------

/**
 * Match one unit against the advisory.
 *
 * A wind signal decides everything on its own: no unit is worth booking into a
 * storm, whatever it is for. Below that the family of the unit is read against
 * the week's rainfall, and the family comes from lib/equipment, which knows the
 * type the Admin picked rather than searching the name for a word.
 */
export const suitabilityFor = (
  equipmentName: string,
  equipmentType: string | null,
  advisory: Advisory
): Suitability => {
  const rainTotal = advisory.days.reduce((sum, day) => sum + day.rainMm, 0);
  const rain = Math.round(rainTotal);
  const wet = rainTotal >= 40;
  const family = familyOf(equipmentName, equipmentType);

  if (advisory.level >= 2) {
    return {
      verdict: 'Postpone',
      reason: `${advisoryFor(advisory.level).label} is expected within ${advisory.leadTimeDays} days.`,
    };
  }

  if (advisory.level === 1) {
    return {
      verdict: 'Caution',
      reason: 'Winds of 39-61 km/h are expected. Book only for the calm days.',
    };
  }

  switch (family) {
    case 'soil':
      return wet
        ? {
            verdict: 'Recommended',
            reason: 'Rain softens the soil, so tillage takes fewer passes.',
          }
        : {
            verdict: 'Recommended',
            reason: `A dry week at ${rain} mm. Firm ground, so allow for a slower pass.`,
          };

    case 'planting':
      return wet
        ? {
            verdict: 'Recommended',
            reason: `${rain} mm of rain is forecast, which is what a new stand needs.`,
          }
        : {
            verdict: 'Caution',
            reason: `Only ${rain} mm of rain is forecast. Plan irrigation before you plant.`,
          };

    case 'spray':
      return wet
        ? {
            verdict: 'Caution',
            reason: `${rain} mm of rain is forecast. Spray washes off before it acts.`,
          }
        : {
            verdict: 'Recommended',
            reason: `A dry week at ${rain} mm, so the spray has time to work.`,
          };

    case 'water':
      return wet
        ? {
            verdict: 'Caution',
            reason: `${rain} mm of rain is forecast, so the field may not need watering.`,
          }
        : {
            verdict: 'Recommended',
            reason: `Only ${rain} mm of rain is forecast. Irrigation carries the week.`,
          };

    case 'harvest':
      return wet
        ? {
            verdict: 'Caution',
            reason: 'Harvesting into rain raises grain moisture and slows the machine.',
          }
        : { verdict: 'Recommended', reason: `A dry week at ${rain} mm suits harvesting.` };

    case 'postharvest':
      return wet
        ? {
            verdict: 'Caution',
            reason: 'Wet grain needs drying before storage. Plan for the extra step.',
          }
        : {
            verdict: 'Recommended',
            reason: `A dry week at ${rain} mm, so drying and milling go quickly.`,
          };

    case 'livestock':
      // Feed, milking and weighing happen under a roof, so rain does not decide
      // them. The wind signal above already covers the case that does.
      return {
        verdict: 'Recommended',
        reason: 'Livestock handling is done under shelter, so the week suits it either way.',
      };

    case 'transport':
      return wet
        ? {
            verdict: 'Caution',
            reason: `${rain} mm of rain is forecast. Farm tracks soften, so allow more time.`,
          }
        : { verdict: 'Recommended', reason: `A dry week at ${rain} mm keeps the tracks firm.` };

    default:
      return { verdict: 'Recommended', reason: 'No weather conflict in the next seven days.' };
  }
};

// ---------------------------------------------------------------------------
// Planting calendar
// ---------------------------------------------------------------------------

/**
 * Philippine cropping seasons: dry from November to April, wet from May to
 * October. Coarse on purpose. A per-province calendar is the refinement, but it
 * needs a data source the project does not have yet, and a wrong specific
 * answer is worse than a right general one.
 */
const seasonFor = (month: number): Advisory['season'] =>
  month >= 10 || month <= 3 ? 'Dry' : 'Wet';

const CROPS: Record<Advisory['season'], CropTip[]> = {
  Dry: [
    {
      crop: 'Corn',
      window: 'Now through February',
      note: 'The dry months keep ear rot down and make drying cheap.',
    },
    {
      crop: 'Mungbean',
      window: 'Now through January',
      note: 'Short season and low water need. Fits between two rice crops.',
    },
    {
      crop: 'Vegetables (eggplant, tomato)',
      window: 'Now, with irrigation',
      note: 'Prices peak in the dry months, but the plot needs a water source.',
    },
  ],
  Wet: [
    {
      crop: 'Rice (wet season)',
      window: 'Now through August',
      note: 'Rainfall covers most of the water requirement.',
    },
    {
      crop: 'Sweet potato',
      window: 'Now through September',
      note: 'Tolerates heavy rain and holds the soil on sloping land.',
    },
    {
      crop: 'Peanut',
      window: 'Late in the wet season',
      note: 'Plant so the harvest lands after the rain, or the pods rot in the ground.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/** localStorage throws in a private window on some browsers, so it is optional. */
const readCache = <T>(key: string): T | null => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const writeCache = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked store is not a reason to fail the page.
  }
};

const fetchJson = async (url: string) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new WeatherError(`The weather service answered with ${response.status}.`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof WeatherError) throw error;
    throw new WeatherError('Could not reach the weather service. Check your connection.');
  } finally {
    window.clearTimeout(timer);
  }
};

type Coordinates = { latitude: number; longitude: number; label: string };

type GeocodeResult = {
  name: string;
  latitude: number;
  longitude: number;
  /** Province, in Open-Meteo's naming. */
  admin1?: string;
  country_code?: string;
};

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Names to try for one PSGC place, in order from most to least specific.
 *
 * The offline dataset writes a city the way the statistics authority does:
 * "Cagayan De Oro City (Capital)", "City Of Naga", "Municipality Of Tanay". A
 * geocoder indexes the plain endonym, so the decorations have to come off, and
 * because it is not certain which form is indexed the shorter forms are tried
 * in turn rather than guessed at once.
 */
const placeCandidates = (raw: string): string[] => {
  // "(Capital)" and any other parenthetical is a note about the place, not part
  // of its name.
  const cleaned = raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const candidates = [cleaned];

  const prefixed = cleaned.match(/^(?:city|municipality)\s+of\s+(.+)$/i);
  if (prefixed) candidates.push(prefixed[1].trim());

  const suffixed = cleaned.replace(/\s+(?:city|municipality)$/i, '').trim();
  if (suffixed) candidates.push(suffixed);

  return Array.from(new Set(candidates.filter(Boolean)));
};

const searchPlace = async (name: string): Promise<GeocodeResult[]> => {
  const query = new URLSearchParams({
    name,
    count: '10',
    language: 'en',
    format: 'json',
    countryCode: 'PH',
  });

  const data = (await fetchJson(`${GEOCODE_URL}?${query}`)) as { results?: GeocodeResult[] };
  return (data.results ?? []).filter((entry) => entry.country_code === 'PH');
};

/**
 * Turn the registered farm address into coordinates.
 *
 * The address is stored as text from the offline PSGC dataset, which carries no
 * coordinates, so the city name is resolved through Open-Meteo's geocoder. The
 * search is restricted to the Philippines, and where several places share a
 * name the province decides, because "San Jose" alone names dozens of towns.
 *
 * If no spelling of the city is indexed, the province is used instead. A
 * forecast for the wrong end of the right province is still the right weather
 * system, and the banner names the place that was matched, so the farm owner
 * can see it is not their own town.
 */
const geocodeFarm = async (city: string, province: string): Promise<Coordinates> => {
  const key = `${GEO_CACHE_PREFIX}${city}|${province}`.toLowerCase();
  const cached = readCache<Coordinates>(key);
  if (cached) return cached;

  let results: GeocodeResult[] = [];

  for (const candidate of placeCandidates(city)) {
    results = await searchPlace(candidate);
    if (results.length > 0) break;
  }

  if (results.length === 0) {
    for (const candidate of placeCandidates(province)) {
      results = await searchPlace(candidate);
      if (results.length > 0) break;
    }
  }

  if (results.length === 0) {
    throw new WeatherError(
      `Open-Meteo has no coordinates for ${city} or ${province}. Check the farm address on your account.`
    );
  }

  // A province match wins; otherwise the geocoder's own first choice, which is
  // ranked by population.
  const wanted = normalise(province);
  const best =
    results.find((entry) => entry.admin1 && normalise(entry.admin1) === wanted) ??
    results.find((entry) => entry.admin1 && normalise(entry.admin1).includes(wanted)) ??
    results[0];

  const coordinates: Coordinates = {
    latitude: best.latitude,
    longitude: best.longitude,
    label: best.admin1 ? `${best.name}, ${best.admin1}` : best.name,
  };

  writeCache(key, coordinates);
  return coordinates;
};

type ForecastResponse = {
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    wind_gusts_10m_max: number[];
  };
};

type CachedForecast = { fetchedAt: string; days: ForecastDay[] };

const fetchForecast = async (point: Coordinates): Promise<CachedForecast> => {
  const key = `${FORECAST_CACHE_PREFIX}${point.latitude.toFixed(2)},${point.longitude.toFixed(2)}`;
  const cached = readCache<CachedForecast>(key);

  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < FORECAST_CACHE_MS) {
    return cached;
  }

  const query = new URLSearchParams({
    latitude: String(point.latitude),
    longitude: String(point.longitude),
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max',
    timezone: 'Asia/Manila',
    forecast_days: String(FORECAST_DAYS),
    wind_speed_unit: 'kmh',
  });

  const data = (await fetchJson(`${FORECAST_URL}?${query}`)) as ForecastResponse;
  const daily = data.daily;

  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) {
    throw new WeatherError('The weather service returned no forecast for this location.');
  }

  const days: ForecastDay[] = daily.time.map((date, index) => ({
    date,
    summary: describeCode(daily.weather_code[index]),
    tempMax: Math.round(daily.temperature_2m_max[index]),
    tempMin: Math.round(daily.temperature_2m_min[index]),
    rainMm: Math.round(daily.precipitation_sum[index] ?? 0),
    gustKph: Math.round(daily.wind_gusts_10m_max[index] ?? 0),
  }));

  const forecast: CachedForecast = { fetchedAt: new Date().toISOString(), days };
  writeCache(key, forecast);
  return forecast;
};

/**
 * Build the advisory for one farm.
 *
 * Throws a WeatherError with a message the page can show as it stands. The
 * caller supplies the city and province from the farm_owners row; without them
 * there is nothing to forecast against, which is a setup problem rather than a
 * weather one.
 */
export const loadAdvisory = async (city: string, province: string): Promise<Advisory> => {
  if (!city || !province) {
    throw new WeatherError(
      'No farm address is on file for this account, so there is no location to forecast.'
    );
  }

  const point = await geocodeFarm(city, province);
  const { days, fetchedAt } = await fetchForecast(point);

  // The worst day in the window sets the signal, and how far off it is becomes
  // the lead time. PAGASA raises a signal 12 to 36 hours ahead; a seven-day
  // forecast gives more warning than that, which is the point of showing it.
  const peak = days.reduce((worst, day) => (day.gustKph > worst.gustKph ? day : worst), days[0]);
  const level = signalForGust(peak.gustKph);
  const leadTimeDays = days.indexOf(peak);

  const season = seasonFor(new Date().getMonth());

  const headline =
    level === 0
      ? `No wind signal is expected at ${point.label} in the next ${days.length} days.`
      : `${advisoryFor(level).label} conditions are expected around ${new Date(
          peak.date
        ).toLocaleDateString('en-PH', { weekday: 'long' })}, with gusts to ${peak.gustKph} km/h.`;

  return {
    level,
    headline,
    leadTimeDays,
    season,
    matchedPlace: point.label,
    fetchedAt,
    days,
    crops: CROPS[season],
  };
};
