/**
 * Mapping between Fanuc macro numbers / names and the fields shown on the
 * lapping summary. Carried over 1:1 from the legacy forms so values land in
 * the same boxes operators are used to.
 */
import { LappingSummaryRow } from '@gearapps/shared/domain';

export type FieldKind = 'number' | 'flag' | 'text' | 'retract';

export interface FieldDef {
  label: string;
  /** Macro number (preferred) … */
  macro?: number;
  /** … or a name fragment for path forms, where numbers differ per path. */
  name?: string;
  kind?: FieldKind;
  unit?: string;
}

export interface GroupDef {
  title: string;
  fields: FieldDef[];
}

// ---------- Gearset data (used_form = gear_data) ----------
export const GEARSET_FIELDS: FieldDef[] = [
  { label: 'Gearset', macro: 10020 },
  { label: 'Part', macro: 10021 },
  { label: 'Family', macro: 10022 },
  { label: 'LH/RH', macro: 10023 },
  { label: 'Pinion diameter', macro: 10028 },
  { label: 'Ring diameter', macro: 10029 },
  { label: 'BTM1', macro: 10027 },
  { label: 'MN', macro: 10026 },
];

// ---------- General data (used_form = general_data) ----------
export const GENERAL_GROUPS: GroupDef[] = [
  {
    title: 'Meshing',
    fields: [
      { label: 'Pinion rotating', macro: 10200, kind: 'flag' },
      { label: 'Go into mesh attempts', macro: 10033 },
      { label: 'Travel to mesh', macro: 10034 },
      { label: 'Backlash axial', macro: 10035 },
    ],
  },
  { title: 'Backlash setting', fields: [{ label: 'Tightest B/L', macro: 10201, kind: 'flag' }] },
  {
    title: 'Time settings',
    fields: [
      { label: 'Cycle target', macro: 10063, unit: 's' },
      { label: 'Parts per hour target', macro: 10086 },
    ],
  },
  {
    title: 'Ratio detection',
    fields: [
      { label: 'Ratio detection', macro: 10210, kind: 'flag' },
      { label: 'Runout check incl.', macro: 10211, kind: 'flag' },
    ],
  },
  {
    title: 'Runout check',
    fields: [
      { label: 'Enabled', macro: 10203, kind: 'flag' },
      { label: 'Tolerance pinion', macro: 10036 },
      { label: 'Tolerance ring', macro: 10037 },
      { label: 'No. of meas. points', macro: 10038 },
    ],
  },
  {
    title: 'Retract mode',
    fields: [
      { label: 'Mode', macro: 10070, kind: 'retract' },
      { label: 'Torque', macro: 10069 },
    ],
  },
  { title: 'Lap cycle used as test cycle', fields: [{ label: 'Number of passes', macro: 10209 }] },
  {
    title: 'Clamps release auto',
    fields: [
      { label: 'Pinion', macro: 10205, kind: 'flag' },
      { label: 'Ring', macro: 10206, kind: 'flag' },
    ],
  },
  {
    title: 'Nick detection',
    fields: [
      { label: 'Enabled', macro: 10207, kind: 'flag' },
      { label: 'Nick tolerance', macro: 10074 },
    ],
  },
  {
    title: 'Spin-off',
    fields: [
      { label: 'Pinion RPM', macro: 10066 },
      { label: 'Ring RPM', macro: 10067 },
      { label: 'Time', macro: 10068, unit: 's' },
    ],
  },
  {
    title: 'Acceleration / deceleration',
    fields: [
      { label: 'Lapping cycle', macro: 10084 },
      { label: 'Spin-off', macro: 10085 },
      { label: 'Ring gear torque', macro: 10097 },
    ],
  },
];

export const RETRACT_MODES: Record<number, string> = {
  0: 'Standing',
  1: 'Rotating counter flank',
  2: 'Rotating current flank',
};

// ---------- Mesh data (used_form = mesh) ----------
export const MESH_GROUPS: GroupDef[] = [
  {
    title: 'Arbor length',
    fields: [
      { label: 'H', macro: 10042 },
      { label: 'J', macro: 10043 },
    ],
  },
  {
    title: 'Meshing position',
    fields: [
      { label: 'V', macro: 10045 },
      { label: 'H', macro: 10046 },
      { label: 'J', macro: 10047 },
    ],
  },
  {
    title: 'Load position',
    fields: [
      { label: 'V', macro: 10049 },
      { label: 'H', macro: 10050 },
      { label: 'J', macro: 10051 },
    ],
  },
  {
    title: 'Correction start position',
    fields: [
      { label: 'V', macro: 10053 },
      { label: 'H', macro: 10054 },
      { label: 'J', macro: 10055 },
    ],
  },
  {
    title: 'Gear mounting tolerance (J)',
    fields: [
      { label: 'Lower', macro: 10039 },
      { label: 'Upper', macro: 10040 },
    ],
  },
];

// ---------- Lapping paths (used_form = coast | drive | tip_coast | …) ----------
export const PATH_FORMS = [
  { form: 'coast', label: 'Coast' },
  { form: 'drive', label: 'Drive' },
  { form: 'tip_coast', label: 'Tip · Coast' },
  { form: 'tip_drive', label: 'Tip · Drive' },
  { form: 'root_coast', label: 'Root · Coast' },
  { form: 'root_drive', label: 'Root · Drive' },
] as const;

