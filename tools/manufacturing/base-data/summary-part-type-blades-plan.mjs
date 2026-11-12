// Plan for importing RING/PINION HOS, Inner blade and Outer blade from Blade sheet cope.xlsx
// Sheet2 (data/summary_part_type_blades.json). Pure functions; the apply script and tests use them.
//
// Recorded rules (Gear-Apps-Cutter-Body-Repair-Handoff-2026-11-11.txt, V43/V45/S9):
// - HOS comes straight from the source HOS column of that Summary + Part Type.
// - Label 1 / Label 2 are in source column order, not positions. The recorded placement (V43,
//   kept by V45 for every row except the corrected dual-IB PINION one) puts the one IB label in
//   Inner blade and the one OB label in Outer blade.
// - The dual-IB PINION row of 30538 is the confirmed V45 correction: Inner LH IB, Outer RH IB.
//   RH IB is kept exactly; it is not renamed.
// - Any other combination is left blank and reported; nothing is guessed from the other Part
//   Type or a nearby Summary.
// - Zero/blank rows and Summaries outside the approved master scope are skipped.
// - Totals in the sheet are not imported here (requirements have their own import).

const clean = (v) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' ').toUpperCase());

/** Summaries the handoffs place outside the approved master scope: never applied automatically. */
export const OUT_OF_SCOPE_SUMMARIES = Object.freeze({
  '30588': 'outside the approved master scope; its PINION example is valid but does not authorize applying it, and no 30588 RING mapping is established',
  '32414': 'outside the approved master scope and its source row is incomplete (zero)',
});

/** Confirmed positions that the IB/OB rule cannot give (V45 correction). */
export const CONFIRMED_POSITIONS = Object.freeze([
  { summary: '30538', part_type: 'PINION', labels: ['LH IB', 'RH IB'], inner: 'LH IB', outer: 'RH IB' },
  { summary: '30588', part_type: 'PINION', labels: ['LH IB', 'RH IB'], inner: 'LH IB', outer: 'RH IB' },
]);

/** Inner/Outer for one source row, with the basis, or blanks with the reason. */
export function placeLabels(summary, partType, label1, label2) {
  const labels = [clean(label1), clean(label2)].filter(Boolean);
  if (!labels.length) return { inner: null, outer: null, basis: 'no labels in source' };
  const confirmed = CONFIRMED_POSITIONS.find((c) => c.summary === clean(summary) && c.part_type === clean(partType) &&
    [...c.labels].sort().join('|') === [...labels].sort().join('|'));
  if (confirmed) return { inner: confirmed.inner, outer: confirmed.outer, basis: 'confirmed V45 position (Outer blade RH IB kept)' };
  const ib = labels.filter((l) => / IB$/.test(l));
  const ob = labels.filter((l) => / OB$/.test(l));
  if (labels.length === 2 && ib.length === 1 && ob.length === 1) {
    return { inner: ib[0], outer: ob[0], basis: 'recorded V43/V45 placement: the IB label is Inner, the OB label is Outer' };
  }
  return { inner: null, outer: null, basis: `positions not established for ${labels.join(' + ')}; left blank for review` };
}

/** One planned value set per source row, or the reason it is skipped. */
export function planSummaryPartTypeBlades(rows) {
  const planned = [];
  const skipped = [];
  const seen = new Set();
  for (const row of rows) {
    const summary = String(row.Summary ?? '').trim();
    const partType = clean(row.Part_Type_Code);
    const key = `${summary}\u0000${partType}`;
    if (!summary || !['RING', 'PINION'].includes(partType)) { skipped.push({ summary, part_type: partType, reason: 'invalid Summary or Part Type' }); continue; }
    if (seen.has(key)) { skipped.push({ summary, part_type: partType, reason: 'duplicate source row' }); continue; }
    seen.add(key);
    if (OUT_OF_SCOPE_SUMMARIES[summary]) { skipped.push({ summary, part_type: partType, reason: OUT_OF_SCOPE_SUMMARIES[summary] }); continue; }
    const hosRaw = clean(row.Raw_HOS);
    const hos = ['RH', 'LH'].includes(hosRaw) ? hosRaw : null;
    const place = placeLabels(summary, partType, row.Raw_Label_1, row.Raw_Label_2);
    if (!hos && !place.inner && !place.outer) {
      skipped.push({ summary, part_type: partType, reason: Number(row.Raw_Total_Blades) === 0 ? 'zero/blank source row (incomplete; existing values preserved)' : place.basis });
      continue;
    }
    planned.push({ summary, part_type: partType, hos, inner_blade: place.inner, outer_blade: place.outer, basis: place.basis, source: row.Source_Cells ?? null,
      hos_note: hosRaw && !hos ? `source HOS "${hosRaw}" is not RH or LH; left blank` : null });
  }
  return { planned, skipped };
}

/**
 * Merge a planned value set into the stored row: a blank stored field takes the source value;
 * a stored value that differs is kept (later edits win) and reported. Returns the next row,
 * whether it changes, and the kept differences.
 */
export function mergeIntoStored(stored, plan) {
  const next = { hos: stored?.hos ?? null, inner_blade: stored?.inner_blade ?? null, outer_blade: stored?.outer_blade ?? null };
  const kept = [];
  let changes = false;
  for (const field of ['hos', 'inner_blade', 'outer_blade']) {
    const value = plan[field];
    if (value == null) continue;
    if (next[field] == null) { next[field] = value; changes = true; } else if (next[field] !== value) kept.push(`${field}: kept ${next[field]} (source ${value})`);
  }
  return { next, changes, kept };
}
