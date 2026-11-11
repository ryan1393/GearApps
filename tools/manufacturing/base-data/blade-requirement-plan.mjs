// Blade-requirement import rules. Pure functions, shared by the validator and the importer.
//
// Units: the database stores MATCHED INNER/OUTER BLADE SETS (a tray count of 13 is
// 13 inner + 13 outer = 26 blades). Approved rules are stated in TOTAL blades.
// Every source row must say which unit it uses; a number alone never decides it.
//   MATCHED_SETS  -> stored as given (the original workbook: 11/13/17/19)
//   TOTAL_BLADES  -> stored as total / 2 (Blade sheet cope.xlsx Sheet2: 22/26/34/38)
// Nothing is ever doubled, and re-running an import stores the same values.
//
// Keep APPROVED_BODY_RULES identical to CUTTER_BODY_RULES in
// libs/manufacturing/shared/util-constants/src/lib/cutter-body-compatibility.constants.ts
// (test-blade-requirement-plan.test.mjs checks this).

export const APPROVED_BODY_RULES = Object.freeze([
  { code: '064', total_blades: 22 },
  { code: '076', total_blades: 26 },
  { code: '088', total_blades: 34 },
  { code: '105', total_blades: 38 },
  { code: '105-SPECIAL', total_blades: 26 },
]);
export const BLADES_PER_MATCHED_SET = 2;
export const UNITS = Object.freeze(['MATCHED_SETS', 'TOTAL_BLADES']);
const APPROVED_SETS = new Set(APPROVED_BODY_RULES.map((r) => r.total_blades / BLADES_PER_MATCHED_SET));

const clean = (v) => (v == null ? '' : String(v).trim());
const BLANK_REVISION = '(blank)';

/** Revision key used by the importer: explicit revision, explicit blank, or every revision. */
export function requirementRevision(row) {
  const raw = clean(row.Summary_Rev);
  return raw.toLowerCase() === BLANK_REVISION ? { revision: '', explicit: true } : { revision: raw, explicit: raw !== '' };
}

/** Convert one row's quantity to stored matched sets, or explain why the row is not usable. */
export function rowBladeSets(row) {
  const raw = row.Blades_Required;
  if (raw == null || clean(raw) === '') return { skip: 'blank quantity (incomplete source row; existing requirement preserved)' };
  const value = Number(raw);
  if (value === 0) return { skip: 'zero quantity (incomplete source row; existing requirement preserved)' };
  const unit = clean(row.Blade_Quantity_Unit).toUpperCase();
  if (!UNITS.includes(unit)) {
    return { error: `Blade_Quantity_Unit must be ${UNITS.join(' or ')} (got "${clean(row.Blade_Quantity_Unit)}"); the unit is never inferred from the number` };
  }
  if (!Number.isInteger(value) || value < 0) return { error: `invalid Blades_Required ${raw}` };
  const sets = unit === 'TOTAL_BLADES' ? value / BLADES_PER_MATCHED_SET : value;
  if (!Number.isInteger(sets) || !APPROVED_SETS.has(sets)) {
    return { error: `${value} ${unit} is not an approved body-rule quantity (${APPROVED_BODY_RULES.map((r) => `${r.total_blades} blades = ${r.total_blades / 2} sets`).join(', ')})` };
  }
  return { sets };
}

/**
 * Group rows by Summary (+ revision key). Required quantity is Summary-based, so every
 * usable Part Type row of a Summary must agree. Blank/zero rows and Summaries whose rows
 * disagree are skipped and reported; they never overwrite or create a requirement.
 */
