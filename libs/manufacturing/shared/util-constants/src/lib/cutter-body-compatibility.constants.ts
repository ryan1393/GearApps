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
  cutter_head_code?: string | null;
  supplier_code?: string | null;
  hand_code?: string | null;
  blade_family_code?: string | null;
  blade_family_name?: string | null;
  size_code?: string | null;
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
}

/** Digits-only sizes keep their leading zeros ("76" → "076"); anything else is compared as written. */
const normalizeSizeCode = (value: string | null | undefined): string => {
  const text = String(value ?? '').trim().toUpperCase();
  return /^\d{1,3}$/.test(text) ? text.padStart(3, '0') : text;
};

/** Resolve a physical body's rule from its Dana S/N, cross-checked against its linked definition. */
export function resolveCutterBodyRule(body: BladeCapacityBody | null | undefined): CutterBodyRuleResolution {
  if (!body) return { rule: null, decoded: null, problem: 'No cutter body selected' };
  const decoded = decodeDanaCutterSerial(body.dana_serial_number);
  if (!decoded.valid) return { rule: null, decoded: null, problem: decoded.reason };
  const definition = body.definition;
  if (definition) {
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
        return { rule: null, decoded, problem: `Dana S/N ${decoded.serial} ${name} "${fromSerial}" conflicts with its body definition "${expected}"` };
      }
    }
  }
  return { rule: decoded.rule, decoded, problem: null };
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
 * Handedness is deliberately not checked here: it belongs to Summary + Part Type.
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
  const family = body?.definition?.blade_family_name?.trim().toUpperCase();
  const partType = String(partTypeCode ?? '').trim().toUpperCase();
  if (family && ['RING', 'PINION'].includes(family) && family !== partType) {
    return fail(`Cutter body blade family ${family} does not match Part Type ${partType || 'blank'}`, bodyRule, summaryRule);
  }
  if (summaryRule) {
    return bodyRule.code === summaryRule.code
      ? { compatible: true, reason: null, warning: null, body_rule: bodyRule, summary_rule: summaryRule }
      : fail(`This Summary uses ${summaryRule.label}; cutter body ${resolution.decoded?.serial} is ${bodyRule.label}`, bodyRule, summaryRule);
  }
  if (!requirementRules.some((r) => r.code === bodyRule.code)) {
    return fail(`Cutter body ${resolution.decoded?.serial} is ${bodyRule.label} (${formatBladeSetQuantity(bodyRule.blade_sets)}); the requirement is ${formatBladeSetQuantity(requiredSets)}`, bodyRule, null);
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
