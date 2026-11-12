// Read-only audit of the gearset master and its relationships in the CURRENT database.
//
//   node tools/manufacturing/base-data/audit-gearsets.mjs                 (report)
//   node tools/manufacturing/base-data/audit-gearsets.mjs --json          (machine-readable)
//   node tools/manufacturing/base-data/audit-gearsets.mjs --seed <file>   (also compare a historical seed JSON)
//
// It never writes: the transaction is READ ONLY. A seed's import rules (for example
// hard_reset_test_data) are reported, never applied.
//
// Relationships (verified in the schema): public.gearsets has one row per assembly, keyed by
// id (uuid). gearset_part_id is UNIQUE and points at the GEARSET part (the gearset number);
// ring_part_id and pinion_part_id point at RING and PINION parts and are NOT unique, so a ring
// or pinion may belong to several gearsets; summary_id is the assembly's own Summary and is not
// unique either. Model comes from the Summary. statuses[] is the business classification
// (Production, Service, ...); active/enabled/archived_at say whether the record is usable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { BLADES_PER_MATCHED_SET, summaryRuleState } from './blade-requirement-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const seedIndex = argv.indexOf('--seed');
const seedFile = seedIndex >= 0 ? argv[seedIndex + 1] : null;
if (seedIndex >= 0 && !seedFile) throw new Error('--seed needs a file path');

/** Columns this repository's DDL (libs/shared/database/src/lib/gearset-schema.ts) defines. */
export const CANONICAL_GEARSET_COLUMNS = Object.freeze([
  'id', 'gearset_part_id', 'ring_part_id', 'pinion_part_id', 'summary_id', 'ratio_value', 'ratio_text',
  'customer', 'application', 'statuses', 'cut', 'active', 'enabled', 'archived_at',
  'created_at', 'updated_at', 'created_by', 'updated_by',
]);
/** The examples the gearset handoff names. */
export const HANDOFF_EXAMPLES = Object.freeze(['10006253', '10060460', '10161958']);

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

const clean = (v) => (v == null ? '' : String(v).trim());
const key = (v) => clean(v).toUpperCase();
const asList = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : clean(v) ? [clean(v)] : []);

/** Find the gearset rows in a seed whatever its top-level layout; field names follow the October seed. */
export function seedGearsets(seed) {
  const candidates = [seed?.gearsets, seed?.data?.gearsets, seed?.tables?.gearsets, Array.isArray(seed) ? seed : null];
  const rows = candidates.find((c) => Array.isArray(c));
  if (!rows) throw new Error(`No gearsets array found in the seed (top-level keys: ${Object.keys(seed ?? {}).join(', ') || 'none'})`);
  return rows.map((r) => ({
    number: clean(r.gearset_part_number ?? r.part_number ?? r['Part Number']),
    summary: clean(r.summary ?? r.Summary),
    models: asList(r.models ?? r.model ?? r.Model),
    ratio: r.ratio == null ? null : Number(r.ratio),
    ring: clean(r.ring_part_number ?? r['Ring Gear']), ring_teeth: r.ring_teeth == null ? null : Number(r.ring_teeth),
    pinion: clean(r.pinion_part_number ?? r.Pinion), pinion_teeth: r.pinion_teeth == null ? null : Number(r.pinion_teeth),
    customer: clean(r.customer ?? r.Customer) || null, application: clean(r.application ?? r.Application) || null,
    statuses: asList(r.statuses ?? r.Status), cut: clean(r.cut ?? r.Cut) || null,
    source_requirement: r.source_requirement == null ? null : Number(r.source_requirement),
    required_blades: r.required_blades == null ? null : Number(r.required_blades),
    body_rule_hint: clean(r.body_rule_hint) || null,
  })).filter((r) => r.number);
}

/** Import-rule flags the seed records, for the report (never applied). */
export function seedRules(seed) {
  const found = {};
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 3 || Array.isArray(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'boolean' || typeof v === 'string' && /^(gearset_part_type)$/.test(k)) found[k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, depth + 1);
    }
  };
  walk(seed, 0);
  return found;
}