export function planBladeRequirements(rows) {
  const errors = [];
  const skipped = [];
  const groups = new Map();
  const seen = new Set();
  for (const row of rows) {
    const summary = clean(row.Summary);
    const partTypeCode = clean(row.Part_Type_Code).toUpperCase();
    if (!summary) { errors.push('Blade requirement has a blank Summary'); continue; }
    if (!['RING', 'PINION'].includes(partTypeCode)) { errors.push(`Summary ${summary}: invalid Part_Type_Code ${row.Part_Type_Code}`); continue; }
    const { revision, explicit } = requirementRevision(row);
    const key = `${summary}\u0000${revision}\u0000${explicit}`;
    const rowKey = `${key}\u0000${partTypeCode}`;
    if (seen.has(rowKey)) { errors.push(`Duplicate blade requirement: ${summary} ${partTypeCode}`); continue; }
    seen.add(rowKey);
    const quantity = rowBladeSets(row);
    if (quantity.error) { errors.push(`Summary ${summary} ${partTypeCode}: ${quantity.error}`); continue; }
    if (quantity.skip) { skipped.push({ summary, revision, partTypeCode, reason: quantity.skip }); continue; }
    const group = groups.get(key) ?? { summary, revision, explicit, rows: [] };
    group.rows.push({ partTypeCode, sets: quantity.sets });
    groups.set(key, group);
  }
  const planned = [];
  for (const group of groups.values()) {
    const quantities = [...new Set(group.rows.map((r) => r.sets))];
    if (quantities.length > 1) {
      skipped.push({ summary: group.summary, revision: group.revision, partTypeCode: '*', reason: `RING/PINION quantities disagree (${quantities.join(' vs ')} sets); left unchanged for review` });
      continue;
    }
    planned.push({ ...group, sets: quantities[0] });
  }
  return { planned, skipped, errors };
}

/** Body rule code a quantity identifies uniquely, or null (13 sets fits 076 and 105 Special). */
export function uniqueRuleForSets(sets) {
  const rules = APPROVED_BODY_RULES.filter((r) => r.total_blades / BLADES_PER_MATCHED_SET === sets);
  return rules.length === 1 ? rules[0].code : null;
}

export function setsForRule(code) {
  const rule = APPROVED_BODY_RULES.find((r) => r.code === code);
  return rule ? rule.total_blades / BLADES_PER_MATCHED_SET : null;
}

/**
 * Positional Dana S/N decode (mirror of decodeDanaCutterSerial in util-constants; the
 * parity test runs both). Dana S/N only; trim + upper-case; nothing is stripped.
 */
export function decodeDanaSerial(value) {
  const serial = clean(value).toUpperCase();
  if (!serial) return { valid: false, serial, reason: 'No Dana S/N is assigned' };
  if (!/^[A-Z0-9]+$/.test(serial)) return { valid: false, serial, reason: 'contains characters other than letters and digits' };
  if (serial.length < 8) return { valid: false, serial, reason: 'shorter than 8 characters' };
  if (!/^[A-Z]{4}$/.test(serial.slice(0, 4))) return { valid: false, serial, reason: 'must start with four letters' };
  const size = serial.slice(4, 7);
  if (!['064', '076', '088', '105'].includes(size)) return { valid: false, serial, reason: `unsupported body size "${size}"` };
  const rule = size === '105' && serial.charAt(7) === '8' ? '105-SPECIAL' : size;
  return { valid: true, serial, size_code: size, hand_code: serial.charAt(2), blade_family_code: serial.charAt(3), rule };
}

const SIZE_FOR_RULE = Object.freeze({ '064': '064', '076': '076', '088': '088', '105': '105', '105-SPECIAL': '105' });
const normalizeSize = (value) => {
  const text = clean(value).toUpperCase();
  return /^\d{1,3}$/.test(text) ? text.padStart(3, '0') : text;
};

/**
 * Body definitions a Summary + Part Type requirement with this rule may be loaded into
 * (mirror of permittedCutterBodyDefinitions in util-constants; the parity test runs both):
 * every enabled definition of the rule's size; hand, supplier and Tri-ac/Pent-ac family are
 * not restricted; a definition whose blade family is literally RING or PINION only takes
 * that Part Type.
 */
