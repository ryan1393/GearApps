import { createHash } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { CoaterManifest, CoaterShipmentTray } from '@gearapps/manufacturing/shared/util-types';
import { parseCuttergrindRoughShelfTag, DEPARTMENT_CUTTERGRIND } from '@gearapps/manufacturing/shared/util-constants';

export function coaterContentHash(destination: string, notes: string, manifest: CoaterManifest): string {
  // PostgreSQL jsonb may reorder object keys. Sort keys recursively so storing a
  // document cannot itself invalidate its review/print revision.
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(canonical({ destination, notes, manifest }))).digest('hex');
}

/** All physical associations, including invalid/disabled children, are inspected.
 * A bad child must block its container rather than disappearing from the slip. */
export async function readCoaterManifest(manager: EntityManager, ids: string[]): Promise<CoaterManifest> {
  const result: CoaterManifest = { containers: [], totals: { containers: 0, trays: 0, blades: 0 }, summary: [], issues: [] };
  if (!ids.length) { result.issues.push('Scan at least one packed container.'); return result; }
  const containers = await manager.query(`SELECT id,serial_number,enabled,"deletedAt" FROM containers
    WHERE id::text=ANY($1::text[]) ORDER BY serial_number,id`, [ids]);
  const trays = await manager.query(`SELECT ct.id AS assignment_id,ct.container_id,ct.packed_at,
    t.id,t.serial_number,t.enabled,t."deletedAt",t.summary_id,t.part_type_id,
    t.blade_count,t.required_blade_count,t.grinding_completed_at,
    ps.number AS summary,ps.enabled AS summary_enabled,ps."deletedAt" AS summary_deleted,
    pt.code AS part_type,pt.enabled AS type_enabled,pt."deletedAt" AS type_deleted,
    s.code AS stage,s.enabled AS stage_enabled,s."deletedAt" AS stage_deleted,
    l.serial_number AS rough_shelf,l.enabled AS shelf_enabled,l."deletedAt" AS shelf_deleted,
    l.department AS shelf_department,l.location_type AS shelf_type,
    (SELECT count(*)::int FROM container_tray c2 WHERE c2.tray_id=t.id AND c2.enabled AND c2."deletedAt" IS NULL) AS container_links,
    (SELECT count(*)::int FROM location_tray lt WHERE lt.tray_id=t.id AND lt.enabled AND lt."deletedAt" IS NULL) AS shelf_links,
    (SELECT count(*)::int FROM cutter_build_trays cb WHERE cb.tray_id=t.id AND cb.enabled AND cb."deletedAt" IS NULL) AS cutter_links
    FROM container_tray ct LEFT JOIN trays t ON t.id=ct.tray_id
    LEFT JOIN part_summaries ps ON ps.id=t.summary_id LEFT JOIN part_types pt ON pt.id=t.part_type_id
    LEFT JOIN tray_stages s ON s.id=t.current_stage_id LEFT JOIN locations l ON l.id=ct.packed_from_location_id
    WHERE ct.container_id::text=ANY($1::text[]) AND ct.enabled AND ct."deletedAt" IS NULL
    ORDER BY t.serial_number,ct.id`, [ids]);
  const trayIds = trays.map((t: any) => t.id).filter(Boolean);
  const blades = trayIds.length ? await manager.query(`SELECT bt.tray_id,b.id,b.serial_number,b.status,b.service_cycle,
    b.enabled,b."deletedAt",b.summary_id,b.part_type_id,
    (SELECT count(*)::int FROM blade_tray b2 WHERE b2.blade_id=b.id AND b2.enabled AND b2."deletedAt" IS NULL) AS tray_links,
    (SELECT count(*)::int FROM cutter_build_blades cb WHERE cb.blade_id=b.id AND cb.enabled AND cb."deletedAt" IS NULL) AS cutter_links
    FROM blade_tray bt LEFT JOIN blades b ON b.id=bt.blade_id
    WHERE bt.tray_id::text=ANY($1::text[]) AND bt.enabled AND bt."deletedAt" IS NULL
    ORDER BY b.serial_number,bt.id`, [trayIds]) : [];
  const summary = new Map<string, { summary: string; part_type: string; trays: number; blades: number }>();
  for (const container of containers) {
    const item = { id: String(container.id), serial: String(container.serial_number), trays: [] as CoaterShipmentTray[], issues: [] as string[] };
    if (!container.enabled || container.deletedAt) item.issues.push('Container is disabled or deleted.');
    const children = trays.filter((t: any) => t.container_id === container.id);
    if (!children.length) item.issues.push('Container is empty.');
    for (const t of children) {
      const label = t.serial_number || 'Unidentified tray';
      const fail = (message: string) => item.issues.push(`${label}: ${message}`);
      if (!t.id || !t.enabled || t.deletedAt) fail('tray is missing, disabled or deleted.');
      if (t.stage !== 'PACKED_FOR_COATER' || !t.stage_enabled || t.stage_deleted) fail('tray is not packed for a new outbound shipment.');
      if (!t.summary || !t.summary_enabled || t.summary_deleted || !['RING','PINION'].includes(t.part_type) || !t.type_enabled || t.type_deleted) fail('Summary or Part Type is invalid or disabled.');
      const shelf = parseCuttergrindRoughShelfTag(t.rough_shelf || '');
      if (!t.packed_at || !shelf || shelf.partTypeCode !== t.part_type || !t.shelf_enabled || t.shelf_deleted || t.shelf_department !== DEPARTMENT_CUTTERGRIND || t.shelf_type !== 'SHELF') fail('verified numbered rough-shelf packing record is missing or invalid.');
      if (!t.grinding_completed_at || !Number.isInteger(t.required_blade_count) || t.required_blade_count <= 0 || t.blade_count !== t.required_blade_count) fail('grinding or the required blade quantity is incomplete.');
      if (t.container_links !== 1 || t.shelf_links !== 0 || t.cutter_links !== 0) fail('conflicting inventory assignments need review.');
      const assigned = blades.filter((b: any) => b.tray_id === t.id);
      if (assigned.length !== t.blade_count || new Set(assigned.map((b: any) => b.id)).size !== assigned.length) fail('blade count or identity does not match the tray.');
      if (assigned.some((b: any) => !b.id || !b.enabled || b.deletedAt || b.status !== 'ready_for_coating' || b.summary_id !== t.summary_id || b.part_type_id !== t.part_type_id || b.tray_links !== 1 || b.cutter_links !== 0)) fail('every blade must be available, ready for coating and match the tray.');
      const row: CoaterShipmentTray = { id: t.id, assignment_id: t.assignment_id, serial: label, summary: t.summary || 'Unassigned', part_type: t.part_type || 'Unknown', count: t.blade_count || 0, required: t.required_blade_count, rough_shelf: t.rough_shelf || '', blades: assigned.map((b: any) => ({ id: b.id, serial: b.serial_number || 'Unknown', status: b.status, cycle: b.service_cycle })) };
      item.trays.push(row);
      result.totals.trays++;
      result.totals.blades += assigned.length;
      const key = JSON.stringify([row.summary,row.part_type]);
      const total = summary.get(key) ?? { summary: row.summary, part_type: row.part_type, trays: 0, blades: 0 };
      total.trays++; total.blades += assigned.length; summary.set(key,total);
    }
    result.containers.push(item);
    result.issues.push(...item.issues.map(message => `${item.serial}: ${message}`));
  }
  if (containers.length !== ids.length) result.issues.push('A selected container no longer exists.');
  result.totals.containers = result.containers.length;
  result.summary = [...summary.values()].sort((a,b) => a.summary.localeCompare(b.summary) || a.part_type.localeCompare(b.part_type));
  return result;
}
