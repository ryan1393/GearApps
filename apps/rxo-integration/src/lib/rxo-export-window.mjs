// Fixed Fort Wayne acquisition plan. Settings can change scan timing, not coverage.
// Keep this pure so the API's displayed plan and the calendar boundary are testable
// without launching a browser or loading workbook dependencies.
export const EXPORT_ZONE = 'America/Indiana/Indianapolis';

export function exportWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: EXPORT_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const shift = offset => new Date(Date.parse(today + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
  return { timeZone: EXPORT_ZONE, startDate: shift(-1), endDate: shift(1), dates: [shift(-1), today, shift(1)] };
}

export function exportAssertWindow(window, now = new Date()) {
  if (JSON.stringify(window) !== JSON.stringify(exportWindow(now))) {
    throw new Error('RXO_EXPORT: the Fort Wayne calendar day changed during the scan. Retry with a single current three-day window; no mixed-date batch was published.');
  }
}
