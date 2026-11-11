import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { cutterBodyMatchesRequirement, classifyTrayAvailabilityStage, resolveCutterBodyRule } from '@meshforge/manufacturing/shared/util-constants';
import { readSummaryBodyRule } from '@meshforge/manufacturing/server/data-access';

interface AvailabilityTrayRow {
  id: string; serial_number: string; part_type_code: string | null;
  blade_count: number; required_blade_count: number | null;
  location_serial: string | null; container_serial: string | null;
  stage_code: string; stage_name: string;
  grinding_completed_at: string | null; location_department: string | null; location_type: string | null;
}

interface BodyRow {
  id: string; dana_serial_number: string | null; mf_serial_number: string | null;
  blade_family_name: string | null; size_code: string | null; hand_code: string | null;
  blade_family_code: string | null; supplier_code: string | null; cutter_head_code: string | null; shelf_serial: string; last_increment: number;
  build_increment_at_placement: number; placement_id: string; placed_at: string;
  enabled: boolean; location_enabled: boolean; on_machine: boolean; occupied: boolean;
}
const serialOf = (body: {dana_serial_number: string | null; mf_serial_number: string | null}) => body.dana_serial_number || body.mf_serial_number || '';
// Only definition columns that were actually joined are passed; a body without a definition has none.
const bodyModel = (body: BodyRow) => ({ ...body, definition: {
  blade_family_name: body.blade_family_name, size_code: body.size_code, hand_code: body.hand_code,
  blade_family_code: body.blade_family_code, supplier_code: body.supplier_code, cutter_head_code: body.cutter_head_code,
} });
// Deliberately includes canceled/deleted build increments: a build invalidates the
// previous physical observation. Old build shelf rows NEVER represent empty bodies.
export const EMPTY_BODY_SHELVES_SQL = `
  SELECT body.id, body.dana_serial_number, body.mf_serial_number, body.enabled,
         d.blade_family_name, d.size_code, d.hand_code, d.blade_family_code, d.supplier_code, d.cutter_head_code,
         p.id AS placement_id, p.placed_at, p.build_increment_at_placement,
         l.serial_number AS shelf_serial, (l.enabled AND l."deletedAt" IS NULL AND l.location_type='SHELF') AS location_enabled,
         COALESCE((SELECT MAX(b.build_increment) FROM cutter_builds b WHERE b.cutter_body_id=body.id),0)::int AS last_increment,
         EXISTS (SELECT 1 FROM cutter_machine_runs mr JOIN cutter_builds b ON b.id=mr.cutter_build_id
                  WHERE b.cutter_body_id=body.id AND mr.enabled=true) AS on_machine,
         (EXISTS (SELECT 1 FROM cutter_builds b WHERE b.cutter_body_id=body.id AND b.completed_at IS NULL)
          OR EXISTS (SELECT 1 FROM cutter_build_blades bb JOIN cutter_builds b ON b.id=bb.cutter_build_id
                     WHERE b.cutter_body_id=body.id AND bb.enabled=true)) AS occupied
    FROM cutter_body_shelf_placements p
    JOIN cutter_bodies body ON body.id=p.cutter_body_id AND body."deletedAt" IS NULL
    JOIN locations l ON l.id=p.location_id
    LEFT JOIN cutter_body_definitions d ON d.id=body.definition_id
   WHERE p.enabled=true ORDER BY p.placed_at DESC, body.id`;

export function shelfObservationState(body: BodyRow): string {
  if (body.on_machine || body.occupied) return 'IN_USE';
  if (!body.enabled || !body.location_enabled) return 'DISABLED';
  if (Number(body.last_increment) !== Number(body.build_increment_at_placement)) return 'RECHECK_REQUIRED';
  return 'SHELVED';
}

