// Summary + Part Type → permitted cutter-body definitions, from the PACKAGED base data only
// (no database). It shows what a fresh base-data import configures; the live answer comes
// from `npm run audit:cutter-blade-rules` or GET /api/v1/cutter-config/body-compatibility.
//
//   node tools/manufacturing/base-data/report-cutter-body-matrix.mjs            (Markdown to stdout)
//   node tools/manufacturing/base-data/report-cutter-body-matrix.mjs --json
//
// A fresh import configures no Summary Body Size Rule, so every 13-set (26-blade) Summary is
// UNRESOLVED here: 076 Standard and 105 Special are never picked from the quantity.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBodyMatrix, planBladeRequirements } from './blade-requirement-plan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(fs.readFileSync(path.join(here, 'data', name), 'utf8').replace(/^﻿/, ''));
const clean = (v) => (v == null ? '' : String(v).trim());
const PROPOSED_SPECIAL_105 = new Set(['30131', '30132', '30133', '30136']);
// The handoff's reviewed baseline put these outside the approved master scope; this repository's
// summary_additions.json (cutter-body-info.xlsx) adds them. Reported, not changed.
const SCOPE_REVIEW = new Set(['30588', '32414']);

export function baseDataMatrix() {
  const models = new Map(read('models.json').map((m) => [clean(m.Model_ID), clean(m.Model)]));
  const master = [
    ...read('summaries.json').map((s) => ({ summary: clean(s.Summary), revision: clean(s.Summary_Rev), model: models.get(clean(s.Model_ID)) ?? null, hos: clean(s.HoS) || null, source: 'summaries.json' })),
    ...read('summary_additions.json').map((s) => ({ summary: clean(s.Summary), revision: clean(s.Summary_Rev), model: null, hos: null, source: 'summary_additions.json' })),
  ];
  const definitions = read('cutter_body_definitions.json').map((d) => ({
    definition_code: d.Definition_Code, size_code: d.Size_Code, hand_code: d.Hand_Code, blade_family_code: d.Blade_Family_Code,
    blade_family_name: d.Blade_Family_Name, enabled: d.Enabled !== false,
  }));
  const plan = planBladeRequirements(read('cutter_blade_requirements.json'));
  const summaries = [];
  const outOfScope = [];
  for (const group of plan.planned) {
    // Same resolution as the importer: a blank revision applies to every revision of the Summary.
    const matches = master.filter((m) => m.summary === group.summary && (!group.explicit || m.revision === group.revision));
    if (!matches.length) { outOfScope.push(group.summary); continue; }
    for (const m of matches) {
      summaries.push({ ...m, body_rule: null, requirements: group.rows.map((r) => ({ part_type: r.partTypeCode, sets: group.sets, enabled: true })) });
    }
  }
  summaries.sort((a, b) => a.summary.localeCompare(b.summary, undefined, { numeric: true }) || a.revision.localeCompare(b.revision));
  const rows = buildBodyMatrix(summaries, definitions).map((row) => ({
    ...row,
    note: [
      PROPOSED_SPECIAL_105.has(row.summary) ? 'Workbook review proposed 105 Special (model 286 = workbook model 80); not applied' : '',
      SCOPE_REVIEW.has(row.summary) ? 'Added by summary_additions.json, but outside the reviewed approved master scope: review' : '',
    ].filter(Boolean).join('; '),
  }));
  const withoutRequirement = master.filter((m) => !summaries.some((s) => s.summary === m.summary && s.revision === m.revision));
  return { rows, definitions, skipped: plan.skipped, outOfScope, withoutRequirement };
}

function markdown({ rows, definitions, skipped, outOfScope, withoutRequirement }) {
  const lines = [];
  const count = (e) => rows.filter((r) => r.evidence === e).length;
  lines.push('| Summary | Rev | Model | HOS (Summary) | Part Type | Required blades | Body Size Rule | Permitted body definitions | Evidence | Notes |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.summary} | ${r.revision || '—'} | ${r.model ?? '—'} | ${r.hos ?? '—'} | ${r.part_type} | ${r.total_blades} (${r.sets} sets) | ${r.body_rule ?? '—'} | ${r.permitted.join(', ') || 'none'} | ${r.evidence} | ${[r.evidence === 'SUPPORTED' || r.evidence === 'CONFIGURED' ? '' : r.detail, r.note].filter(Boolean).join('; ')} |`);
  }
  const head = [
    `Rows: ${rows.length} (SUPPORTED ${count('SUPPORTED')}, CONFIGURED ${count('CONFIGURED')}, UNRESOLVED ${count('UNRESOLVED')}, CONFLICTING ${count('CONFLICTING')}).`,
    `Definitions: ${definitions.map((d) => `${d.definition_code}${d.enabled ? '' : ' (disabled)'}`).join(', ')}.`,
    `Requirement Summaries outside master scope (not imported): ${outOfScope.join(', ') || 'none'}.`,
    `Master Summaries with no blade requirement (no matrix row): ${withoutRequirement.map((m) => m.summary + (m.revision ? ` rev ${m.revision}` : '')).join(', ') || 'none'}.`,
    `Source rows skipped (blank/zero/disagreeing): ${skipped.length}.`,
  ];
  return `${head.join('\n')}\n\n${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = baseDataMatrix();
  console.log(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : markdown(result));
}
