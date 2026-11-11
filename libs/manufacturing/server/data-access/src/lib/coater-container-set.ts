import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  COATER_STAGING_LOCATION_SERIAL,
  DEPARTMENT_CUTTERGRIND,
  LOCATION_TYPE_STAGING,
  cuttergrindRoughShelfForPartType,
  isCoaterStagingLocation,
  parseCuttergrindRoughShelfTag,
} from '@meshforge/manufacturing/shared/util-constants';
import { BladeHistoryEvent, BladeStatus } from '@meshforge/manufacturing/shared/util-types';
import { BladeHistoryOrmEntity } from './database/entities/blade-tracking/blade-history.orm-entity';
import { BladeTrayOrmEntity } from './database/entities/blade-tracking/blade-tray.orm-entity';
import { LocationTrayOrmEntity } from './database/entities/blade-tracking/location-tray.orm-entity';
import { TrayStageOrmEntity } from './database/entities/blade-tracking/tray-stage.orm-entity';
import { TrayOrmEntity } from './database/entities/blade-tracking/tray.orm-entity';

/**
 * A coater container holds exactly one complete set: the ground blades of one Summary and
 * part type, moved out of their tray (which is then empty and reusable). The set row keeps
 * what the receiving tray needs back (Summary, part type, set size, grinding date) and where
 * the container sits until it ships. Additive only; legacy trays packed whole into a container
 * (container_tray) keep working until they are received.
 */
export const CONTAINER_SET_SCHEMA = `
  CREATE TABLE IF NOT EXISTS public.container_sets (
    id uuid PRIMARY KEY,
    container_id uuid NOT NULL REFERENCES public.containers(id),
    summary_id uuid NOT NULL REFERENCES public.part_summaries(id),
    part_type_id uuid NOT NULL REFERENCES public.part_types(id),
    required_blade_count integer NOT NULL CHECK (required_blade_count > 0),
    grinding_completed_at timestamptz NOT NULL,
    packed_from_tray_id uuid REFERENCES public.trays(id),
    location_id uuid REFERENCES public.locations(id),
    packed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    enabled boolean NOT NULL DEFAULT true,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    "deletedAt" timestamp,
    "createdBy" character varying,
    "updatedBy" character varying,
    "deletedBy" character varying
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_container_sets_active_container
    ON public.container_sets (container_id) WHERE enabled = true;
  CREATE INDEX IF NOT EXISTS ix_container_sets_location_enabled
    ON public.container_sets (location_id, enabled);
  CREATE TABLE IF NOT EXISTS public.container_set_blades (
    id uuid PRIMARY KEY,
    container_set_id uuid NOT NULL REFERENCES public.container_sets(id),
    blade_id uuid NOT NULL REFERENCES public.blades(id),
    enabled boolean NOT NULL DEFAULT true,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    "deletedAt" timestamp,
    "createdBy" character varying,
    "updatedBy" character varying,
    "deletedBy" character varying
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_container_set_blades_active_blade
    ON public.container_set_blades (blade_id) WHERE enabled = true;
  CREATE INDEX IF NOT EXISTS ix_container_set_blades_set_enabled
    ON public.container_set_blades (container_set_id, enabled, blade_id);
`;

/** The default place for ground blades waiting for the coater. Never renamed or re-routed if it exists. */
export const COATER_STAGING_SEED = {
  sql: `INSERT INTO public.locations (id, serial_number, number, description, department, location_type, enabled)
    VALUES ($1, $2, $2, 'Coater staging area: ground blades waiting to ship to the coater', $3, $4, true)
    ON CONFLICT (serial_number) DO NOTHING`,
  params: () => [randomUUID(), COATER_STAGING_LOCATION_SERIAL, DEPARTMENT_CUTTERGRIND, LOCATION_TYPE_STAGING],
};

export interface CoaterPlacement {
  id: string;
  serial_number: string;
  staging: boolean;
}

/**
 * Where a ground tray or packed container goes: the coater staging area by default, or a
 * rough shelf bin (CGRR-A1A / CGRP-A1A) of the blades' part type when one is scanned.
 */
export async function resolveCoaterPlacement(
  manager: EntityManager,
  scanned: string | null | undefined,
  partTypeCode: string,
): Promise<CoaterPlacement> {
  const serial = String(scanned ?? '').trim().toUpperCase() || COATER_STAGING_LOCATION_SERIAL;
  const [location] = await manager.query(
    `SELECT id, serial_number, department, location_type FROM public.locations
      WHERE serial_number = $1 AND enabled AND "deletedAt" IS NULL FOR SHARE`,
    [serial],
  );
  if (isCoaterStagingLocation(serial)) {
    if (!location) throw new UnprocessableEntityException(`${COATER_STAGING_LOCATION_SERIAL} is missing or disabled. Re-enable it in Admin > Locations.`);
    return { id: location.id, serial_number: location.serial_number, staging: true };
  }
  const shelf = parseCuttergrindRoughShelfTag(serial);
  const prefix = cuttergrindRoughShelfForPartType(partTypeCode) ?? 'CGRR/CGRP';
  if (!shelf || shelf.partTypeCode !== partTypeCode) {
    throw new UnprocessableEntityException(
      `Leave the location as ${COATER_STAGING_LOCATION_SERIAL}, or scan a ${prefix} rough shelf bin such as ${prefix}-A1A`,
    );
  }
  if (!location || location.location_type !== shelf.locationType || location.department !== shelf.department) {
    throw new UnprocessableEntityException(`${serial} is missing, disabled, or not a correctly configured rough shelf`);
  }
  return { id: location.id, serial_number: location.serial_number, staging: false };
}

