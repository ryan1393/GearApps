/** presentation only. Never rewrite the retained RXO ETA value.
 * The native Expedite contract carries raw Excel-1900 serials without a timezone.
 * Preserve those wall-clock fields under Truck Log's Eastern-time convention;
 * do NOT interpret them as UTC and subtract four/five hours. Explicit offsets
 * are actual instants and are converted to Eastern using the IANA timezone.
 */
const ETA_EMPTY = '\u2014';
const ETA_REVIEW = 'Requires review';
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const SECONDS_PER_DAY = 86400;
const ETA_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: 'short', day: '2-digit',
  hour: 'numeric', minute: '2-digit', hour12: true,
};
const WALL_FORMAT = new Intl.DateTimeFormat('en-US', { ...ETA_OPTIONS, timeZone: 'UTC' });
const EASTERN_FORMAT = new Intl.DateTimeFormat('en-US', { ...ETA_OPTIONS, timeZone: 'America/New_York' });

function label(date: Date, instant: boolean, dateOnly = false, timeOnly = false): string {
  const parts = (instant ? EASTERN_FORMAT : WALL_FORMAT).formatToParts(date);
  const part = (name: string): string => parts.find(item => item.type === name)?.value ?? '';
  const calendar = `${part('month')} ${part('day')}, ${part('year')}`;
  const clock = `${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
  return `${dateOnly ? calendar : timeOnly ? clock : `${calendar} ${clock}`} ET`;
}

// UTC here is a calendar-field carrier, not an assertion of the export timezone.
function calendarDate(y: number, m: number, d: number, h = 0, min = 0, sec = 0, ms = 0): Date | null {
  if (![y, m, d, h, min, sec, ms].every(Number.isInteger)
      || y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31
      || h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59 || ms < 0 || ms > 999) return null;
  const date = new Date(Date.UTC(y, m - 1, d, h, min, sec, ms));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

function serialLabel(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value >= 2958466) return ETA_REVIEW;
  if (value === 0) return ETA_EMPTY;
  // Time-only spreadsheet cells must not acquire a made-up 1899 calendar date.
  if (value < 1) {
    const seconds = Math.round(value * SECONDS_PER_DAY);
    return label(new Date(Date.UTC(2000, 0, 1) + seconds * 1000), false, false, true);
  }
  // Excel's fictitious 1900-02-29 and earlier legacy serials are not valid ETAs.
  if (value < 61) return ETA_REVIEW;
  const date = new Date(EXCEL_EPOCH_MS + Math.round(value * SECONDS_PER_DAY) * 1000);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) return ETA_REVIEW;
  return label(date, false);
}

/** Format a raw Expedite ETA without dependence on the browser's local timezone. */
export function formatExpediteEta(value: string | number | null | undefined): string {
  if (value == null) return ETA_EMPTY;
  if (typeof value === 'number') return serialLabel(value);
  if (typeof value !== 'string') return ETA_REVIEW;
  const text = value.trim();
  if (!text || /^(?:[-\u2013\u2014]|n\/?a|null|undefined|tbd|pending|not available)$/i.test(text)) return ETA_EMPTY;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return serialLabel(Number(text));

  // Strict ISO calendar/clock, optionally with an explicit UTC offset.
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(text);
  if (iso) {
    const date = calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4] ?? 0),
      Number(iso[5] ?? 0), Number(iso[6] ?? 0), Number((iso[7] ?? '').padEnd(3, '0').slice(0, 3)));
    if (!date) return ETA_REVIEW;
    const zone = iso[8];
    if (!zone) return label(date, false, !iso[4]);
    let offset = 0;
    if (zone.toUpperCase() !== 'Z') {
      const hh = Number(zone.slice(1, 3));
      const mm = Number(zone.replace(':', '').slice(3, 5));
      if (hh > 14 || mm > 59 || (hh === 14 && mm !== 0)) return ETA_REVIEW;
      offset = (hh * 60 + mm) * (zone[0] === '+' ? 1 : -1);
    }
    return label(new Date(date.getTime() - offset * 60000), true);
  }

  // US Excel text dates. No browser-dependent Date.parse or 2-digit-year guesses.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?\s*(ET)?$/i.exec(text);
  if (us) {
    let hour = Number(us[4] ?? 0);
    if (us[7]) {
      if (hour < 1 || hour > 12) return ETA_REVIEW;
      hour = hour % 12 + (us[7].toUpperCase() === 'PM' ? 12 : 0);
    }
    const date = calendarDate(Number(us[3]), Number(us[1]), Number(us[2]), hour, Number(us[5] ?? 0), Number(us[6] ?? 0));
    return date ? label(date, false, !us[4]) : ETA_REVIEW;
  }
  const named = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?\s*(ET)?$/i.exec(text);
  if (named) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    let hour = Number(named[4] ?? 0);
    if (named[7]) {
      if (hour < 1 || hour > 12) return ETA_REVIEW;
      hour = hour % 12 + (named[7].toUpperCase() === 'PM' ? 12 : 0);
    }
    const date = calendarDate(Number(named[3]), month, Number(named[2]), hour, Number(named[5] ?? 0), Number(named[6] ?? 0));
    return date ? label(date, false, !named[4]) : ETA_REVIEW;
  }
  return ETA_REVIEW;
}
