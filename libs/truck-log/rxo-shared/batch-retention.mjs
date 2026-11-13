/** Retention for RXO batch directories (batches/, failed/).
 *
 * Keeps the newest `keepSuccessful` successful and newest `keepFailed` other
 * batch directories, never touches a protected name (the published/latest
 * batch, the running batch) and never follows symlinks. Batch ids sort
 * chronologically by name in both workers.
 *
 * Single source for both RXO worker images (copied into each src/lib).
 */
import fs from 'node:fs';
import path from 'node:path';

export function pruneBatchDirectories(dir, {
  keepSuccessful = 48,
  keepFailed = 20,
  isSuccessful = () => false,
  validName = () => true,
  protect = [],
  log = () => {},
} = {}) {
  if (!Number.isInteger(keepSuccessful) || keepSuccessful < 1 || !Number.isInteger(keepFailed) || keepFailed < 0) {
    throw new Error('Batch retention needs keepSuccessful >= 1 and keepFailed >= 0.');
  }
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return { removed: [], kept: [] }; throw error; }
  const protectedNames = new Set(protect.filter(Boolean));
  const names = entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && validName(entry.name))
    .map(entry => entry.name).sort().reverse();
  let successful = 0, failed = 0;
  const removed = [], kept = [];
  for (const name of names) {
    const full = path.join(dir, name);
    let ok = false;
    try { ok = Boolean(isSuccessful(name, full)); } catch { ok = false; }
    const keep = protectedNames.has(name) || (ok ? successful++ < keepSuccessful : failed++ < keepFailed);
    if (keep) { kept.push(name); continue; }
    try {
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(name);
    } catch (error) {
      log(`[RETENTION] Could not remove ${full}: ${error?.code || error?.message || error}`);
    }
  }
  if (removed.length) log(`[RETENTION] Removed ${removed.length} old batch director${removed.length === 1 ? 'y' : 'ies'} from ${dir}.`);
  return { removed, kept };
}
