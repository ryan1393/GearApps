// Read-only audit of cutter-body blade rules against the CURRENT database.
//
//   node tools/manufacturing/base-data/audit-cutter-blade-rules.mjs            (report only)
//   node tools/manufacturing/base-data/audit-cutter-blade-rules.mjs --matrix   (also print every Summary + Part Type row)
//   node tools/manufacturing/base-data/audit-cutter-blade-rules.mjs --json     (machine-readable)
//   node tools/manufacturing/base-data/audit-cutter-blade-rules.mjs --apply-proposed-special-105
//
// The report changes nothing. It lists requirement quantities, RING/PINION disagreements,
// Summary Body Size Rule states, cutter bodies whose Dana S/N is missing, malformed or
// conflicts with their definition, and trays whose post-grind snapshot differs from the
// current requirement. Quantities are matched sets; totals are shown beside them.
// It also builds the Summary + Part Type → permitted cutter-body definition matrix with the
// same rules as GET /api/v1/cutter-config/body-compatibility (unresolved rows permit nothing).
//
// --apply-proposed-special-105 is the only write. It sets Body Size Rule 105-SPECIAL for
// the four Summaries the October 2 workbook review proposed (30131, 30132, 30133, 30136),
// one Summary at a time, only when ALL of these hold:
//   * the Summary exists and its model is 286 (workbook model 80, coarse pitch);
//   * it has at least one requirement row and every row is 13 sets (26 blades);
//   * it has no configured Body Size Rule yet (an existing rule, even a different one,
//     is reported as a conflict and left alone).
// Those mappings are workbook inferences, not physical serial checks: run it only if you
// accept them. It inserts rule rows only, changes no quantity, and is safe to repeat.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { APPROVED_BODY_RULES, BLADES_PER_MATCHED_SET, buildBodyMatrix, decodeDanaSerial, setsForRule, uniqueRuleForSets } from './blade-requirement-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const printMatrix = args.has('--matrix');
const applySpecial105 = args.has('--apply-proposed-special-105');
export const PROPOSED_SPECIAL_105 = Object.freeze(['30131', '30132', '30133', '30136']);
const WATCHED = ['30131', '30132', '30133', '30136', '30538', '30588', '32209', '32414'];

function loadDotEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.indexOf('=') < 1) continue;
    const eq = line.indexOf('=');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const blades = (sets) => (Number.isInteger(sets) ? `${sets} sets / ${sets * BLADES_PER_MATCHED_SET} blades` : 'none');

function summaryState(configured, quantities) {
  const unique = [...new Set(quantities)];
  if (unique.length > 1) return { status: 'CONFLICT', detail: `Part Types disagree: ${unique.join(' vs ')} sets` };
  const sets = unique[0];
  if (configured) {
    return setsForRule(configured) === sets || sets === undefined
      ? { status: 'CONFIGURED', rule: configured }
      : { status: 'CONFLICT', detail: `rule ${configured} needs ${setsForRule(configured)} sets; requirement is ${sets}` };
  }
  if (sets === undefined) return { status: 'NO_REQUIREMENT' };
  if (!APPROVED_BODY_RULES.some((r) => r.total_blades / BLADES_PER_MATCHED_SET === sets)) return { status: 'CONFLICT', detail: `${sets} sets is not an approved quantity` };
  const rule = uniqueRuleForSets(sets);
  return rule ? { status: 'DERIVED', rule } : { status: 'UNRESOLVED', detail: `${blades(sets)} fits 076 Standard or 105 Special; Cutter Builder is blocked until the rule is set` };
}

const sizeOf = (v) => { const t = String(v ?? '').trim().toUpperCase(); return /^\d{1,3}$/.test(t) ? t.padStart(3, '0') : t; };

// Same resolution as resolveCutterBodyRule: Dana S/N by position, cross-checked with the definition;
// an unetched body (no Dana S/N) uses its linked 064/076/088 definition; a 105 needs its Dana S/N.
function resolveBody(b) {
  if (!String(b.dana_serial_number ?? '').trim()) {
    const size = sizeOf(b.size_code);
    if (!b.definition_code) return { rule: null, problem: 'No Dana S/N and no body definition' };
    if (size === '105') return { rule: null, problem: `unetched 105 body (${b.definition_code}): Standard or Special needs the Dana S/N` };
    if (!['064', '076', '088'].includes(size)) return { rule: null, problem: `definition ${b.definition_code} has no supported size` };
    return { rule: size, problem: null };
  }
  const decoded = decodeDanaSerial(b.dana_serial_number);
  if (!decoded.valid) return { rule: null, problem: decoded.reason };
  const serial = decoded.serial;
  const checks = [['size', serial.slice(4, 7), b.size_code ? sizeOf(b.size_code) : ''], ['hand', serial.charAt(2), b.hand_code], ['blade family', serial.charAt(3), b.blade_family_code],
    ['supplier', serial.charAt(1), b.supplier_code], ['cutter head', serial.charAt(0), b.cutter_head_code]];
  for (const [name, actual, expected] of checks) {
    const want = String(expected ?? '').trim().toUpperCase();
    if (want && want !== actual) return { rule: null, problem: `Dana S/N ${name} "${actual}" conflicts with definition ${b.definition_code ?? ''} "${want}"` };
  }
  return { rule: decoded.rule, problem: null };
}