export async function listEmptyBodyShelves(manager: EntityManager) {
  const rows: BodyRow[] = await manager.query(EMPTY_BODY_SHELVES_SQL);
  return rows.map(body => {
    const resolved = resolveCutterBodyRule(bodyModel(body));
    return {
      body_id: body.id, body_serial: serialOf(body), placement_id: body.placement_id,
      shelf_serial: body.shelf_serial, placed_at: body.placed_at,
      // blade_capacity keeps its existing unit (matched inner/outer sets).
      blade_capacity: resolved.rule?.blade_sets ?? null,
      blade_capacity_total_blades: resolved.rule?.total_blades ?? null,
      body_rule: resolved.rule?.code ?? null, body_rule_problem: resolved.problem,
      state: shelfObservationState(body),
    };
  });
}

/** One consistent database snapshot; distinct physical items, never history-row totals. */
export async function readInventoryAvailability(manager: EntityManager, summaryId: string, partTypeId: string | null) {
  const [summary] = await manager.query('SELECT id, number FROM part_summaries WHERE id=$1 AND enabled=true AND "deletedAt" IS NULL', [summaryId]);
  if (!summary) throw new NotFoundException('Part summary not found or disabled');
  const [partType] = partTypeId ? await manager.query('SELECT id, code FROM part_types WHERE id=$1 AND enabled=true AND "deletedAt" IS NULL', [partTypeId]) : [];
  if (partTypeId && !partType) throw new NotFoundException('Part type not found or disabled');
  const params = [summaryId, partTypeId];
  const trayRows: AvailabilityTrayRow[] = await manager.query(`
    SELECT t.id, t.serial_number, pt.code AS part_type_code,
      t.blade_count, t.required_blade_count,
      l.serial_number AS location_serial, c.serial_number AS container_serial,
      t.grinding_completed_at, l.department AS location_department, l.location_type,
      COALESCE(s.code,'UNKNOWN') AS stage_code, COALESCE(s.name,'Stage Needs Review') AS stage_name
      FROM trays t
      LEFT JOIN tray_stages s ON s.id=t.current_stage_id
      LEFT JOIN part_types pt ON pt.id=t.part_type_id
      LEFT JOIN location_tray lt ON lt.tray_id=t.id AND lt.enabled=true AND lt."deletedAt" IS NULL
      LEFT JOIN locations l ON l.id=lt.location_id AND l.enabled=true AND l."deletedAt" IS NULL
      LEFT JOIN container_tray ct ON ct.tray_id=t.id AND ct.enabled=true AND ct."deletedAt" IS NULL
      LEFT JOIN containers c ON c.id=ct.container_id AND c.enabled=true AND c."deletedAt" IS NULL
     WHERE t.enabled=true AND t."deletedAt" IS NULL AND t.summary_id=$1 AND ($2::text IS NULL OR t.part_type_id::text=$2::text)
     ORDER BY t.serial_number, t.id`, params);
  const configuredStages: Array<{code:string; name:string}> = await manager.query('SELECT code, name FROM tray_stages WHERE enabled=true AND "deletedAt" IS NULL ORDER BY sort_order,code');
  const stageNames = new Map(configuredStages.map(stage => [stage.code, stage.name]));
  stageNames.set('READY_FOR_COATING','Ready for Coating - Rough Shelf');
  stageNames.set('NEEDS_REPLACEMENT_BLADES','Needs Replacement Blades');
  stageNames.set('NEEDS_SHELF_PLACEMENT','Needs Shelf Placement');
  const counts = new Map<string, Set<string>>();
  // Return the exact physical rows used for each count, in the same transaction.
  // No second UI-side status/location classifier can diverge from the cards.
  const traysByStage = new Map<string, AvailabilityTrayRow[]>();
  const seen = new Set<string>();
  for (const rawRow of trayRows) {
    const stage = classifyTrayAvailabilityStage(rawRow);
    const row = { ...rawRow, stage_code: stage.code, stage_name: stage.name };
    if (seen.has(row.id)) throw new ConflictException('Conflicting active tray placements. Review inventory before using availability.');
    seen.add(row.id); stageNames.set(row.stage_code, row.stage_name);
    const set = counts.get(row.stage_code) ?? new Set<string>(); set.add(row.id); counts.set(row.stage_code,set);
    const trays = traysByStage.get(row.stage_code) ?? [];
    trays.push(row); traysByStage.set(row.stage_code, trays);
  }
  const ordered = ['WAITING_FOR_GRINDING','GRINDING','READY_FOR_COATING','PACKED_FOR_COATER','AT_COATER','READY_FOR_CUTTER','NEEDS_REPLACEMENT_BLADES','NEEDS_SHELF_PLACEMENT','EMPTY'];
  const stageCodes = [...new Set([...ordered, ...stageNames.keys()])];
  const requirements: Array<{part_type_id:string;part_type_code:string;required_blade_count:number}> = await manager.query(`
    SELECT r.part_type_id, pt.code AS part_type_code, r.required_blade_count
      FROM cutter_blade_requirements r JOIN part_types pt ON pt.id=r.part_type_id AND pt.enabled=true
     WHERE r.enabled=true AND r."deletedAt" IS NULL AND r.summary_id=$1 AND ($2::text IS NULL OR r.part_type_id::text=$2::text)
       AND r.required_blade_count>0 ORDER BY pt.code`, params);
  const withBlades: Array<{id:string}> = await manager.query(`
    SELECT DISTINCT body.id
      FROM cutter_bodies body
      JOIN cutter_builds b ON b.cutter_body_id=body.id AND b.completed_at IS NULL AND b."deletedAt" IS NULL
      JOIN cutter_build_locations bl ON bl.cutter_build_id=b.id AND bl.enabled=true AND bl.removed_at IS NULL AND bl."deletedAt" IS NULL
      JOIN locations l ON l.id=bl.location_id AND l.enabled=true AND l.location_type='SHELF' AND l."deletedAt" IS NULL
     WHERE body.enabled=true AND body."deletedAt" IS NULL AND b.summary_id=$1 AND ($2::text IS NULL OR b.part_type_id::text=$2::text)
       AND EXISTS (SELECT 1 FROM cutter_build_blades bb WHERE bb.cutter_build_id=b.id AND bb.enabled=true AND bb."deletedAt" IS NULL)
       AND NOT EXISTS (SELECT 1 FROM cutter_machine_runs mr JOIN cutter_builds mb ON mb.id=mr.cutter_build_id
                        WHERE mr.enabled=true AND mb.cutter_body_id=body.id)`, params);
  const emptyRows: BodyRow[] = await manager.query(EMPTY_BODY_SHELVES_SQL);
  const eligible = emptyRows.filter(body => shelfObservationState(body)==='SHELVED');
  const summaryRule = await readSummaryBodyRule(manager, summaryId);
  const empty = eligible.filter(body => requirements.some(req => cutterBodyMatchesRequirement(bodyModel(body), Number(req.required_blade_count), req.part_type_code, summaryRule)));
  const emptyIds = new Set(empty.map(body => body.id));
  const withIds = new Set(withBlades.map(body => body.id));
  // A corrupted body with both kinds of assignment must never inflate the totals.
  for (const id of withIds) emptyIds.delete(id);
  return {
    summary_id: summary.id, summary_number: summary.number,
    part_type_id: partType?.id ?? null, part_type_code: partType?.code ?? null,
    total_trays: seen.size,
    stages: stageCodes.map(code => ({
      code, name: stageNames.get(code) ?? code.replace(/_/g,' '), tray_count: counts.get(code)?.size ?? 0,
      trays: (traysByStage.get(code) ?? []).map(row => ({
        id: row.id, serial_number: row.serial_number, part_type_code: row.part_type_code,
        blade_count: Number(row.blade_count),
        required_blade_count: row.required_blade_count == null ? null : Number(row.required_blade_count),
        location_serial: row.location_serial, container_serial: row.container_serial,
      })),
    })),
    blade_requirements: requirements,
    shelved_cutter_bodies: { total: withIds.size+emptyIds.size, with_blades: withIds.size, empty: emptyIds.size },
    notes: [
      ...(!requirements.length ? ['No enabled blade requirement is configured for this selection; empty-body availability cannot be matched.'] : []),
      ...(eligible.some(body => resolveCutterBodyRule(bodyModel(body)).rule===null) ? ['Some recorded empty bodies have a missing, malformed or conflicting Dana S/N and are excluded.'] : []),
      'Empty bodies require a current shelf observation. After a build or cancellation, record their actual shelf again. Shared compatible bodies are counted once in this selection.',
    ],
  };
}

