/**
 * Cutter-body blade rules: the one authority shared by the API (Cutter Builder
 * validation, inventory, Admin) and the browser apps.
 *
 * Units — read this before changing a number:
 * - The approved rules are stated in TOTAL individual blades (22/26/34/38/26).
 * - `cutter_blade_requirements.required_blade_count`, tray `blade_count` /
 *   `required_blade_count` and coater container sets count MATCHED INNER/OUTER
 *   BLADE SETS. A tray count of 13 is 13 inner + 13 outer = 26 blades (see
 *   docs/manufacturing/COATER_RPA.md). One set is therefore two blades.
 * - So a rule's stored quantity is `total_blades / 2`. Never double a stored
 *   quantity, and never convert physical tray, grinder or history counts.
 */
export const BLADES_PER_MATCHED_SET = 2;

export type CutterBodyRuleCode = '064' | '076' | '088' | '105' | '105-SPECIAL';
export type CutterBodyVariant = 'STANDARD' | 'SPECIAL';

export interface CutterBodyRule {
  code: CutterBodyRuleCode;
  /** Three-character body size, leading zeros preserved ("064", not "64"). */
  size_code: string;
  variant: CutterBodyVariant;
  label: string;
  /** Approved requirement in total individual blades. */
  total_blades: number;
  /** The same requirement in matched inner/outer sets (stored unit). */
  blade_sets: number;
}

const rule = (code: CutterBodyRuleCode, size_code: string, variant: CutterBodyVariant, label: string, total_blades: number): CutterBodyRule =>
  Object.freeze({ code, size_code, variant, label, total_blades, blade_sets: total_blades / BLADES_PER_MATCHED_SET });

/** Approved cutter-body rules (total individual blades). */
export const CUTTER_BODY_RULES: readonly CutterBodyRule[] = Object.freeze([
  rule('064', '064', 'STANDARD', '064 Standard', 22),
  rule('076', '076', 'STANDARD', '076 Standard', 26),
  rule('088', '088', 'STANDARD', '088 Standard', 34),
  rule('105', '105', 'STANDARD', '105 Standard', 38),
  rule('105-SPECIAL', '105', 'SPECIAL', '105 Special (8th Dana S/N character 8)', 26),
]);

export const CUTTER_BODY_SIZE_CODES: readonly string[] = Object.freeze(['064', '076', '088', '105']);

/** Zero-based index of the 8th Dana S/N character (the special 105 marker). */
export const DANA_SERIAL_SPECIAL_INDEX = 7;
export const DANA_SERIAL_SPECIAL_105_CHARACTER = '8';

export function cutterBodyRuleByCode(code: string | null | undefined): CutterBodyRule | null {
  const wanted = String(code ?? '').trim().toUpperCase();
  return CUTTER_BODY_RULES.find((r) => r.code === wanted) ?? null;
}

/** Rules whose stored matched-set quantity equals `sets`. 13 sets matches both 076 and 105 Special. */
export function cutterBodyRulesForBladeSets(sets: number | null | undefined): CutterBodyRule[] {
  return Number.isInteger(sets) ? CUTTER_BODY_RULES.filter((r) => r.blade_sets === sets) : [];
}

/** True when `sets` is a quantity some approved body rule requires. */
export function isApprovedBladeSetCount(sets: number | null | undefined): boolean {
  return cutterBodyRulesForBladeSets(sets).length > 0;
}

export function totalBladesForSets(sets: number | null | undefined): number | null {
  return Number.isInteger(sets) && Number(sets) > 0 ? Number(sets) * BLADES_PER_MATCHED_SET : null;
}

/** "19 sets · 38 blades" — both units, always labelled. */
export function formatBladeSetQuantity(sets: number | null | undefined): string {
  const total = totalBladesForSets(sets);
  return total === null ? 'Unknown' : `${sets} ${sets === 1 ? 'set' : 'sets'} · ${total} blades`;
}

