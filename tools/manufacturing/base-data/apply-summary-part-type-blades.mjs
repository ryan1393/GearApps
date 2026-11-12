// Import RING/PINION HOS, Inner blade and Outer blade from Blade sheet cope.xlsx Sheet2
// (tools/manufacturing/base-data/data/summary_part_type_blades.json) into the CURRENT database.
//
//   node tools/manufacturing/base-data/apply-summary-part-type-blades.mjs           (dry run: report only)
//   node tools/manufacturing/base-data/apply-summary-part-type-blades.mjs --apply   (write)
//   add --json for a machine-readable report
//
// Safe to repeat. It only fills blank fields: a value already stored (an Admin edit or an earlier
// run) is kept and any difference is reported. It never creates a Summary, never touches
// Summaries outside the approved scope (30588, 32414), skips zero/blank source rows, and changes
// no quantity, body rule, part or gearset. A blank-revision source row applies to every enabled
// revision of the Summary, as the blade-requirement import does. Positions follow
// summary-part-type-blades-plan.mjs. Needs the API to have started once (it creates the table).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { mergeIntoStored, planSummaryPartTypeBlades } from './summary-part-type-blades-plan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const asJson = args.has('--json');

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

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(here, 'data', 'summary_part_type_blades.json'), 'utf8').replace(/^﻿/, ''));
  const plan = planSummaryPartTypeBlades(data.rows);
  const env = { ...loadDotEnv(path.join(root, '.env')), ...process.env };
  const client = new pg.Client({
    host: env.DATABASE_HOST, port: Number(env.DATABASE_PORT), user: env.DATABASE_USERNAME,
    password: String(env.DATABASE_PASSWORD ?? ''), database: env.DATABASE_NAME,
  });
  await client.connect();
  const report = { mode: apply ? 'apply' : 'dry-run', source: data.source, planned: plan.planned.length, written: [], unchanged: 0,
    kept_existing: [], not_in_master: [], skipped: plan.skipped, unplaced_labels: plan.planned.filter((p) => !p.inner_blade && !p.outer_blade).map((p) => `${p.summary} ${p.part_type}: ${p.basis}`) };
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const present = (await client.query("SELECT to_regclass('public.part_summary_part_type_blades') IS NOT NULL AS present")).rows[0].present;
    if (!present) throw new Error('public.part_summary_part_type_blades does not exist yet: start the updated API once so its migration runs, then retry.');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('summary-part-type-blades-import'))");
    const types = new Map((await client.query("SELECT code, id FROM part_types WHERE code IN ('RING','PINION')")).rows.map((r) => [r.code, r.id]));
    for (const p of plan.planned) {
      const summaries = (await client.query(
        'SELECT id, revision FROM part_summaries WHERE number=$1 AND enabled=true AND "deletedAt" IS NULL ORDER BY revision', [p.summary],
      )).rows;
      if (!summaries.length) { report.not_in_master.push(`${p.summary} ${p.part_type}`); continue; }
      for (const s of summaries) {
        const stored = (await client.query(
          'SELECT hos, inner_blade, outer_blade FROM part_summary_part_type_blades WHERE summary_id=$1 AND part_type_id=$2',
          [s.id, types.get(p.part_type)],
        )).rows[0];
        const { next, changes, kept } = mergeIntoStored(stored, p);
        const label = `${p.summary}${s.revision ? ` rev ${s.revision}` : ''} ${p.part_type}`;
        for (const k of kept) report.kept_existing.push(`${label}: ${k}`);
        if (!changes) { report.unchanged += 1; continue; }
        report.written.push(`${label}: HOS ${next.hos ?? '—'}, Inner ${next.inner_blade ?? '—'}, Outer ${next.outer_blade ?? '—'} (${p.basis})`);
        if (apply) {
          await client.query(
            `INSERT INTO part_summary_part_type_blades (summary_id, part_type_id, hos, inner_blade, outer_blade, source, "createdBy", "updatedBy")
             VALUES ($1,$2,$3,$4,$5,$6,'apply-summary-part-type-blades','apply-summary-part-type-blades')
             ON CONFLICT (summary_id, part_type_id) DO UPDATE
               SET hos=EXCLUDED.hos, inner_blade=EXCLUDED.inner_blade, outer_blade=EXCLUDED.outer_blade,
                   "updatedAt"=now(), "updatedBy"=EXCLUDED."updatedBy"`,
            [s.id, types.get(p.part_type), next.hos, next.inner_blade, next.outer_blade, `Blade sheet cope.xlsx ${p.source ?? ''}`.trim()],
          );
        }
      }
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }
  const list = (label, items) => { console.log(`${label} (${items.length})`); for (const i of items) console.log(`  ${typeof i === 'string' ? i : `${i.summary} ${i.part_type}: ${i.reason}`}`); };
  console.log(`Summary + Part Type HOS / blades — ${report.mode}\nSource: ${report.source}\nPlanned source rows: ${report.planned}`);
  list(apply ? 'Written' : 'Would write', report.written);
  console.log(`Already up to date: ${report.unchanged}`);
  list('Stored values kept (they differ from the source)', report.kept_existing);
  list('Labels left blank (positions not established)', report.unplaced_labels);
  list('Source Summaries not in master data or disabled (not created or changed)', report.not_in_master);
  list('Skipped source rows', report.skipped);
  if (!apply) console.log('\nDry run: nothing was written. Re-run with --apply to write.');
}

main().catch((error) => { console.error(error.message ?? error); process.exitCode = 1; });