export async function recordEmptyBodyShelf(manager: EntityManager, identifier: string, locationSerial: string | null, userId: string, expectedPlacementId: string | null = null) {
  const serial = identifier.trim().toUpperCase();
  if (!serial) throw new BadRequestException('Scan a cutter body serial.');
  // The same body row lock is taken by createBuild; observations cannot race a new build.
  const bodies = await manager.query(`SELECT id,dana_serial_number,mf_serial_number,enabled FROM cutter_bodies
    WHERE "deletedAt" IS NULL AND (UPPER(dana_serial_number)=$1 OR UPPER(mf_serial_number)=$1) ORDER BY id FOR UPDATE`, [serial]);
  if (!bodies.length) throw new NotFoundException('Cutter body not found.');
  const body = bodies.find((b: {dana_serial_number:string|null}) => b.dana_serial_number?.toUpperCase()===serial) ?? (bodies.length===1 ? bodies[0] : null);
  if (!body) throw new ConflictException('Ambiguous manufacturer serial. Scan the Dana serial.');
  if (locationSerial === null) {
    const [current] = await manager.query('SELECT id FROM cutter_body_shelf_placements WHERE cutter_body_id=$1 AND enabled=true', [body.id]);
    if (!expectedPlacementId || current?.id !== expectedPlacementId) {
      throw new ConflictException('Shelf observation changed. Refresh the list before removing it.');
    }
  }
  let shelf: {id:string; serial_number:string} | undefined;
  if (locationSerial !== null) {
    if (!body.enabled) throw new UnprocessableEntityException('Disabled bodies cannot be placed into available inventory.');
    const [occupied] = await manager.query(`SELECT
      EXISTS (SELECT 1 FROM cutter_builds b WHERE b.cutter_body_id=$1 AND b.completed_at IS NULL) OR
      EXISTS (SELECT 1 FROM cutter_machine_runs mr JOIN cutter_builds b ON b.id=mr.cutter_build_id WHERE b.cutter_body_id=$1 AND mr.enabled=true) OR
      EXISTS (SELECT 1 FROM cutter_build_blades bb JOIN cutter_builds b ON b.id=bb.cutter_build_id WHERE b.cutter_body_id=$1 AND bb.enabled=true) AS occupied`, [body.id]);
    if (occupied?.occupied) throw new ConflictException('This body is in use. Finish its normal teardown before recording an empty-body shelf.');
    [shelf] = await manager.query(`SELECT id,serial_number FROM locations WHERE UPPER(serial_number)=$1 AND enabled=true AND location_type='SHELF' AND "deletedAt" IS NULL FOR SHARE`, [locationSerial.trim().toUpperCase()]);
    if (!shelf) throw new UnprocessableEntityException('Scan an enabled shelf location.');
  }
  const [latest] = await manager.query('SELECT COALESCE(MAX(build_increment),0)::int AS increment FROM cutter_builds WHERE cutter_body_id=$1', [body.id]);
  await manager.query('UPDATE cutter_body_shelf_placements SET enabled=false,removed_at=clock_timestamp(),removed_by=$2 WHERE cutter_body_id=$1 AND enabled=true', [body.id,userId]);
  if (shelf) await manager.query(`INSERT INTO cutter_body_shelf_placements
      (id,cutter_body_id,location_id,build_increment_at_placement,placed_by) VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(),body.id,shelf.id,latest.increment,userId]);
  return { body_id: body.id, body_serial: serialOf(body), shelf_serial: shelf?.serial_number ?? null, placed: Boolean(shelf) };
}