export function permittedDefinitionsForRule(ruleCode, partTypeCode, definitions) {
  const size = SIZE_FOR_RULE[ruleCode];
  if (!size) return [];
  const partType = clean(partTypeCode).toUpperCase();
  return definitions
    .filter((d) => d.enabled !== false && normalizeSize(d.size_code) === size)
    .filter((d) => { const family = clean(d.blade_family_name).toUpperCase(); return !['RING', 'PINION'].includes(family) || family === partType; })
    .map((d) => clean(d.definition_code).toUpperCase())
    .sort();
}

/** Summary rule state (mirror of summaryBodyRuleState): CONFIGURED, DERIVED, UNRESOLVED, CONFLICT or NO_REQUIREMENT. */
export function summaryRuleState(configured, quantities) {
  const approvedCodes = APPROVED_BODY_RULES.map((r) => r.code);
  if (configured && !approvedCodes.includes(configured)) return { status: 'CONFLICT', rule: null, detail: `configured rule ${configured} is not approved` };
  const unique = [...new Set(quantities.filter((v) => Number.isInteger(v)))];
  if (unique.length > 1) return { status: 'CONFLICT', rule: null, detail: `Part Types disagree: ${unique.join(' vs ')} sets` };
  const sets = unique[0];
  if (configured) {
    return sets === undefined || setsForRule(configured) === sets
      ? { status: 'CONFIGURED', rule: configured, detail: `configured ${configured}` }
      : { status: 'CONFLICT', rule: null, detail: `rule ${configured} needs ${setsForRule(configured)} sets; requirement is ${sets}` };
  }
  if (sets === undefined) return { status: 'NO_REQUIREMENT', rule: null, detail: 'no blade requirement' };
  if (!APPROVED_SETS.has(sets)) return { status: 'CONFLICT', rule: null, detail: `${sets} sets is not an approved quantity` };
  const rule = uniqueRuleForSets(sets);
  return rule
    ? { status: 'DERIVED', rule, detail: `only rule for ${sets} sets / ${sets * BLADES_PER_MATCHED_SET} blades` }
    : { status: 'UNRESOLVED', rule: null, detail: `${sets} sets / ${sets * BLADES_PER_MATCHED_SET} blades fits 076 Standard or 105 Special; set the Body Size Rule` };
}

const EVIDENCE = { CONFIGURED: 'CONFIGURED', DERIVED: 'SUPPORTED', UNRESOLVED: 'UNRESOLVED', CONFLICT: 'CONFLICTING' };

/**
 * Summary + Part Type → permitted body definitions (mirror of buildCutterBodyCompatibilityMatrix).
 * summaries: [{ summary, revision, model, hos, enabled, body_rule, requirements: [{ part_type, sets, enabled }] }]
 */
export function buildBodyMatrix(summaries, definitions) {
  const rows = [];
  for (const s of summaries) {
    const state = summaryRuleState(s.body_rule ?? null, s.requirements.map((q) => Number(q.sets)));
    for (const q of s.requirements) {
      const disabled = s.enabled === false ? 'Summary is disabled' : q.enabled === false ? 'Blade requirement is disabled' : null;
      const rule = state.status === 'CONFIGURED' || state.status === 'DERIVED' ? state.rule : null;
      const permitted = disabled ? [] : permittedDefinitionsForRule(rule, q.part_type, definitions);
      rows.push({
        summary: s.summary, revision: s.revision ?? '', model: s.model ?? null, hos: s.hos ?? null,
        part_type: clean(q.part_type).toUpperCase(), sets: Number(q.sets), total_blades: Number(q.sets) * BLADES_PER_MATCHED_SET,
        body_rule: rule, permitted,
        evidence: disabled ? 'DISABLED' : rule && !permitted.length ? 'UNRESOLVED' : EVIDENCE[state.status],
        detail: disabled ?? (rule && !permitted.length ? `no enabled body definition of size ${SIZE_FOR_RULE[rule]}` : state.detail),
      });
    }
  }
  return rows;
}