/** Compare seed gearsets with database gearsets (by gearset number). Pure; used by the tests. */
export function compareSeed(seedRows, dbRows) {
  const db = new Map(dbRows.map((g) => [key(g.number), g]));
  const result = { seed_rows: seedRows.length, missing_in_database: [], differences: [], doubled_requirement_problems: [] };
  for (const s of seedRows) {
    if (s.source_requirement != null && s.required_blades != null && s.required_blades !== s.source_requirement * BLADES_PER_MATCHED_SET) {
      result.doubled_requirement_problems.push(`${s.number}: required_blades ${s.required_blades} is not source_requirement ${s.source_requirement} x ${BLADES_PER_MATCHED_SET}`);
    }
    const g = db.get(key(s.number));
    if (!g) { result.missing_in_database.push(s.number); continue; }
    const diffs = [];
    const cmp = (name, a, b) => { if (key(a) !== key(b)) diffs.push(`${name}: seed ${a || '—'} / database ${b || '—'}`); };
    cmp('summary', s.summary, g.summary);
    cmp('ring', s.ring, g.ring);
    cmp('pinion', s.pinion, g.pinion);
    if (s.ring_teeth != null && Number(g.ring_teeth) !== s.ring_teeth) diffs.push(`ring teeth: seed ${s.ring_teeth} / database ${g.ring_teeth}`);
    if (s.pinion_teeth != null && Number(g.pinion_teeth) !== s.pinion_teeth) diffs.push(`pinion teeth: seed ${s.pinion_teeth} / database ${g.pinion_teeth}`);
    if (s.models.length && !s.models.map(key).includes(key(g.model))) diffs.push(`model: seed ${s.models.join('/')} / database ${g.model || '—'}`);
    cmp('customer', s.customer, g.customer);
    cmp('application', s.application, g.application);
    cmp('cut', s.cut, g.cut);
    if (s.statuses.map(key).sort().join('|') !== (g.statuses ?? []).map(key).sort().join('|')) {
      diffs.push(`business statuses: seed ${s.statuses.join('/') || '—'} / database ${(g.statuses ?? []).join('/') || '—'}`);
    }
    // Stored requirement quantity is matched sets; the seed's source_requirement is the same unit.
    if (s.source_requirement != null && g.ring_sets != null && Number(g.ring_sets) !== s.source_requirement) {
      diffs.push(`blade requirement: seed source ${s.source_requirement} sets (${s.source_requirement * BLADES_PER_MATCHED_SET} blades) / database ${g.ring_sets} sets`);
    }
    if (diffs.length) result.differences.push({ gearset: s.number, diffs });
  }
  const seedNumbers = new Set(seedRows.map((s) => key(s.number)));
  result.database_only = dbRows.filter((g) => !seedNumbers.has(key(g.number))).map((g) => g.number);
  return result;
}