async function main() {
  const env = { ...loadDotEnv(path.join(root, '.env')), ...process.env };
  const client = new pg.Client({
    host: env.DATABASE_HOST, port: Number(env.DATABASE_PORT), user: env.DATABASE_USERNAME,
    password: String(env.DATABASE_PASSWORD ?? ''), database: env.DATABASE_NAME,
  });
  await client.connect();
  try {
    await client.query(applySpecial105 ? 'BEGIN' : 'BEGIN READ ONLY');
    const hasRules = (await client.query("SELECT to_regclass('public.cutter_summary_body_rules') IS NOT NULL AS present")).rows[0].present;
    if (applySpecial105 && !hasRules) throw new Error('cutter_summary_body_rules does not exist yet: start the updated API once so its migration runs, then retry.');
    const summaries = (await client.query(`
      SELECT s.id, s.number, s.revision, s.enabled, s.hos, m.model_number::text AS model,
             ${hasRules ? 'r.body_rule' : 'NULL::text AS body_rule'},
             COALESCE((SELECT json_agg(json_build_object('part_type', pt.code, 'sets', q.required_blade_count, 'enabled', q.enabled) ORDER BY pt.code)
                FROM cutter_blade_requirements q JOIN part_types pt ON pt.id=q.part_type_id
               WHERE q.summary_id=s.id AND q."deletedAt" IS NULL), '[]'::json) AS requirements
        FROM part_summaries s LEFT JOIN models m ON m.id=s.model_id
        ${hasRules ? 'LEFT JOIN cutter_summary_body_rules r ON r.summary_id=s.id' : ''}
       WHERE s."deletedAt" IS NULL ORDER BY s.number, s.revision`)).rows;
    const bodies = (await client.query(`
      SELECT b.id, b.dana_serial_number, b.mf_serial_number, b.enabled, d.definition_code, d.enabled AS definition_enabled,
             d.size_code, d.hand_code, d.blade_family_code, d.supplier_code, d.cutter_head_code
        FROM cutter_bodies b LEFT JOIN cutter_body_definitions d ON d.id=b.definition_id
       WHERE b."deletedAt" IS NULL ORDER BY b.dana_serial_number NULLS LAST, b.mf_serial_number`)).rows;
    const definitions = (await client.query(`
      SELECT definition_code, size_code, hand_code, blade_family_code, blade_family_name, enabled
        FROM cutter_body_definitions WHERE "deletedAt" IS NULL ORDER BY definition_code`)).rows;
    const trays = (await client.query(`
      SELECT t.serial_number, s.number AS summary, pt.code AS part_type, t.required_blade_count AS snapshot, q.required_blade_count AS current
        FROM trays t JOIN part_summaries s ON s.id=t.summary_id JOIN part_types pt ON pt.id=t.part_type_id
        JOIN cutter_blade_requirements q ON q.summary_id=t.summary_id AND q.part_type_id=t.part_type_id AND q.enabled=true
       WHERE t.enabled=true AND t."deletedAt" IS NULL AND t.required_blade_count IS NOT NULL
         AND t.required_blade_count<>q.required_blade_count ORDER BY t.serial_number`)).rows;

    const report = {
      generated_at: new Date().toISOString(),
      unit_note: 'required_blade_count is matched inner/outer sets; total blades = sets x 2',
      requirement_quantities: {}, unapproved_requirements: [], summary_states: {}, summaries_needing_review: [],
      bodies: { by_rule: {}, unresolved: [] }, trays_with_other_snapshot: trays, watched: {}, applied: [],
      matrix: [], matrix_evidence: {},
    };
    const approved = new Set(APPROVED_BODY_RULES.map((r) => r.total_blades / BLADES_PER_MATCHED_SET));
    for (const s of summaries) {
      for (const q of s.requirements) {
        const key = blades(Number(q.sets));
        report.requirement_quantities[key] = (report.requirement_quantities[key] ?? 0) + 1;
        if (!approved.has(Number(q.sets))) report.unapproved_requirements.push({ summary: s.number, revision: s.revision, part_type: q.part_type, sets: q.sets });
      }
      const state = summaryState(s.body_rule, s.requirements.map((q) => Number(q.sets)));
      s.state = state;
      report.summary_states[state.status] = (report.summary_states[state.status] ?? 0) + 1;
      if (state.status === 'CONFLICT' || state.status === 'UNRESOLVED') {
        report.summaries_needing_review.push({ summary: s.number, revision: s.revision, model: s.model, status: state.status, detail: state.detail });
      }
    }
    for (const b of bodies) {
      const { rule, problem } = resolveBody(b);
      const key = problem ? 'UNRESOLVED' : rule;
      report.bodies.by_rule[key] = (report.bodies.by_rule[key] ?? 0) + 1;
      if (problem) report.bodies.unresolved.push({ dana: b.dana_serial_number, mf: b.mf_serial_number, definition: b.definition_code, enabled: b.enabled, problem });
      else if (b.definition_code && b.definition_enabled === false) report.bodies.unresolved.push({ dana: b.dana_serial_number, mf: b.mf_serial_number, definition: b.definition_code, enabled: b.enabled, problem: 'body definition is disabled' });
    }
    report.matrix = buildBodyMatrix(summaries.map((s) => ({
      summary: s.number, revision: s.revision, model: s.model, hos: s.hos, enabled: s.enabled, body_rule: s.body_rule,
      requirements: s.requirements.map((q) => ({ part_type: q.part_type, sets: Number(q.sets), enabled: q.enabled })),
    })), definitions);
    for (const row of report.matrix) report.matrix_evidence[row.evidence] = (report.matrix_evidence[row.evidence] ?? 0) + 1;
    for (const number of WATCHED) {
      const rows = summaries.filter((s) => s.number === number);
      report.watched[number] = rows.length
        ? rows.map((s) => ({ revision: s.revision, model: s.model, hos: s.hos, body_rule: s.body_rule, status: s.state.status, requirements: s.requirements.map((q) => `${q.part_type} ${blades(Number(q.sets))}`),
            permitted: report.matrix.filter((r) => r.summary === s.number && r.revision === s.revision).map((r) => `${r.part_type}: ${r.permitted.join(', ') || 'none'} (${r.evidence})`) }))
        : 'not in part_summaries';
    }

    if (applySpecial105) {
      for (const number of PROPOSED_SPECIAL_105) {
        const rows = summaries.filter((s) => s.number === number && s.enabled);
        if (!rows.length) { report.applied.push({ summary: number, result: 'skipped: Summary not in master data' }); continue; }
        for (const s of rows) {
          const quantities = s.requirements.map((q) => Number(q.sets));
          let result;
          if (s.body_rule === '105-SPECIAL') result = 'unchanged: already 105-SPECIAL';
          else if (s.body_rule) result = `conflict left for review: configured ${s.body_rule}`;
          else if (String(s.model ?? '').trim() !== '286') result = `skipped: model is ${s.model ?? 'blank'}, not 286`;
          else if (!quantities.length || quantities.some((v) => v !== 13)) result = `skipped: requirements are ${quantities.join('/') || 'missing'}, not 13 sets`;
          else {
            await client.query(
              `INSERT INTO public.cutter_summary_body_rules (summary_id, body_rule, "createdBy", "updatedBy")
               VALUES ($1,'105-SPECIAL','audit-cutter-blade-rules','audit-cutter-blade-rules') ON CONFLICT (summary_id) DO NOTHING`,
              [s.id],
            );
            result = 'applied: 105-SPECIAL (26 blades / 13 sets; quantity unchanged)';
          }
          report.applied.push({ summary: number, revision: s.revision, result });
        }
      }
    }
    await client.query('COMMIT');

    if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }
    console.log(`Cutter blade rule audit — ${report.generated_at}\n${report.unit_note}\n`);
    console.log('Requirement rows by quantity:', report.requirement_quantities);
    console.log('Requirement rows with an unapproved quantity:', report.unapproved_requirements.length ? report.unapproved_requirements : 'none');
    console.log('Summary Body Size Rule states:', report.summary_states);
    console.log(`Summaries needing review (${report.summaries_needing_review.length}):`);
    for (const r of report.summaries_needing_review) console.log(`  ${r.summary}${r.revision ? ` rev ${r.revision}` : ''} model ${r.model ?? '-'}: ${r.status} — ${r.detail}`);
    console.log('Cutter bodies by decoded rule:', report.bodies.by_rule);
    for (const b of report.bodies.unresolved) console.log(`  unresolved body Dana ${b.dana ?? '-'} / MF ${b.mf ?? '-'} / definition ${b.definition ?? '-'}${b.enabled ? '' : ' (disabled)'}: ${b.problem}`);
    console.log(`Trays whose post-grind snapshot differs from the current requirement: ${trays.length}`);
    for (const t of trays) console.log(`  ${t.serial_number} ${t.summary} ${t.part_type}: snapshot ${t.snapshot}, current ${t.current}`);
    console.log('Summary + Part Type matrix rows by evidence:', report.matrix_evidence);
    if (printMatrix) {
      console.log('Summary | Rev | Model | HOS (Summary) | Part Type | Required | Body rule | Permitted body definitions | Evidence | Detail');
      for (const r of report.matrix) {
        console.log(`  ${r.summary} | ${r.revision || '-'} | ${r.model ?? '-'} | ${r.hos ?? '-'} | ${r.part_type} | ${r.total_blades} blades (${r.sets} sets) | ${r.body_rule ?? '-'} | ${r.permitted.join(', ') || 'none'} | ${r.evidence} | ${r.detail}`);
      }
    }
    console.log('Watched Summaries:');
    for (const [k, v] of Object.entries(report.watched)) console.log(`  ${k}: ${JSON.stringify(v)}`);
    if (applySpecial105) { console.log('Proposed special-105 mappings:'); for (const a of report.applied) console.log(`  ${a.summary}${a.revision ? ` rev ${a.revision}` : ''}: ${a.result}`); }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error.message ?? error); process.exitCode = 1; });
