/** A model's name: its number, or its type when it has no number. */
export function modelLabel(model?: { model_number?: string | null; model_type?: string | null } | null): string {
  return model?.model_number?.trim() || model?.model_type?.trim() || '—';
}

/** Serial typed as T0301, 301 or t0301: the canonical prefix plus at least four digits, or '' when invalid. */
export function normalizeSequentialAssetSerial(prefix: 'T' | 'C', input: string): string {
  const raw = input.trim().toUpperCase();
  const match = new RegExp(`^(?:${prefix})?0*([0-9]+)$`).exec(raw);
  if (!match) return '';
  const numeric = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return '';
  return `${prefix}${String(numeric).padStart(4, '0')}`;
}