export interface ContainerForPacking {
  id: string;
  serial_number: string;
}

/** An enabled container with nothing in it: no tray packed the old way and no blade set. */
export async function lockEmptyContainer(manager: EntityManager, scanned: string): Promise<ContainerForPacking> {
  const serial = String(scanned ?? '').trim().toUpperCase();
  if (!serial) throw new UnprocessableEntityException('Scan the coater container the blades go into');
  const [container] = await manager.query(
    `SELECT id, serial_number FROM public.containers
      WHERE serial_number = $1 AND enabled AND "deletedAt" IS NULL FOR UPDATE`,
    [serial],
  );
  if (!container) throw new NotFoundException(`Container ${serial} could not be found or is disabled`);
  const [{ trays, sets }] = await manager.query(
    `SELECT (SELECT count(*)::int FROM public.container_tray WHERE container_id = $1 AND enabled AND "deletedAt" IS NULL) AS trays,
            (SELECT count(*)::int FROM public.container_sets WHERE container_id = $1 AND enabled AND "deletedAt" IS NULL) AS sets`,
    [container.id],
  );
  if (trays || sets) {
    throw new ConflictException(`Container ${container.serial_number} already holds a set. A container takes one complete set.`);
  }
  return { id: container.id, serial_number: container.serial_number };
}

export interface PackSetInput {
  tray: TrayOrmEntity;
  container: ContainerForPacking;
  placement: CoaterPlacement;
  summaryId: string;
  partTypeId: string;
  requiredBladeCount: number;
  grindingCompletedAt: Date;
  userId: string;
}

/**
 * Move every blade of a full, ground tray into an empty container as one set, then reset the
 * tray to EMPTY. The caller has already checked the tray is complete and its blades are
 * READY_FOR_COATING; this re-checks the count so a set is never short or mixed.
 */
export async function packTrayIntoContainerSet(manager: EntityManager, input: PackSetInput): Promise<{ container_set_id: string; blade_count: number }> {
  const { tray, container, placement, userId } = input;
  const bladeTrayRepo = manager.getRepository(BladeTrayOrmEntity);
  const assignments = await bladeTrayRepo.find({
    where: { tray_id: tray.id, enabled: true },
    relations: { blade: true },
    order: { createdAt: 'ASC' },
  });
  if (assignments.length !== input.requiredBladeCount) {
    throw new ConflictException(`A container takes one complete set of ${input.requiredBladeCount}; tray ${tray.serial_number} holds ${assignments.length}`);
  }
  if (assignments.some(({ blade }) => !blade.enabled || blade.status !== BladeStatus.READY_FOR_COATING
    || blade.summary_id !== input.summaryId || blade.part_type_id !== input.partTypeId)) {
    throw new ConflictException(`Every blade in tray ${tray.serial_number} must be ground, ready for coating and match its Summary and part type`);
  }

  const setId = randomUUID();
  await manager.query(
    `INSERT INTO public.container_sets
      (id, container_id, summary_id, part_type_id, required_blade_count, grinding_completed_at,
       packed_from_tray_id, location_id, enabled, "createdBy", "updatedBy")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$9)`,
    [setId, container.id, input.summaryId, input.partTypeId, input.requiredBladeCount, input.grindingCompletedAt, tray.id, placement.id, userId],
  );
  await manager.query(
    `INSERT INTO public.container_set_blades (id, container_set_id, blade_id, enabled, "createdBy", "updatedBy")
     SELECT ids.id, $2, ids.blade_id, true, $3, $3 FROM unnest($1::uuid[], $4::uuid[]) AS ids(id, blade_id)`,
    [assignments.map(() => randomUUID()), setId, userId, assignments.map(({ blade }) => blade.id)],
  );

  const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
  await historyRepo.save(assignments.map(({ blade }) => historyRepo.create({
    blade_id: blade.id,
    event_type: BladeHistoryEvent.LOADED_TO_CONTAINER,
    from_status: blade.status,
    to_status: blade.status,
    service_cycle: blade.service_cycle ?? 0,
    tray_id: tray.id,
    container_id: container.id,
    notes: `Set moved from tray ${tray.serial_number} into container ${container.serial_number} at ${placement.serial_number}; not yet sent to coater`,
    createdBy: userId,
    updatedBy: userId,
  })));
  for (const assignment of assignments) {
    assignment.enabled = false;
    assignment.updatedBy = userId;
  }
  await bladeTrayRepo.save(assignments);

  await emptyTray(manager, tray, userId);
  return { container_set_id: setId, blade_count: assignments.length };
}

/** Back to the reusable empty pool: no blades, no Summary, no location. */
export async function emptyTray(manager: EntityManager, tray: TrayOrmEntity, userId: string): Promise<void> {
  const emptyStage = await manager.getRepository(TrayStageOrmEntity).findOne({ where: { code: 'EMPTY', enabled: true } });
  if (!emptyStage) throw new UnprocessableEntityException('EMPTY tray stage is not configured');
  await manager.getRepository(LocationTrayOrmEntity).update({ tray_id: tray.id, enabled: true }, { enabled: false, updatedBy: userId });
  tray.blade_count = 0;
  // Clear loaded relations too, or TypeORM would write their ids back.
  tray.summary_id = null;
  tray.summary = null;
  tray.part_type_id = null;
  tray.part_type = null;
  tray.grinding_completed_at = null;
  tray.required_blade_count = null;
  tray.current_grinding_machine_id = null;
  tray.grinding_machine = null;
  tray.current_stage_id = emptyStage.id;
  tray.current_stage = emptyStage;
  tray.updatedBy = userId;
  await manager.getRepository(TrayOrmEntity).save(tray);
}
