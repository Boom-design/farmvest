import { useMemo, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';
import './DateRangeCalendar.css';

export type BlockedRange = { start: string; end: string };

type DateRangeCalendarProps = {
  /** Ranges the unit is already committed to, inclusive on both ends. */
  blocked: BlockedRange[];
  /** ISO date, or '' when nothing is chosen yet. */
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  /** Earliest selectable date, normally today. */
  min: string;
};

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * ISO date arithmetic done on the string, in UTC.
 *
 * A local Date built from 'YYYY-MM-DD' is midnight UTC, which is the previous
 * evening anywhere west of Greenwich, so reading its local day number gives the
 * day before. Everything here stays in UTC and formats back by hand.
 */
const iso = (date: Date) => date.toISOString().slice(0, 10);

const parse = (value: string) => new Date(`${value}T00:00:00Z`);

const addDays = (value: string, count: number) => {
  const date = parse(value);
  date.setUTCDate(date.getUTCDate() + count);
  return iso(date);
};

/** Every date in an inclusive range, as ISO strings. */
const expand = (from: string, to: string) => {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
};

/**
 * A month grid for picking a rental period.
 *
 * This replaces two date inputs and a list of occupied ranges below them. The
 * list was correct and unusable: a popular unit accumulates a dozen bookings,
 * and reading twelve date ranges to work out which days are still free is work
 * the calendar can simply show. A blocked day is red and cannot be clicked, so
 * an impossible booking is not something the renter can type.
 */
const DateRangeCalendar: React.FC<DateRangeCalendarProps> = ({
  blocked,
  start,
  end,
  onChange,
  min,
}) => {
  const [cursor, setCursor] = useState(() => parse(start || min));

  const blockedDays = useMemo(() => {
    const set = new Set<string>();
    for (const range of blocked) {
      for (const day of expand(range.start, range.end)) set.add(day);
    }
    return set;
  }, [blocked]);

  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(year, month, 1));
    const lead = first.getUTCDay();
    const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    // Leading blanks keep the first of the month under its own weekday.
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= length; day += 1) {
      out.push(iso(new Date(Date.UTC(year, month, day))));
    }
    return out;
  }, [year, month]);

  const step = (by: number) => setCursor(new Date(Date.UTC(year, month + by, 1)));

  /**
   * Pick a day.
   *
   * The first click sets both ends, so a one-day rental needs one click. The
   * second extends the range, unless it lands before the start or the stretch
   * between the two crosses a booked day -- either way the click starts a fresh
   * selection, which is what someone correcting themselves means by it.
   */
  const choose = (day: string) => {
    if (day < min || blockedDays.has(day)) return;

    const startingOver = !start || !end || start !== end || day < start;

    if (startingOver) {
      onChange(day, day);
      return;
    }

    const crosses = expand(start, day).some((between) => blockedDays.has(between));
    if (crosses) {
      onChange(day, day);
      return;
    }

    onChange(start, day);
  };

  const classFor = (day: string) => {
    const names = ['cal__day'];

    if (blockedDays.has(day)) names.push('cal__day--blocked');
    else if (day < min) names.push('cal__day--past');

    if (start && end && day >= start && day <= end) {
      names.push('cal__day--selected');
      if (day === start) names.push('cal__day--start');
      if (day === end) names.push('cal__day--end');
    }

    return names.join(' ');
  };

  return (
    <div className="cal">
      <div className="cal__head">
        <button type="button" className="cal__nav" onClick={() => step(-1)} aria-label="Previous month">
          <IonIcon icon={chevronBackOutline} />
        </button>

        <span className="cal__month">
          {MONTHS[month]} {year}
        </span>

        <button type="button" className="cal__nav" onClick={() => step(1)} aria-label="Next month">
          <IonIcon icon={chevronForwardOutline} />
        </button>
      </div>

      <div className="cal__grid cal__grid--weekdays">
        {WEEKDAYS.map((label) => (
          <span key={label} className="cal__weekday">
            {label}
          </span>
        ))}
      </div>

      <div className="cal__grid">
        {cells.map((day, index) =>
          day === null ? (
            <span key={`blank-${index}`} className="cal__day cal__day--blank" />
          ) : (
            <button
              key={day}
              type="button"
              className={classFor(day)}
              disabled={day < min || blockedDays.has(day)}
              onClick={() => choose(day)}
              aria-label={day}
            >
              {Number(day.slice(8, 10))}
            </button>
          )
        )}
      </div>

      <div className="cal__legend">
        <span className="cal__key cal__key--selected" /> Your dates
        <span className="cal__key cal__key--blocked" /> Already booked
        <span className="cal__key cal__key--past" /> Unavailable
      </div>
    </div>
  );
};

export default DateRangeCalendar;
