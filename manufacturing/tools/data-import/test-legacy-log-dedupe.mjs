const rows = [
  { Log_ID:'15086', Build_ID:'G01764-31655', Check_ID:'9884', ToC_ID:'FC', Part_Count:'50', Emp_ID:'29', Date:'2026-08-24 00:07:30' },
  { Log_ID:'15087', Build_ID:'G01764-31655', Check_ID:'9884', ToC_ID:'FC', Part_Count:'50', Emp_ID:'29', Date:'2026-08-24 00:07:36' },
  { Log_ID:'15088', Build_ID:'G01764-31655', Check_ID:'9884', ToC_ID:'FC', Part_Count:'50', Emp_ID:'29', Date:'2026-08-24 00:07:38' },
  { Log_ID:'15089', Build_ID:'G01764-31655', Check_ID:'9884', ToC_ID:'FC', Part_Count:'50', Emp_ID:'29', Date:'2026-08-24 00:07:42' },
  { Log_ID:'15090', Build_ID:'G01764-31655', Check_ID:'9884', ToC_ID:'FC', Part_Count:'50', Emp_ID:'29', Date:'2026-08-24 00:07:43' },
];

const clean = (v) => (v == null ? null : String(v).trim() || null);
const upper = (v) => clean(v)?.toUpperCase() ?? null;
const fingerprint = (log) => JSON.stringify({
  Build_ID: clean(log.Build_ID),
  Check_ID: clean(log.Check_ID),
  ToC_ID: upper(log.ToC_ID),
  Part_Count: clean(log.Part_Count),
  Emp_ID: clean(log.Emp_ID),
});
const logTimestamp = (log) => {
  const ms = Date.parse(clean(log.Date));
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};

const fingerprints = new Set(rows.map(fingerprint));
if (fingerprints.size !== 1) throw new Error('FC|9884 should reconcile as one logical operation');

const ordered = [...rows].sort((a,b) => {
  const d = logTimestamp(a) - logTimestamp(b);
  return d || Number(a.Log_ID) - Number(b.Log_ID);
});
if (ordered[0].Log_ID !== '15086') throw new Error(`Expected earliest Log_ID 15086, got ${ordered[0].Log_ID}`);
if (ordered.slice(1).length !== 4) throw new Error('Expected four archived duplicate source log rows');

const conflicting = [...rows];
conflicting[4] = {...conflicting[4], Part_Count:'51'};
if (new Set(conflicting.map(fingerprint)).size === 1) {
  throw new Error('A real business-field conflict must remain fatal');
}

console.log('[PASS] Legacy FC|9884 duplicate-log regression test passed.');
console.log({ kept_log_id: ordered[0].Log_ID, archived_duplicates: ordered.slice(1).map(r => r.Log_ID) });
