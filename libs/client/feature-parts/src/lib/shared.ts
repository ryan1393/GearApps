export const STATUS_OPTIONS = ['Active', 'Inactive'].map((s) => ({ label: s, value: s }));
/** The API stores status in lower case ('active'); the Status control's options are 'Active' / 'Inactive'. */
export function toStatusOption(status?: string | null): 'Active' | 'Inactive' {
  return String(status ?? '').trim().toLowerCase() === 'inactive' ? 'Inactive' : 'Active';
}
export const PART_TYPE_OPTIONS = ['Pinion', 'Ring'].map((s) => ({ label: s, value: s }));

export function userName(u?: { fname?: string; lname?: string; email?: string } | null) {
  if (!u) return '—';
  return [u.fname, u.lname].filter(Boolean).join(' ') || u.email || '—';
}
