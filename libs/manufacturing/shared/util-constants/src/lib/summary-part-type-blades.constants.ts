/**
 * HOS, Inner blade and Outer blade belong to a Summary + Part Type (RING and PINION each have
 * their own three values). Shared by the API and Admin so both validate the same way.
 *
 * The field is the position: a label is never moved or rejected because of its IB/OB suffix,
 * and the two labels may have different hands (PINION 30538: Inner LH IB, Outer RH IB).
 * Workpiece HOS is not cutter-body hand and is not a cutter-body restriction.
 */
export const SUMMARY_PART_TYPE_CODES = Object.freeze(['RING', 'PINION'] as const);
export type SummaryPartTypeCode = (typeof SUMMARY_PART_TYPE_CODES)[number];

export const SUMMARY_HOS_VALUES = Object.freeze(['RH', 'LH'] as const);

/** Labels offered in the editors; a stored label outside this list is kept and still offered. */
export const KNOWN_BLADE_LABELS = Object.freeze(['RH IB', 'RH OB', 'LH IB', 'LH OB'] as const);

export const BLADE_LABEL_MAX_LENGTH = 32;

/** Trim, collapse inner spaces and upper-case; blank is null. The label's words are kept. */
export function normalizeBladeLabel(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return text ? text : null;
}

export function normalizeSummaryHos(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim().toUpperCase();
  return text ? text : null;
}

/** Why a blade label cannot be stored, or null. Blank is allowed (clears the field). */
export function bladeLabelProblem(value: string | null | undefined): string | null {
  const label = normalizeBladeLabel(value);
  if (label === null) return null;
  if (label.length > BLADE_LABEL_MAX_LENGTH) return `Blade label "${label}" is longer than ${BLADE_LABEL_MAX_LENGTH} characters`;
  if (!/^[A-Z0-9][A-Z0-9 ./-]*$/.test(label)) return `Blade label "${label}" may contain only letters, digits, spaces, ".", "/" and "-"`;
  return null;
}

/** Why a HOS value cannot be stored, or null. Blank is allowed (clears the field). */
export function summaryHosProblem(value: string | null | undefined): string | null {
  const hos = normalizeSummaryHos(value);
  if (hos === null || (SUMMARY_HOS_VALUES as readonly string[]).includes(hos)) return null;
  return `HOS must be ${SUMMARY_HOS_VALUES.join(' or ')} (got "${hos}")`;
}
