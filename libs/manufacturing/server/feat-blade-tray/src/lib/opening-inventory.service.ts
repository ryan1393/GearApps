import { randomUUID } from 'crypto';
import {
  ConflictException, Injectable, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import {
  beginWorkflowJournal, BladeHistoryOrmEntity, BladeOrmEntity, BladeTrayOrmEntity, ContainerTrayOrmEntity,
  CutterBladeRequirementOrmEntity, CutterBuildTrayOrmEntity, CutterPartTypeOrmEntity, LocationOrmEntity,
  LocationTrayOrmEntity, PartSummaryOrmEntity, TrayOrmEntity, TrayStageOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import {
  COATER_STAGING_LOCATION_SERIAL, DEPARTMENT_CUTTERGRIND, isCoaterStagingLocation, parseCuttergrindNumberedShelfTag, parseCuttergrindRoughShelfTag,
} from '@meshforge/manufacturing/shared/util-constants';
import { BladeHistoryEvent, BladeStatus, Uuid } from '@meshforge/manufacturing/shared/util-types';

/** Where a tray that already exists on the floor stands when the system goes live. */
export const OPENING_STAGES = ['READY_FOR_COATING', 'READY_FOR_CUTTER'] as const;
export type OpeningStage = (typeof OPENING_STAGES)[number];

export class OpeningInventoryDto {
  @IsString() @MinLength(1) @MaxLength(80) tray_serial_number!: string;
  @IsUUID() summary_id!: string;
  @IsUUID() part_type_id!: string;
  @IsIn(OPENING_STAGES) stage!: OpeningStage;
  @IsString() @MinLength(1) @MaxLength(80) shelf_serial_number!: string;
  /** Times these blades have already been reground, when known. */
  @IsOptional() @IsInt() @Min(0) @Max(99) service_cycle?: number;
}

const NOTE = 'Opening inventory: recorded as found when the system went live';

/**
 * Records a tray that is already ground or already coated on the day the system goes live,
 * without replaying grinding and coater history that was never captured.
 *
 * The tray ends in exactly the state the normal workflow leaves it in: a full tray of blades in
 * the matching status, at the matching stage, on a shelf the workflow itself would accept. Blades
 * still to be ground go through Blade Intake instead. The entry is journaled, so Cancel Last
 * undoes it like any other step.
 */
@Injectable()
export class OpeningInventoryService {
  constructor(@InjectDataSource() private readonly source: DataSource) {}

  async record(dto: OpeningInventoryDto, userId: Uuid, preview = false) {
    const serial = dto.tray_serial_number.trim().toUpperCase();
    const shelfSerial = dto.shelf_serial_number.trim().toUpperCase();
    return this.source.transaction(async (manager) => {
      const trayRepo = manager.getRepository(TrayOrmEntity);
      const stageRepo = manager.getRepository(TrayStageOrmEntity);
      const tray = await trayRepo.findOne({ where: { serial_number: serial, enabled: true }, lock: { mode: 'pessimistic_write' } });
      if (!tray) throw new NotFoundException(`Tray ${serial} was not found. Create and tag it first.`);

      const [inContainer, inBuild, assigned, currentStage] = await Promise.all([
        manager.getRepository(ContainerTrayOrmEntity).findOne({ where: { tray_id: tray.id, enabled: true } }),
        manager.getRepository(CutterBuildTrayOrmEntity).findOne({ where: { tray_id: tray.id, enabled: true } }),
        manager.getRepository(BladeTrayOrmEntity).count({ where: { tray_id: tray.id, enabled: true } }),
        tray.current_stage_id ? stageRepo.findOne({ where: { id: tray.current_stage_id } }) : null,
      ]);
      if (inContainer || inBuild || assigned > 0 || tray.blade_count !== 0 || (currentStage && currentStage.code !== 'EMPTY')) {
        throw new ConflictException(`Tray ${serial} already has contents or is in use. Opening inventory is only for an empty tray.`);
      }

      const [summary, partType] = await Promise.all([
        manager.getRepository(PartSummaryOrmEntity).findOne({ where: { id: dto.summary_id, enabled: true } }),
        manager.getRepository(CutterPartTypeOrmEntity).findOne({ where: { id: dto.part_type_id, enabled: true } }),
      ]);
      if (!summary) throw new NotFoundException('Part summary not found or disabled');
      if (!partType || !['RING', 'PINION'].includes(partType.code)) throw new NotFoundException('Choose the RING or PINION part type');
      const requirement = await manager.getRepository(CutterBladeRequirementOrmEntity).findOne({
        where: { summary_id: dto.summary_id, part_type_id: dto.part_type_id, enabled: true },
      });
      if (!requirement) {
        throw new UnprocessableEntityException('No enabled blade quantity requirement exists for this summary and part type');
      }

      // The same places the workflow accepts for this stage: the coater staging area or a rough
      // shelf bin (CGRR-A1A) after grinding, a finished shelf bin (CGFR-A1A) after coating.
      const staging = dto.stage === 'READY_FOR_COATING' && isCoaterStagingLocation(shelfSerial);
      const shelfTag = dto.stage === 'READY_FOR_COATING'
        ? parseCuttergrindRoughShelfTag(shelfSerial)
        : parseCuttergrindNumberedShelfTag(shelfSerial);
      const prefix = dto.stage === 'READY_FOR_COATING'
        ? (partType.code === 'RING' ? 'CGRR' : 'CGRP')
        : (partType.code === 'RING' ? 'CGFR' : 'CGFP');
      if (!staging && (!shelfTag || shelfTag.partTypeCode !== partType.code
        || (dto.stage === 'READY_FOR_CUTTER' && shelfTag.kind !== 'CUTTERGRIND_FINISHED'))) {
        throw new UnprocessableEntityException(dto.stage === 'READY_FOR_COATING'
          ? `A ${partType.code} tray at this stage belongs at ${COATER_STAGING_LOCATION_SERIAL} or on a ${prefix} shelf addressed by shelf, layer and bin, such as ${prefix}-A1A`
          : `A ${partType.code} tray at this stage belongs on a ${prefix} shelf addressed by shelf, layer and bin, such as ${prefix}-A1A`);
      }
      const placeSerial = staging ? COATER_STAGING_LOCATION_SERIAL : shelfTag!.serialNumber;
      const shelf = await manager.getRepository(LocationOrmEntity).findOne({
        where: { serial_number: placeSerial, enabled: true }, lock: { mode: 'pessimistic_read' },
      });
      if (!shelf || shelf.department !== DEPARTMENT_CUTTERGRIND || (!staging && shelf.location_type !== shelfTag!.locationType)) {
        throw new UnprocessableEntityException(`${placeSerial} is missing, disabled, or not set up correctly. Check it in Admin > Locations.`);
      }
      const stage = await stageRepo.findOne({ where: { code: dto.stage, enabled: true } });
      if (!stage) throw new UnprocessableEntityException(`${dto.stage} tray stage is not configured`);

      const status = dto.stage === 'READY_FOR_COATING' ? BladeStatus.READY_FOR_COATING : BladeStatus.RETURNED_FROM_COATING;
      const serviceCycle = dto.service_cycle ?? 0;
      const quantity = requirement.required_blade_count;
      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        throw new UnprocessableEntityException('The blade quantity requirement must be a positive whole number');
      }
      const result = {
        tray_id: tray.id, tray_serial_number: tray.serial_number, summary_number: summary.number, part_type_code: partType.code,
        stage_code: stage.code, stage_name: stage.name, shelf_serial_number: shelf.serial_number, blade_count: quantity,
      };
      // Preview uses the same checks as commit. Commit always rechecks under the tray lock.
      if (preview) return result;
      const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [tray.id] }, userId);
      const bladeRepo = manager.getRepository(BladeOrmEntity);
      const assignmentRepo = manager.getRepository(BladeTrayOrmEntity);
      const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
      for (let index = 0; index < quantity; index += 1) {
        const blade = await bladeRepo.save(bladeRepo.create({
          summary_id: dto.summary_id, serial_number: `UNLABELED-${randomUUID()}`, part_type_id: dto.part_type_id,
          status, service_cycle: serviceCycle, enabled: true, createdBy: userId, updatedBy: userId,
        }));
        await assignmentRepo.save(assignmentRepo.create({ blade_id: blade.id, tray_id: tray.id, enabled: true, createdBy: userId, updatedBy: userId }));
        await historyRepo.save([
          historyRepo.create({ blade_id: blade.id, event_type: BladeHistoryEvent.CREATED, from_status: null, to_status: status,
            service_cycle: serviceCycle, notes: NOTE, createdBy: userId, updatedBy: userId }),
          historyRepo.create({ blade_id: blade.id, event_type: BladeHistoryEvent.ASSIGNED_TO_TRAY, service_cycle: serviceCycle,
            tray_id: tray.id, createdBy: userId, updatedBy: userId }),
        ]);
      }

      tray.summary_id = dto.summary_id;
      tray.part_type_id = dto.part_type_id;
      tray.required_blade_count = quantity;
      tray.grinding_completed_at = new Date();
      tray.current_grinding_machine_id = null;
      tray.current_stage_id = stage.id;
      tray.current_stage = stage;
      tray.blade_count = quantity;
      tray.updatedBy = userId;
      await trayRepo.save(tray);

      const placementRepo = manager.getRepository(LocationTrayOrmEntity);
      await placementRepo.update({ tray_id: tray.id, enabled: true }, { enabled: false, updatedBy: userId });
      await placementRepo.save(placementRepo.create({ tray_id: tray.id, location_id: shelf.id, enabled: true, createdBy: userId, updatedBy: userId }));

      await journal.commit(tray.serial_number, `Opening inventory: ${quantity} blades, ${stage.name}, shelf ${shelf.serial_number}`);
      return result;
    });
  }
}
