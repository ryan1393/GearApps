import { PLANT_TIME_ZONE_DEFAULT } from '@truck-log/shared/contracts';

/**
 * Plant time for every date and time Truck Log shows.
 *
 * Guard PCs, CK65 handhelds and TVs are not reliably set to the plant's time zone (Android
 * handhelds often default to UTC), so times are never formatted in the device's own zone. The
 * zone is the server's `TZ` (reported by /health, default America/Indiana/Indianapolis); the app
 * shell applies it with setPlantTimeZone() as soon as the first health check answers.
 */
let zone = PLANT_TIME_ZONE_DEFAULT;
const formatters = new Map<string, Intl.DateTimeFormat>();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function plantTimeZone(): string {
  return zone;
}

/** Applies the server's zone. Ignores anything the browser cannot format; returns true when it changed. */
export function setPlantTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim() || value.trim() === zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() });
  } catch {
    return false;
  }
  zone = value.trim();
  formatters.clear();
  return true;
}

/** A cached Intl formatter in plant time, for callers that need Intl options directly. */
export function plantDateTimeFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone });
    formatters.set(key, formatter);
  }
  return formatter;
}

type Fields = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string };

function fieldsOf(date: Date): Fields {
  const parts = plantDateTimeFormat({
    year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(part('year')), month: Number(part('month')), day: Number(part('day')),
    hour: Number(part('hour')) % 24, minute: Number(part('minute')), second: Number(part('second')),
    weekday: part('weekday'),
  };
}

/** The same named formats as Angular's DatePipe, so templates keep their familiar format names. */
const PRESETS: Record<string, string> = {
  short: 'M/d/yy, h:mm a',
  medium: 'MMM d, y, h:mm:ss a',
  shortDate: 'M/d/yy',
  mediumDate: 'MMM d, y',
  shortTime: 'h:mm a',
  mediumTime: 'h:mm:ss a',
};

const TOKENS = /'[^']*'|EEE|MMM|MM|M|dd|d|yyyy|yy|y|HH|H|hh|h|mm|ss|a/g;

function render(fields: Fields, pattern: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const hour12 = fields.hour % 12 || 12;
  return pattern.replace(TOKENS, (token) => {
    switch (token) {
      case 'EEE': return fields.weekday;
      case 'MMM': return MONTHS[fields.month - 1] ?? '';
      case 'MM': return pad(fields.month);
      case 'M': return String(fields.month);
      case 'dd': return pad(fields.day);
      case 'd': return String(fields.day);
      case 'yyyy': case 'y': return String(fields.year);
      case 'yy': return pad(fields.year % 100);
      case 'HH': return pad(fields.hour);
      case 'H': return String(fields.hour);
      case 'hh': return pad(hour12);
      case 'h': return String(hour12);
      case 'mm': return pad(fields.minute);
      case 'ss': return pad(fields.second);
      case 'a': return fields.hour < 12 ? 'AM' : 'PM';
      default: return token.slice(1, -1);
    }
  });
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Formats a date in plant time. `format` is a DatePipe-style name ('short', 'shortTime', …) or
 * pattern ('M/d/yy h:mm a'), or 'smartTime': the time alone for today and the date with the time
 * otherwise, so an overnight truck's "11:40 PM" cannot be mistaken for today. Invalid or missing
 * values give ''.
 */
export function formatPlantDate(value: unknown, format = 'mediumDate', now: Date | number = Date.now()): string {
  const date = toDate(value);
  if (!date) return '';
  const fields = fieldsOf(date);
  if (format === 'smartTime') {
    const today = fieldsOf(new Date(now));
    const sameDay = today.year === fields.year && today.month === fields.month && today.day === fields.day;
    return render(fields, sameDay ? 'h:mm a' : 'M/d h:mm a');
  }
  return render(fields, PRESETS[format] ?? format);
}
