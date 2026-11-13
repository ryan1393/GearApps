#!/usr/bin/env node
/**
 * Truck Log global stylesheet audit.
 *
 *   node tools/truck-log/audit-web-css.mjs            summary numbers
 *   node tools/truck-log/audit-web-css.mjs --dead     also list selectors that can never match
 *   node tools/truck-log/audit-web-css.mjs --json     machine-readable summary
 *
 * "Dead" means a selector requires a class, id or attribute that no template
 * or TypeScript source of the web client can produce (string prefixes such as
 * 'dock-age-' keep every class that starts with them alive).
 */
import { loadStylesheets, selectorIsLive, webSourceInventory } from './css-audit-lib.mjs';

const root = process.cwd();
const sheets = loadStylesheets(root);
const inventory = webSourceInventory(root);

let lines = 0; let important = 0; const colors = new Set(); let rules = 0;
const selectorUse = new Map(); const deadSelectors = []; let deadRules = 0;
const breakpoints = new Set();
for (const sheet of sheets) {
  lines += sheet.source.split('\n').length;
  important += (sheet.source.match(/!\s*important/gi) || []).length;
  for (const m of sheet.source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) colors.add(m[0].toLowerCase());
  for (const m of sheet.source.matchAll(/\((?:min|max)-width:\s*(\d+)px\)/g)) breakpoints.add(Number(m[1]));
  for (const rule of sheet.rules) {
    rules++;
    const key = (sel) => `${rule.context.join(' | ')} :: ${sel}`;
    let live = 0;
    for (const sel of rule.selectors) {
      selectorUse.set(key(sel), (selectorUse.get(key(sel)) ?? 0) + 1);
      if (selectorIsLive(sel, inventory)) live++;
      else deadSelectors.push(`${sheet.rel}: ${rule.context.length ? rule.context.join(' ') + ' ' : ''}${sel}`);
    }
    if (!live) deadRules++;
  }
}
const duplicateSelectors = [...selectorUse.values()].filter((n) => n > 1).length;
const summary = {
  files: sheets.length,
  lines,
  rules,
  important,
  distinctHexColors: colors.size,
  selectorsDefinedMoreThanOnce: duplicateSelectors,
  deadSelectors: deadSelectors.length,
  deadRules,
  widthBreakpoints: breakpoints.size,
};
if (process.argv.includes('--json')) console.log(JSON.stringify(summary));
else {
  console.log('Truck Log global CSS audit');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(30)} ${v}`);
  if (process.argv.includes('--dead')) for (const d of deadSelectors) console.log('  DEAD ' + d);
}

// --remove-dead: delete dead selectors from lists, whole rules when every selector is dead,
// and at-rule blocks left empty. (Re-run the audit afterwards.)
if (process.argv.includes('--remove-dead')) {
  const fsm = await import('node:fs');
  let removedRules = 0, trimmedSelectors = 0;
  for (const sheet of sheets) {
    const edits = [];
    for (const rule of sheet.rules) {
      const live = rule.selectors.filter((s) => selectorIsLive(s, inventory));
      if (live.length === rule.selectors.length) continue;
      if (!live.length) { edits.push({ start: rule.start, end: rule.end, text: '' }); removedRules++; }
      else { edits.push({ start: rule.start, end: rule.bodyStart - 1, text: live.join(',\n') + ' ' }); trimmedSelectors += rule.selectors.length - live.length; }
    }
    if (!edits.length) continue;
    let src = sheet.source;
    for (const e of edits.sort((a, b) => b.start - a.start)) src = src.slice(0, e.start) + e.text + src.slice(e.end);
    for (let i = 0; i < 3; i++) src = src.replace(/@(media|supports|container)[^{};]*\{\s*\}/g, '');
    src = src.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    fsm.writeFileSync(`${root}/${sheet.rel}`, src);
  }
  console.log(`removed ${removedRules} dead rules and ${trimmedSelectors} dead selectors from lists`);
}

// --check: guard rails for validate:all
if (process.argv.includes('--check')) {
  const fsm = await import('node:fs');
  const problems = [];
  if (deadSelectors.length) problems.push(`${deadSelectors.length} selector(s) can never match (run with --dead)`);
  const IMPORTANT_CEILING = 113;
  if (important > IMPORTANT_CEILING) problems.push(`!important count ${important} exceeds ${IMPORTANT_CEILING}; prefer specificity or a later stylesheet`);
  const patchNumbered = /(?<![\w-])(?:--)?tl\d{2,}-[a-z]/;
  for (const file of [...sheets.map((s) => s.rel), ...inventory.files]) {
    const text = fsm.readFileSync(`${root}/${file}`, 'utf8');
    const hit = patchNumbered.exec(text);
    if (hit) problems.push(`${file}: patch-numbered name '${text.slice(hit.index, hit.index + 24).split(/[\s"'{;:,)]/)[0]}' - use a purposeful name`);
  }
  if (problems.length) { for (const p of problems) console.error(`[FAIL] ${p}`); process.exit(1); }
  console.log(`[PASS] Global CSS: no dead selectors, no patch-numbered names, ${important} !important (ceiling ${IMPORTANT_CEILING}).`);
}