async function main() {
  const env = { ...loadDotEnv(path.join(root, '.env')), ...process.env };
  const client = new pg.Client({
    host: env.DATABASE_HOST, port: Number(env.DATABASE_PORT), user: env.DATABASE_USERNAME,
    password: String(env.DATABASE_PASSWORD ?? ''), database: env.DATABASE_NAME,
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const present = (await client.query("SELECT to_regclass('public.gearsets') IS NOT NULL AS g, to_regclass('public.cutter_summary_body_rules') IS NOT NULL AS r, to_regclass('lapper.gearsets') IS NOT NULL AS l")).rows[0];
    if (!present.g) throw new Error('public.gearsets does not exist in this database');
    const columns = (await client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='gearsets' ORDER BY ordinal_position`)).rows;
    const constraints = (await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.gearsets'::regclass ORDER BY conname`)).rows;
    const triggers = (await client.query(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'guard_gearset%' ORDER BY tgname`)).rows.map((r) => r.tgname);
    const has = (c) => columns.some((x) => x.column_name === c);
    const gearsets = (await client.query(`
      SELECT g.id, gp.part_number AS number, s.number AS summary, s.revision AS summary_revision, m.model_number::text AS model,
             g.ratio_value::float AS ratio, g.ratio_text,
             r.part_number AS ring, r.teeth AS ring_teeth, rs.number AS ring_summary, r.active AS ring_active, r.enabled AS ring_enabled,
             p.part_number AS pinion, p.teeth AS pinion_teeth, ps.number AS pinion_summary, p.active AS pinion_active, p.enabled AS pinion_enabled,
             gt.code AS gearset_type, rt.code AS ring_type, pt.code AS pinion_type, gp.summary_id = g.summary_id AS gearset_part_summary_matches,
             ${has('customer') ? 'g.customer' : 'NULL::text AS customer'}, ${has('application') ? 'g.application' : 'NULL::text AS application'},
             ${has('statuses') ? 'g.statuses' : 'ARRAY[]::text[] AS statuses'}, ${has('cut') ? 'g.cut' : 'NULL::text AS cut'},
             g.active, g.enabled, ${has('archived_at') ? 'g.archived_at' : 'NULL::timestamptz AS archived_at'},
             gp.active AS gearset_part_active, gp.enabled AS gearset_part_enabled,
             ${present.r ? 'br.body_rule' : 'NULL::text AS body_rule'},
             (SELECT json_object_agg(qt.code, q.required_blade_count) FROM cutter_blade_requirements q JOIN part_types qt ON qt.id=q.part_type_id
               WHERE q.summary_id=g.summary_id AND q.enabled AND q."deletedAt" IS NULL) AS requirements
        FROM public.gearsets g
        JOIN public.parts gp ON gp.id=g.gearset_part_id JOIN public.part_types gt ON gt.id=gp.part_type_id
        JOIN public.parts r ON r.id=g.ring_part_id JOIN public.part_types rt ON rt.id=r.part_type_id
        JOIN public.parts p ON p.id=g.pinion_part_id JOIN public.part_types pt ON pt.id=p.part_type_id
        JOIN public.part_summaries s ON s.id=g.summary_id LEFT JOIN public.models m ON m.id=s.model_id
        JOIN public.part_summaries rs ON rs.id=r.summary_id JOIN public.part_summaries ps ON ps.id=p.summary_id
        ${present.r ? 'LEFT JOIN public.cutter_summary_body_rules br ON br.summary_id=g.summary_id' : ''}
       ORDER BY gp.part_number`)).rows;
    const parts = (await client.query(`
      SELECT t.code, count(*)::int AS total, count(*) FILTER (WHERE p.active AND p.enabled)::int AS usable
        FROM public.parts p JOIN public.part_types t ON t.id=p.part_type_id WHERE p."deletedAt" IS NULL GROUP BY t.code ORDER BY t.code`)).rows;
    const orphanGearsetParts = (await client.query(`
      SELECT p.part_number FROM public.parts p JOIN public.part_types t ON t.id=p.part_type_id
       WHERE t.code='GEARSET' AND NOT EXISTS (SELECT 1 FROM public.gearsets g WHERE g.gearset_part_id=p.id) ORDER BY 1`)).rows.map((r) => r.part_number);
    const lapperOnly = present.l ? (await client.query('SELECT number FROM lapper.gearsets WHERE public_gearset_id IS NULL ORDER BY number')).rows.map((r) => r.number) : [];
    const counts = (await client.query(`SELECT (SELECT count(*) FROM public.part_summaries WHERE "deletedAt" IS NULL)::int AS summaries,
      (SELECT count(*) FROM public.models)::int AS models`)).rows[0];

    const group = (field) => {
      const map = new Map();
      for (const g of gearsets) map.set(g[field], [...(map.get(g[field]) ?? []), g.number]);
      return [...map.entries()].filter(([, list]) => list.length > 1).map(([k, list]) => ({ [field]: k, gearsets: list }));
    };
    const statusMix = {};
    for (const g of gearsets) {
      const usable = g.active && g.enabled && !g.archived_at ? 'usable' : 'inactive/archived';
      for (const s of g.statuses?.length ? g.statuses : ['(none)']) statusMix[`${s} · ${usable}`] = (statusMix[`${s} · ${usable}`] ?? 0) + 1;
    }
    const bladeLink = {};
    const bladeProblems = [];
    for (const g of gearsets) {
      const req = g.requirements ?? {};
      const state = summaryRuleState(g.body_rule ?? null, Object.values(req).map(Number));
      g.ring_sets = req.RING ?? null;
      bladeLink[state.status] = (bladeLink[state.status] ?? 0) + 1;
      const missing = ['RING', 'PINION'].filter((t) => req[t] == null);
      if (missing.length || state.status === 'UNRESOLVED' || state.status === 'CONFLICT') {
        bladeProblems.push({ gearset: g.number, summary: g.summary, status: state.status, rule: state.rule, missing_requirements: missing, detail: state.detail });
      }
    }
    const integrity = gearsets.filter((g) => g.gearset_type !== 'GEARSET' || g.ring_type !== 'RING' || g.pinion_type !== 'PINION' || !g.gearset_part_summary_matches)
      .map((g) => `${g.number}: types ${g.gearset_type}/${g.ring_type}/${g.pinion_type}, gearset part Summary ${g.gearset_part_summary_matches ? 'ok' : 'differs'}`);
    const ratioIssues = gearsets.filter((g) => g.ring_teeth && g.pinion_teeth && Math.abs(g.ratio - g.ring_teeth / g.pinion_teeth) > 0.005)
      .map((g) => `${g.number}: ratio ${g.ratio} vs teeth ${g.ring_teeth}/${g.pinion_teeth} = ${(g.ring_teeth / g.pinion_teeth).toFixed(4)}`);
    const componentSummaryDiffers = gearsets.filter((g) => key(g.ring_summary) !== key(g.summary) || key(g.pinion_summary) !== key(g.summary))
      .map((g) => `${g.number}: Summary ${g.summary}, ring ${g.ring_summary}, pinion ${g.pinion_summary}`);
    const inactiveWithParts = gearsets.filter((g) => !(g.active && g.enabled) || g.archived_at)
      .map((g) => ({ gearset: g.number, archived: Boolean(g.archived_at), ring: `${g.ring} ${g.ring_active && g.ring_enabled ? 'usable' : 'inactive'}`, pinion: `${g.pinion} ${g.pinion_active && g.pinion_enabled ? 'usable' : 'inactive'}` }));

    const report = {
      generated_at: new Date().toISOString(),
      schema: {
        columns: columns.map((c) => `${c.column_name} ${c.data_type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}`),
        not_in_repository_ddl: columns.map((c) => c.column_name).filter((c) => !CANONICAL_GEARSET_COLUMNS.includes(c)),
        missing_from_database: CANONICAL_GEARSET_COLUMNS.filter((c) => !has(c)),
        constraints: constraints.map((c) => `${c.conname}: ${c.def}`),
        guard_triggers: triggers,
      },
      counts: {
        gearsets: gearsets.length,
        usable_gearsets: gearsets.filter((g) => g.active && g.enabled && !g.archived_at).length,
        archived_gearsets: gearsets.filter((g) => g.archived_at).length,
        parts_by_type: Object.fromEntries(parts.map((p) => [p.code, `${p.total} (${p.usable} active+enabled)`])),
        summaries: counts.summaries,
        summaries_used_by_gearsets: new Set(gearsets.map((g) => g.summary)).size,
        models: counts.models,
        models_used_by_gearsets: new Set(gearsets.map((g) => g.model).filter(Boolean)).size,
        gearset_parts_without_assembly: orphanGearsetParts,
        lapper_numbers_without_assembly: lapperOnly.length,
      },
      shared: { pinions: group('pinion'), rings: group('ring'), summaries: group('summary') },
      handoff_examples: Object.fromEntries(HANDOFF_EXAMPLES.map((n) => {
        const g = gearsets.find((x) => key(x.number) === n);
        return [n, g ? `Summary ${g.summary}${g.summary_revision ? ` rev ${g.summary_revision}` : ''}, model ${g.model ?? '—'}, ring ${g.ring} (${g.ring_teeth}T), pinion ${g.pinion} (${g.pinion_teeth}T), ratio ${g.ratio_text}, customer ${g.customer ?? '—'}, application ${g.application ?? '—'}, business ${(g.statuses ?? []).join('/') || '—'}, cut ${g.cut ?? '—'}, ${g.active && g.enabled && !g.archived_at ? 'usable' : 'inactive/archived'}` : 'not in this database'];
      })),
      business_status_vs_usable: statusMix,
      inactive_or_archived_with_linked_parts: inactiveWithParts,
      integrity: { role_or_summary_problems: integrity, ratio_disagrees_with_teeth: ratioIssues, component_summary_number_differs: componentSummaryDiffers },
      blade_rule_link: { by_summary_rule_state: bladeLink, needing_review: bladeProblems },
    };
    if (seedFile) {
      const seed = JSON.parse(fs.readFileSync(path.resolve(seedFile), 'utf8').replace(/^﻿/, ''));
      report.seed = { file: seedFile, rules_recorded_never_applied: seedRules(seed), ...compareSeed(seedGearsets(seed), gearsets) };
    }
    await client.query('COMMIT');

    if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }
    const list = (label, items) => { console.log(`${label} (${items.length})`); for (const i of items.slice(0, 50)) console.log(`  ${typeof i === 'string' ? i : JSON.stringify(i)}`); if (items.length > 50) console.log(`  … ${items.length - 50} more (use --json)`); };
    console.log(`Gearset audit — ${report.generated_at} (read-only)\n`);
    console.log('public.gearsets columns:', report.schema.columns.join(', '));
    console.log('Columns not in the repository DDL:', report.schema.not_in_repository_ddl.join(', ') || 'none');
    console.log('Repository DDL columns missing here:', report.schema.missing_from_database.join(', ') || 'none');
    console.log('Constraints:'); for (const c of report.schema.constraints) console.log(`  ${c}`);
    console.log('Guard triggers:', triggers.join(', ') || 'none');
    console.log('Counts:', report.counts);
    list('Pinions shared by several gearsets', report.shared.pinions);
    list('Rings shared by several gearsets', report.shared.rings);
    list('Summaries with several gearsets', report.shared.summaries);
    console.log('Handoff examples:'); for (const [k, v] of Object.entries(report.handoff_examples)) console.log(`  ${k}: ${v}`);
    console.log('Business status vs usable:', statusMix);
    list('Inactive or archived gearsets and their linked parts', inactiveWithParts);
    list('Role/type or gearset-part Summary problems', integrity);
    list('Ratio disagrees with tooth counts', ratioIssues);
    list('Component Summary number differs from the gearset Summary', componentSummaryDiffers);
    console.log('Gearsets by Summary Body Size Rule state:', bladeLink);
    list('Gearsets whose blade requirement or body rule needs review', bladeProblems);
    if (report.seed) {
      console.log(`Seed ${seedFile}: ${report.seed.seed_rows} gearsets`);
      console.log('  Import rules recorded in the seed (NOT applied by this tool):', report.seed.rules_recorded_never_applied);
      list('  Seed gearsets missing in the database', report.seed.missing_in_database);
      list('  Seed vs database differences', report.seed.differences);
      list('  Database gearsets not in the seed', report.seed.database_only);
      list('  Seed required_blades not source_requirement x 2', report.seed.doubled_requirement_problems);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message ?? error); process.exitCode = 1; });
}
