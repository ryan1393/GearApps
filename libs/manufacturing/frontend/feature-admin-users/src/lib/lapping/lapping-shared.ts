export const STATUS_OPTIONS = ['Active', 'Inactive'].map((s) => ({ label: s, value: s }));
/** The API stores status in lower case ('active'); the Status control's options are 'Active' / 'Inactive'. */
export function toStatusOption(status?: string | null): 'Active' | 'Inactive' {
  return String(status ?? '').trim().toLowerCase() === 'inactive' ? 'Inactive' : 'Active';
}
