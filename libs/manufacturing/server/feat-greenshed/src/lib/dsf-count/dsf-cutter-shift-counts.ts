import { dsfCutterCountsEnabled } from '@gearapps/manufacturing/server/util-common';
import { DataSource } from 'typeorm';

/**
 * Pieces DSF has credited to each cutter run in the shift that starts at `shiftStart`, keyed by
 * run id. Returns null when DSF cutter crediting is off or its ledger does not exist, so the
 * caller keeps its own counts.
 */
export async function loadDsfCutterShiftCounts(
  dataSource: DataSource,
  shiftStart: string,
  machineIds: string[],
): Promise<Map<string, number> | null> {
  if (!dsfCutterCountsEnabled() || dataSource.options.type !== 'postgres') return null;
  const ready = await dataSource.query(
    `SELECT to_regclass('public.dana_dsf_cutter_run_shifts_v1') IS NOT NULL AS ready`,
  ) as Array<{ ready: boolean }>;
  if (ready[0]?.ready !== true) return null;
  const counts = new Map<string, number>();
  if (!machineIds.length) return counts;
  const rows = await dataSource.query(
    `SELECT run_id::text AS run_id, source_count
       FROM public.dana_dsf_cutter_run_shifts_v1
      WHERE shift_start = $1::timestamptz AND machine_id = ANY($2::uuid[])`,
    [shiftStart, machineIds],
  ) as Array<{ run_id: string; source_count: number | string }>;
  for (const row of rows) {
    const count = Number(row.source_count);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid DSF cutter shift count');
    counts.set(row.run_id, count);
  }
  return counts;
}
