export const STATUS_OPTIONS = ['Active', 'Inactive'].map((s) => ({ label: s, value: s }));
export const HAND_OPTIONS = [
  { label: 'Left hand (LH)', value: 'LH' },
  { label: 'Right hand (RH)', value: 'RH' },
];
export const PART_TYPE_OPTIONS = ['Pinion', 'Ring'].map((s) => ({ label: s, value: s }));

export function userName(u?: { fname?: string; lname?: string; email?: string } | null) {
  if (!u) return '—';
  return [u.fname, u.lname].filter(Boolean).join(' ') || u.email || '—';
}