export const PATH_ACTIVE_NAME = 'pass_active';

export const PATH_GROUPS: GroupDef[] = [
  {
    title: 'Pass',
    fields: [
      { label: 'Passes', name: 'passes' },
      { label: 'Backlash adj.', name: 'backlash_adj' },
    ],
  },
  {
    title: 'Heel',
    fields: [
      { label: 'Feed var', name: 'heel_feed_var' },
      { label: 'Time', name: 'heel_moving_time', unit: 's' },
      { label: 'Dwell', name: 'heel_dwell_time', unit: 's' },
      { label: 'RPM', name: 'heel_rpm' },
      { label: 'Torque', name: 'heel_torque' },
      { label: 'V', name: 'heel_v' },
      { label: 'H', name: 'heel_h' },
      { label: 'J', name: 'heel_j' },
    ],
  },
  {
    title: 'Set-over',
    fields: [
      { label: 'Dwell', name: 'so_dwell_time', unit: 's' },
      { label: 'RPM', name: 'so_rpm' },
      { label: 'Torque', name: 'so_torque' },
      { label: 'V', name: 'so_v' },
      { label: 'H', name: 'so_h' },
      { label: 'LAC H', name: 'lac_h' },
    ],
  },
  {
    title: 'Toe',
    fields: [
      { label: 'Feed var', name: 'toe_feed_var' },
      { label: 'Time', name: 'toe_moving_time', unit: 's' },
      { label: 'Dwell', name: 'toe_dwell_time', unit: 's' },
      { label: 'RPM', name: 'toe_rpm' },
      { label: 'Torque', name: 'toe_torque' },
      { label: 'V', name: 'toe_v' },
      { label: 'H', name: 'toe_h' },
      { label: 'J', name: 'toe_j' },
    ],
  },
];

/** Looks a field's value up in a set of rows, by macro number or by name. */
export function fieldValue(rows: LappingSummaryRow[], def: FieldDef): number | null {
  if (def.macro != null) return rows.find((r) => r.number === def.macro)?.value ?? null;
  if (def.name) return findByName(rows, def.name)?.value ?? null;
  return null;
}

/** Exact or suffix name match first, falling back to the legacy `includes` behaviour. */
export function findByName(rows: LappingSummaryRow[], key: string): LappingSummaryRow | undefined {
  const lower = key.toLowerCase();
  return (
    rows.find((r) => r.name?.toLowerCase() === lower) ??
    rows.find((r) => r.name?.toLowerCase().endsWith(`_${lower}`)) ??
    rows.find((r) => r.name?.toLowerCase().includes(lower))
  );
}

/** Fanuc convention: -1 (or 1) means ON. */
export function isOn(value: number | null | undefined): boolean {
  return value === -1 || value === 1;
}

export function groupByForm(rows: LappingSummaryRow[]): Map<string, LappingSummaryRow[]> {
  const map = new Map<string, LappingSummaryRow[]>();
  for (const r of rows) {
    const key = r.used_form ?? '';
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  return map;
}

/** Display name of a lapping-summary form group (`used_form`). */
export const FORM_LABELS: Record<string, string> = {
  gear_data: 'Gearset data',
  general_data: 'General data',
  mesh: 'Meshing position',
  ...Object.fromEntries(PATH_FORMS.map((p) => [p.form, `Path · ${p.label}`])),
};

/**
 * Where a macro appears on the lapping summary, e.g. "General data · Runout check · Enabled",
 * or null when no summary field reads it.
 */
export function summaryPlacement(macro: {
  number: number;
  name: string;
  used_form: string | null;
}): string | null {
  const form = macro.used_form ?? '';
  const byNumber = (groups: GroupDef[]) =>
    groups
      .flatMap((g) => g.fields.map((f) => ({ g, f })))
      .find(({ f }) => f.macro === macro.number);
  if (form === 'gear_data') {
    const f = GEARSET_FIELDS.find((x) => x.macro === macro.number);
    return f ? `${FORM_LABELS[form]} · ${f.label}` : null;
  }
  if (form === 'general_data') {
    if (macro.number === 10032) return `${FORM_LABELS[form]} · Consec (last cycle)`;
    const hit = byNumber(GENERAL_GROUPS);
    return hit ? `${FORM_LABELS[form]} · ${hit.g.title} · ${hit.f.label}` : null;
  }
  if (form === 'mesh') {
    const hit = byNumber(MESH_GROUPS);
    return hit ? `${FORM_LABELS[form]} · ${hit.g.title} · ${hit.f.label}` : null;
  }
  const path = PATH_FORMS.find((p) => p.form === form);
  if (!path) return null;
  const name = macro.name.toLowerCase();
  const matches = (key: string) => name === key || name.endsWith(`_${key}`);
  if (matches(PATH_ACTIVE_NAME)) return `${FORM_LABELS[form]} · Pass active`;
  for (const g of PATH_GROUPS) {
    const f = g.fields.find((x) => x.name && matches(x.name));
    if (f) return `${FORM_LABELS[form]} · ${g.title} · ${f.label}`;
  }
  return null;
}