/** Normalization matches the server's stored Dana S/N: trim + upper-case. Nothing is removed. */
export function normalizeDanaSerial(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

export interface DecodedDanaSerial {
  valid: true;
  serial: string;
  cutter_head_code: string;
  supplier_code: string;
  hand_code: string;
  blade_family_code: string;
  size_code: string;
  special_character: string;
  rule: CutterBodyRule;
}
export interface InvalidDanaSerial { valid: false; serial: string; reason: string }
export type DanaSerialDecode = DecodedDanaSerial | InvalidDanaSerial;

/**
 * Positional decode of the Dana S/N (never the MF serial):
 * 1 cutter head, 2 supplier, 3 hand, 4 blade family, 5–7 body size, 8 special rule.
 * Characters are never stripped, so positions cannot shift; a serial with
 * punctuation, too few characters or an unsupported size is unresolved.
 */
export function decodeDanaCutterSerial(value: string | null | undefined): DanaSerialDecode {
  const serial = normalizeDanaSerial(value);
  const invalid = (reason: string): InvalidDanaSerial => ({ valid: false, serial, reason });
  if (!serial) return invalid('No Dana S/N is assigned');
  if (!/^[A-Z0-9]+$/.test(serial)) return invalid(`Dana S/N ${serial} contains characters other than letters and digits`);
  if (serial.length < DANA_SERIAL_SPECIAL_INDEX + 1) return invalid(`Dana S/N ${serial} is shorter than 8 characters`);
  if (!/^[A-Z]{4}$/.test(serial.slice(0, 4))) return invalid(`Dana S/N ${serial} must start with four letters (head, supplier, hand, blade family)`);
  const size_code = serial.slice(4, 7);
  if (!CUTTER_BODY_SIZE_CODES.includes(size_code)) return invalid(`Dana S/N ${serial} has unsupported body size "${size_code}" in characters 5–7`);
  const special_character = serial.charAt(DANA_SERIAL_SPECIAL_INDEX);
  const special = size_code === '105' && special_character === DANA_SERIAL_SPECIAL_105_CHARACTER;
  const decodedRule = cutterBodyRuleByCode(special ? '105-SPECIAL' : size_code) as CutterBodyRule;
  return {
    valid: true, serial,
    cutter_head_code: serial.charAt(0), supplier_code: serial.charAt(1), hand_code: serial.charAt(2), blade_family_code: serial.charAt(3),
    size_code, special_character, rule: decodedRule,
  };
}

export interface CutterBodyDefinitionCodes {
  id?: string | null;
  definition_code?: string | null;
  cutter_head_code?: string | null;
  supplier_code?: string | null;
  hand_code?: string | null;
  blade_family_code?: string | null;
  blade_family_name?: string | null;
  size_code?: string | null;
  /** A disabled definition is a body type that may not be loaded; false only when explicitly disabled. */
  enabled?: boolean | null;
}
export interface BladeCapacityBody {
  dana_serial_number?: string | null;
  /** Accepted for convenience but never used for decoding: an 8 in the MF serial means nothing. */
  mf_serial_number?: string | null;
  definition?: CutterBodyDefinitionCodes | null;
}

export interface CutterBodyRuleResolution {
  rule: CutterBodyRule | null;
  decoded: DecodedDanaSerial | null;
  problem: string | null;
  /**
   * Where the rule came from: the Dana S/N, or (only for an unetched body that has no
   * Dana S/N at all) its explicitly linked body definition. Null when unresolved.
   */
  source: 'DANA_SERIAL' | 'DEFINITION' | null;
}

/** Digits-only sizes keep their leading zeros ("76" → "076"); anything else is compared as written. */
const normalizeSizeCode = (value: string | null | undefined): string => {
  const text = String(value ?? '').trim().toUpperCase();
  return /^\d{1,3}$/.test(text) ? text.padStart(3, '0') : text;
};

/** Definition code for messages: "CGRT076", or the size when no code is loaded. */
const definitionName = (definition: CutterBodyDefinitionCodes): string =>
  String(definition.definition_code ?? '').trim().toUpperCase() || `size ${normalizeSizeCode(definition.size_code) || 'unknown'}`;

/**
 * The problem with a Dana S/N against a linked definition, or null when it fits.
 * Used to resolve a body and to refuse a bad Dana S/N when it is entered.
 */
export function danaSerialDefinitionConflict(decoded: DecodedDanaSerial, definition: CutterBodyDefinitionCodes | null | undefined): string | null {
  if (!definition) return null;
  const checks: Array<[string, string, string | null | undefined]> = [
    ['body size', decoded.size_code, definition.size_code == null ? null : normalizeSizeCode(definition.size_code)],
    ['hand', decoded.hand_code, definition.hand_code],
    ['blade family', decoded.blade_family_code, definition.blade_family_code],
    ['supplier', decoded.supplier_code, definition.supplier_code],
    ['cutter head', decoded.cutter_head_code, definition.cutter_head_code],
  ];
  for (const [name, fromSerial, fromDefinition] of checks) {
    const expected = String(fromDefinition ?? '').trim().toUpperCase();
    if (expected && expected !== fromSerial) {
      return `Dana S/N ${decoded.serial} ${name} "${fromSerial}" conflicts with its body definition "${expected}"`;
    }
  }
  return null;
}

/**
 * Resolve a physical body's rule.
 * - Etched body: from the Dana S/N by position, cross-checked against its linked definition.
 *   A malformed or conflicting Dana S/N is unresolved; it never falls back to the definition.
 * - Unetched body (no Dana S/N at all, MF S/N only): from its explicitly linked definition,
 *   except a 105 definition, whose Standard/Special variant is only known from the 8th
 *   Dana S/N character. The MF serial is never decoded.
 */
export function resolveCutterBodyRule(body: BladeCapacityBody | null | undefined): CutterBodyRuleResolution {
  const unresolved = (problem: string, decoded: DecodedDanaSerial | null = null): CutterBodyRuleResolution =>
    ({ rule: null, decoded, problem, source: null });
  if (!body) return unresolved('No cutter body selected');
  const definition = body.definition ?? null;
  if (!normalizeDanaSerial(body.dana_serial_number)) {
    if (!definition) return unresolved('No Dana S/N is assigned and no body definition is linked');
    const size = normalizeSizeCode(definition.size_code);
    if (!CUTTER_BODY_SIZE_CODES.includes(size)) {
      return unresolved(`No Dana S/N is assigned and body definition ${definitionName(definition)} has no supported body size`);
    }
    if (size === '105') {
      return unresolved(`No Dana S/N is assigned: body definition ${definitionName(definition)} is a 105 body, and 105 Standard (38 blades) or 105 Special (26 blades) is read only from the 8th Dana S/N character. Assign the Dana S/N in Admin > Cutter Bodies.`);
    }
    return { rule: cutterBodyRuleByCode(size), decoded: null, problem: null, source: 'DEFINITION' };
  }
  const decoded = decodeDanaCutterSerial(body.dana_serial_number);
  if (!decoded.valid) return unresolved(decoded.reason);
  const conflict = danaSerialDefinitionConflict(decoded, definition);
  if (conflict) return unresolved(conflict, decoded);
  return { rule: decoded.rule, decoded, problem: null, source: 'DANA_SERIAL' };
}

/**
 * Check a Dana S/N an administrator is entering. Blank is allowed (an unetched body);
 * anything else must decode and fit the linked definition. Returns the problem or null.
 */
export function danaSerialEntryProblem(value: string | null | undefined, definition: CutterBodyDefinitionCodes | null | undefined): string | null {
  if (!normalizeDanaSerial(value)) return null;
  const decoded = decodeDanaCutterSerial(value);
  if (!decoded.valid) return `${decoded.reason}. A Dana S/N is 4 letters (head, supplier, hand, blade family), a body size of 064/076/088/105 and the rest of the mark, e.g. CGRT076AAA.`;
  return danaSerialDefinitionConflict(decoded, definition);
}

/** Stored-unit capacity (matched sets) of a physical body, or null when unresolved. */
export function cutterBodyBladeSets(body: BladeCapacityBody | null | undefined): number | null {
  return resolveCutterBodyRule(body).rule?.blade_sets ?? null;
}

/** Capacity in total individual blades, or null when unresolved. */
export function cutterBodyTotalBlades(body: BladeCapacityBody | null | undefined): number | null {
  return resolveCutterBodyRule(body).rule?.total_blades ?? null;
}

/** @deprecated Matched-set capacity; kept for existing callers. Use cutterBodyBladeSets. */
export const cutterBodyBladeCapacity = cutterBodyBladeSets;

export interface CutterBodyCompatibility {
  compatible: boolean;
  /** Why the body cannot be used. */
  reason: string | null;
  /** Reserved for advisories that do not block; unresolved rules now block. */
  warning: string | null;
  body_rule: CutterBodyRule | null;
  summary_rule: CutterBodyRule | null;
}

/**
 * Can this physical body take a tray for this Summary + Part Type requirement?
 * - The requirement quantity must be an approved rule quantity.
 * - A configured Summary Body Size Rule is matched exactly; equal quantities
 *   do not make 076 Standard and 105 Special interchangeable.
 * - Without a configured rule, the quantity identifies the rule when it is
 *   unique; 13 sets / 26 blades is ambiguous and is refused until the
 *   Summary's Body Size Rule is set.
 * - A body whose linked definition is disabled is not a permitted type.
 * Handedness, supplier and Tri-ac/Pent-ac family are deliberately not restrictions: no
 * approved rule ties them to a Summary or Part Type (they are only cross-checked between
 * a body's Dana S/N and its own definition).
 */
export function evaluateCutterBodyCompatibility(
  body: BladeCapacityBody | null | undefined,
  requiredSets: number | null | undefined,
  partTypeCode: string | null | undefined,
  summaryRuleCode?: string | null,
): CutterBodyCompatibility {
  const fail = (reason: string, body_rule: CutterBodyRule | null = null, summary_rule: CutterBodyRule | null = null): CutterBodyCompatibility =>
    ({ compatible: false, reason, warning: null, body_rule, summary_rule });
  const summaryRule = summaryRuleCode ? cutterBodyRuleByCode(summaryRuleCode) : null;
  if (summaryRuleCode && !summaryRule) return fail(`Summary body rule "${summaryRuleCode}" is not an approved rule`);
  const requirementRules = cutterBodyRulesForBladeSets(requiredSets);
  if (!requirementRules.length) {
    return fail(`Required quantity ${requiredSets ?? 'blank'} does not match any approved body rule (expected matched sets ${CUTTER_BODY_RULES.map((r) => r.blade_sets).filter((v, i, a) => a.indexOf(v) === i).join('/')})`, null, summaryRule);
  }
  if (summaryRule && summaryRule.blade_sets !== requiredSets) {
    return fail(`Summary body rule ${summaryRule.label} requires ${formatBladeSetQuantity(summaryRule.blade_sets)} but the requirement is ${formatBladeSetQuantity(requiredSets)}`, null, summaryRule);
  }
  const resolution = resolveCutterBodyRule(body);
  if (!resolution.rule) return fail(`Cutter body rule is unresolved: ${resolution.problem}`, null, summaryRule);
  const bodyRule = resolution.rule;
  const bodyName = resolution.decoded?.serial ?? (body?.mf_serial_number ? `MF ${normalizeDanaSerial(body.mf_serial_number)}` : 'this body');
  if (body?.definition && body.definition.enabled === false) {
    return fail(`Cutter body type ${definitionName(body.definition)} is disabled in Admin; ${bodyName} cannot be loaded`, bodyRule, summaryRule);
  }
  const family = body?.definition?.blade_family_name?.trim().toUpperCase();
  const partType = String(partTypeCode ?? '').trim().toUpperCase();
  if (family && ['RING', 'PINION'].includes(family) && family !== partType) {
    return fail(`Cutter body blade family ${family} does not match Part Type ${partType || 'blank'}`, bodyRule, summaryRule);
  }
  if (summaryRule) {
    return bodyRule.code === summaryRule.code
      ? { compatible: true, reason: null, warning: null, body_rule: bodyRule, summary_rule: summaryRule }
      : fail(`This Summary uses ${summaryRule.label}; cutter body ${bodyName} is ${bodyRule.label}`, bodyRule, summaryRule);
  }
  if (!requirementRules.some((r) => r.code === bodyRule.code)) {
    return fail(`Cutter body ${bodyName} is ${bodyRule.label} (${formatBladeSetQuantity(bodyRule.blade_sets)}); the requirement is ${formatBladeSetQuantity(requiredSets)}`, bodyRule, null);
  }
  if (requirementRules.length > 1) {
    // 26 blades fits 076 Standard and 105 Special: the quantity alone never picks the body.
    return fail(`This Summary's Body Size Rule is not set: ${formatBladeSetQuantity(requiredSets)} fits ${requirementRules.map((r) => r.label).join(' or ')}. Set the rule in Admin > Part Summaries before building.`, bodyRule, null);
  }
  return { compatible: true, reason: null, warning: null, body_rule: bodyRule, summary_rule: null };
}

export function cutterBodyMatchesRequirement(
  body: BladeCapacityBody | null | undefined,
  requiredSets: number | null | undefined,
  partTypeCode: string | null | undefined,
  summaryRuleCode?: string | null,
): boolean {
  return evaluateCutterBodyCompatibility(body, requiredSets, partTypeCode, summaryRuleCode).compatible;
}

export type SummaryBodyRuleStatus = 'CONFIGURED' | 'DERIVED' | 'UNRESOLVED' | 'CONFLICT' | 'NO_REQUIREMENT';

export interface SummaryBodyRuleState {
  status: SummaryBodyRuleStatus;
  /** Configured rule, or the rule the quantity uniquely identifies. */
  effective_rule: CutterBodyRule | null;
  /** The Summary's shared required quantity in matched sets, when RING/PINION agree. */
  blade_sets: number | null;
  detail: string;
}

/**
 * Required blade quantity is Summary-based: every enabled Part Type row of the
 * Summary must carry the same quantity, and a configured rule controls it.
 */
export function summaryBodyRuleState(configuredRuleCode: string | null | undefined, requirementSets: Array<number | null | undefined>): SummaryBodyRuleState {
  const configured = configuredRuleCode ? cutterBodyRuleByCode(configuredRuleCode) : null;
  const quantities = [...new Set(requirementSets.filter((v): v is number => Number.isInteger(v)))];
  if (configuredRuleCode && !configured) return { status: 'CONFLICT', effective_rule: null, blade_sets: null, detail: `Configured rule "${configuredRuleCode}" is not approved` };
  if (quantities.length > 1) return { status: 'CONFLICT', effective_rule: configured, blade_sets: null, detail: `Part Type requirements disagree (${quantities.join(' vs ')} sets)` };
  const sets = quantities[0] ?? null;
  if (configured) {
    if (sets !== null && sets !== configured.blade_sets) {
      return { status: 'CONFLICT', effective_rule: configured, blade_sets: sets, detail: `${configured.label} requires ${formatBladeSetQuantity(configured.blade_sets)}; requirement is ${formatBladeSetQuantity(sets)}` };
    }
    return { status: 'CONFIGURED', effective_rule: configured, blade_sets: sets ?? configured.blade_sets, detail: configured.label };
  }
  if (sets === null) return { status: 'NO_REQUIREMENT', effective_rule: null, blade_sets: null, detail: 'No blade requirement' };
  const candidates = cutterBodyRulesForBladeSets(sets);
  if (candidates.length === 1) return { status: 'DERIVED', effective_rule: candidates[0], blade_sets: sets, detail: candidates[0].label };
  if (!candidates.length) return { status: 'CONFLICT', effective_rule: null, blade_sets: sets, detail: `${sets} sets is not an approved rule quantity` };
  return { status: 'UNRESOLVED', effective_rule: null, blade_sets: sets, detail: `${formatBladeSetQuantity(sets)} fits ${candidates.map((r) => r.label).join(' or ')}` };
}

/** A cutter-body definition (body type) a Summary + Part Type requirement may be loaded into. */
export interface PermittedCutterBodyDefinition {
  definition_id: string | null;
  definition_code: string;
  hand_code: string | null;
  blade_family_code: string | null;
  size_code: string;
  body_rule: CutterBodyRuleCode;
  /** Per-body condition that still applies, e.g. the 8th Dana S/N character for 105 bodies. */
  condition: string | null;
}

/** Physical-body condition a definition of this size still needs for the rule, or null. */
function bodyConditionForRule(rule: CutterBodyRule): string | null {
  if (rule.code === '105') return 'Dana S/N 8th character is not 8 (an unetched 105 body cannot be confirmed)';
  if (rule.code === '105-SPECIAL') return 'Dana S/N 8th character is 8 (an unetched 105 body cannot be confirmed)';
  return null;
}

/**
 * Body definitions that blades for this rule and Part Type can be loaded into: every
 * enabled definition of the rule's body size. Hand, supplier and Tri-ac/Pent-ac family are
 * not restricted (no approved rule ties them to a Summary or Part Type). The one legacy
 * check kept is a definition whose blade family is literally named RING or PINION, which
 * only takes that Part Type, exactly as evaluateCutterBodyCompatibility does.
 */
export function permittedCutterBodyDefinitions(
  rule: CutterBodyRule | null | undefined,
  partTypeCode: string | null | undefined,
  definitions: readonly CutterBodyDefinitionCodes[],
): PermittedCutterBodyDefinition[] {
  if (!rule) return [];
  const partType = String(partTypeCode ?? '').trim().toUpperCase();
  return definitions
    .filter((d) => d.enabled !== false && normalizeSizeCode(d.size_code) === rule.size_code)
    .filter((d) => {
      const family = String(d.blade_family_name ?? '').trim().toUpperCase();
      return !['RING', 'PINION'].includes(family) || family === partType;
    })
    .map((d) => ({
      definition_id: d.id ?? null,
      definition_code: String(d.definition_code ?? '').trim().toUpperCase() || definitionName(d),
      hand_code: d.hand_code?.trim().toUpperCase() || null,
      blade_family_code: d.blade_family_code?.trim().toUpperCase() || null,
      size_code: rule.size_code,
      body_rule: rule.code,
      condition: bodyConditionForRule(rule),
    }))
    .sort((a, b) => a.definition_code.localeCompare(b.definition_code));
}

export type CutterBodyMatrixEvidence = 'CONFIGURED' | 'SUPPORTED' | 'UNRESOLVED' | 'CONFLICTING' | 'DISABLED';

export interface CutterBodyMatrixSummaryInput {
  summary_id: string;
  summary_number: string;
  summary_revision: string | null;
  summary_enabled?: boolean;
  model_number?: string | null;
  /** Summary-level Hand of Spiral (part_summaries.hos). There is no per-Part-Type HOS column. */
  hos?: string | null;
  configured_body_rule: string | null;
  requirements: Array<{
    part_type_code: string; required_blade_count: number; enabled: boolean;
    /** HOS / blades of this Summary + Part Type; informational, never a body restriction. */
    part_type_hos?: string | null; inner_blade?: string | null; outer_blade?: string | null;
  }>;
}

/** One row of "for this Summary and Part Type, which body definitions can these blades go into?". */
export interface CutterBodyMatrixRow {
  summary_id: string;
  summary_number: string;
  summary_revision: string | null;
  model_number: string | null;
  hos: string | null;
  part_type_code: string;
  /** HOS, Inner blade and Outer blade of this Summary + Part Type (blank when not set). */
  part_type_hos: string | null;
  inner_blade: string | null;
  outer_blade: string | null;
  required_blade_sets: number;
  required_total_blades: number | null;
  body_rule: CutterBodyRuleCode | null;
  body_rule_label: string | null;
  body_rule_source: 'CONFIGURED' | 'QUANTITY' | null;
  permitted_definitions: PermittedCutterBodyDefinition[];
  evidence: CutterBodyMatrixEvidence;
  detail: string;
}

/**
 * The Summary + Part Type → permitted body-definition matrix, from the same rules the
 * Cutter Builder build, tray validation and availability use. Unresolved and conflicting
 * rows permit nothing and say why; nothing is guessed from a quantity.
 */
export function buildCutterBodyCompatibilityMatrix(
  summaries: readonly CutterBodyMatrixSummaryInput[],
  definitions: readonly CutterBodyDefinitionCodes[],
): CutterBodyMatrixRow[] {
  const rows: CutterBodyMatrixRow[] = [];
  for (const summary of summaries) {
    const state = summaryBodyRuleState(summary.configured_body_rule, summary.requirements.map((r) => Number(r.required_blade_count)));
    for (const requirement of summary.requirements) {
      const sets = Number(requirement.required_blade_count);
      const base = {
        summary_id: summary.summary_id, summary_number: summary.summary_number, summary_revision: summary.summary_revision,
        model_number: summary.model_number ?? null, hos: summary.hos ?? null,
        part_type_code: String(requirement.part_type_code ?? '').trim().toUpperCase(),
        part_type_hos: requirement.part_type_hos ?? null,
        inner_blade: requirement.inner_blade ?? null,
        outer_blade: requirement.outer_blade ?? null,
        required_blade_sets: sets, required_total_blades: totalBladesForSets(sets),
      };
      const disabled = summary.summary_enabled === false ? 'Summary is disabled' : !requirement.enabled ? 'Blade requirement is disabled' : null;
      const rule = state.status === 'CONFIGURED' || state.status === 'DERIVED' ? state.effective_rule : null;
      const permitted = disabled ? [] : permittedCutterBodyDefinitions(rule, base.part_type_code, definitions);
      const evidence: CutterBodyMatrixEvidence = disabled ? 'DISABLED'
        : state.status === 'CONFIGURED' ? 'CONFIGURED'
          : state.status === 'DERIVED' ? 'SUPPORTED'
            : state.status === 'UNRESOLVED' ? 'UNRESOLVED' : 'CONFLICTING';
      const detail = disabled ?? (rule && !permitted.length
        ? `${rule.label}: no enabled body definition of size ${rule.size_code}`
        : state.status === 'CONFIGURED' ? `Configured Body Size Rule ${state.detail}`
          : state.status === 'DERIVED' ? `${state.detail}: the only rule for ${formatBladeSetQuantity(sets)}`
            : state.status === 'UNRESOLVED' ? `${state.detail}; set the Body Size Rule in Admin > Part Summaries`
              : state.detail);
      rows.push({
        ...base,
        body_rule: rule?.code ?? null,
        body_rule_label: rule?.label ?? null,
        body_rule_source: state.status === 'CONFIGURED' ? 'CONFIGURED' : state.status === 'DERIVED' ? 'QUANTITY' : null,
        permitted_definitions: permitted,
        evidence: rule && !permitted.length && !disabled ? 'UNRESOLVED' : evidence,
        detail,
      });
    }
  }
  return rows;
}
