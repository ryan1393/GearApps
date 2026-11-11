// Read-only audit of cutter-body blade rules against the CURRENT database.
//
//   node tools/manufacturing/base-data/audit-cutter-blade-rules.mjs            (report only)
//   node tools/manufacturing/base-data/audit-cutter-blade-rules.mjs --json     (machine-readable)
//   node tools/manufacturing/base-data/audit-cutter-blade-rules.mjs --apply-proposed-special-105
//
// The report changes nothing. It lists requirement quantities, RING/PINION disagreements,
// Summary Body Size Rule states, cutter bodies whose Dana S/N is missing, malformed or
// conflicts with their definition, and trays whose post-grind snapshot differs from the
// current requirement. Quantities are matched sets; totals are shown beside them.
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
import { APPROVED_BODY_RULES, BLADES_PER_MATCHED_SET, decodeDanaSerial, setsForRule, uniqueRuleForSets } from './blade-requirement-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
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
      SELECT s.id, s.number, s.revision, s.enabled, m.model_number::text AS model,
             ${hasRules ? 'r.body_rule' : 'NULL::text AS body_rule'},
             COALESCE((SELECT json_agg(json_build_object('part_type', pt.code, 'sets', q.required_blade_count, 'enabled', q.enabled) ORDER BY pt.code)
                FROM cutter_blade_requirements q JOIN part_types pt ON pt.id=q.part_type_id
               WHERE q.summary_id=s.id AND q."deletedAt" IS NULL), '[]'::json) AS requirements
        FROM part_summaries s LEFT JOIN models m ON m.id=s.model_id
        ${hasRules ? 'LEFT JOIN cutter_summary_body_rules r ON r.summary_id=s.id' : ''}
       WHERE s."deletedAt" IS NULL ORDER BY s.number, s.revision`)).rows;
    const bodies = (await client.query(`
      SELECT b.id, b.dana_serial_number, b.mf_serial_number, b.enabled, d.size_code, d.hand_code, d.blade_family_code
        FROM cutter_bodies b LEFT JOIN cutter_body_definitions d ON d.id=b.definition_id
       WHERE b."deletedAt" IS NULL ORDER BY b.dana_serial_number NULLS LAST, b.mf_serial_number`)).rows;
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
      const decoded = decodeDanaSerial(b.dana_serial_number);
      let problem = decoded.valid ? null : decoded.reason;
      if (decoded.valid) {
        const size = b.size_code && /^\d{1,3}$/.test(String(b.size_code).trim()) ? String(b.size_code).trim().padStart(3, '0') : b.size_code;
        if ((size && size !== decoded.size_code) || (b.hand_code && b.hand_code.toUpperCase() !== decoded.hand_code) || (b.blade_family_code && b.blade_family_code.toUpperCase() !== decoded.blade_family_code)) {
          problem = `Dana S/N conflicts with definition (size ${size ?? '-'}, hand ${b.hand_code ?? '-'}, family ${b.blade_family_code ?? '-'})`;
        }
      }
      const key = problem ? 'UNRESOLVED' : decoded.rule;
      report.bodies.by_rule[key] = (report.bodies.by_rule[key] ?? 0) + 1;
      if (problem) report.bodies.unresolved.push({ dana: b.dana_serial_number, mf: b.mf_serial_number, enabled: b.enabled, problem });
    }
    for (const number of WATCHED) {
      const rows = summaries.filter((s) => s.number === number);
      report.watched[number] = rows.length
        ? rows.map((s) => ({ revision: s.revision, model: s.model, body_rule: s.body_rule, status: s.state.status, requirements: s.requirements.map((q) => `${q.part_type} ${blades(Number(q.sets))}`) }))
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
    for (const b of report.bodies.unresolved) console.log(`  unresolved body Dana ${b.dana ?? '-'} / MF ${b.mf ?? '-'}${b.enabled ? '' : ' (disabled)'}: ${b.problem}`);
    console.log(`Trays whose post-grind snapshot differs from the current requirement: ${trays.length}`);
    for (const t of trays) console.log(`  ${t.serial_number} ${t.summary} ${t.part_type}: snapshot ${t.snapshot}, current ${t.current}`);
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
