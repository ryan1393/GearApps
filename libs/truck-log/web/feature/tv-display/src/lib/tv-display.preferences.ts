/** browser-display preferences and elapsed-time presentation only. */
export const TV_ROTATION_DEFAULT = 15;
export const TV_ROTATION_MIN = 10;
export const TV_ROTATION_MAX = 120;
export function tvRotationSeconds(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !/^\d{1,3}$/.test(value.trim())) return null;
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= TV_ROTATION_MIN && seconds <= TV_ROTATION_MAX ? seconds : null;
}
export function tvRotationKey(management: boolean): string {
  return 'truckLogTvRotationSeconds.v1.' + (management ? 'management' : 'docks');
}
export interface TvAgePart { value: string; unit: 'day' | 'days' | 'hr' | 'min'; }
export interface TvAge { valid: boolean; parts: TvAgePart[]; accessible: string; }
export function tvAge(value: string | null, now: number): TvAge {
  const start = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(now)) return { valid: false, parts: [], accessible: 'Not recorded' };
  // Same minute flooring and nonnegative elapsed-time rule as the existing TV board.
  const total = Math.max(0, Math.floor((now - start) / 60000));
  const days = Math.floor(total / 1440), hours = Math.floor(total % 1440 / 60), minutes = total % 60;
  const parts: TvAgePart[] = [];
  const labels: string[] = [];
  if (days) { parts.push({ value: String(days), unit: days === 1 ? 'day' : 'days' }); labels.push(days + (days === 1 ? ' day' : ' days')); }
  if (days || hours) { parts.push({ value: String(hours).padStart(2, '0'), unit: 'hr' }); labels.push(hours + (hours === 1 ? ' hour' : ' hours')); }
  parts.push({ value: String(minutes).padStart(2, '0'), unit: 'min' });
  labels.push(minutes + (minutes === 1 ? ' minute' : ' minutes'));
  return { valid: true, parts, accessible: labels.join(', ') };
}
