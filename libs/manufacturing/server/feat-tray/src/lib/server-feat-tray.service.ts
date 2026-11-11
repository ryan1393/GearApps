import { readInventoryAvailability, listEmptyBodyShelves, recordEmptyBodyShelf } from './inventory-availability';
import { cuttergrindRoughShelfForPartType, parseCuttergrindRoughShelfTag, isPendingGrindingStatus, trayWorkflowEligibility } from '@meshforge/manufacturing/shared/util-constants';
import { FindOptionsWhere, Not, Repository } from 'typeorm';

import { beginWorkflowJournal } from '@meshforge/manufacturing/server/data-access';
import { BladeHistoryOrmEntity, BladeOrmEntity, BladeTrayOrmEntity, CreateTrayDto, ContainerTrayOrmEntity, LocationOrmEntity, LocationTrayOrmEntity, CutterBladeRequirementOrmEntity, CutterBuildTrayOrmEntity, CutterPartTypeOrmEntity, InventoryListQueryDto, PaginationService, PartSummaryOrmEntity, TrayOrmEntity, TrayStageOrmEntity, TrayGrindingRunOrmEntity } from '@meshforge/manufacturing/server/data-access';
import { BladeHistoryEvent, BladeStatus, ITrayEntity, Uuid } from '@meshforge/manufacturing/shared/util-types';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { listTrays, loadTrayDashboard } from './tray.queries';

@Injectable()
export class ServerFeatTrayService extends PaginationService<TrayOrmEntity> {
  private readonly logger = new Logger(ServerFeatTrayService.name);

  constructor(
    @InjectRepository(TrayOrmEntity)
    private readonly trayRepo: Repository<TrayOrmEntity>,
    @InjectRepository(BladeTrayOrmEntity)
    private readonly bladeTrayRepo: Repository<BladeTrayOrmEntity>,
    @InjectRepository(CutterBladeRequirementOrmEntity)
    private readonly requirementRepo: Repository<CutterBladeRequirementOrmEntity>,
    @InjectRepository(PartSummaryOrmEntity)
    private readonly summaryRepo: Repository<PartSummaryOrmEntity>,
    @InjectRepository(CutterPartTypeOrmEntity)
    private readonly partTypeRepo: Repository<CutterPartTypeOrmEntity>,
  ) {
    super(TrayOrmEntity.prototype, trayRepo);
  }

  async findTray(find: FindOptionsWhere<TrayOrmEntity>): Promise<TrayOrmEntity | null> {
    return this.trayRepo.findOneBy(find);
  }

  async createTray(dto: CreateTrayDto, userId: Uuid): Promise<TrayOrmEntity> {
    const serialNumber = this.normalizeSequentialSerial('T', dto.serial_number, 'Tray');
    const duplicate = await this.trayRepo.findOne({ where: { serial_number: serialNumber } });
    if (duplicate) {
      throw new ConflictException(`Tray serial ${serialNumber} already exists`);
    }

    const emptyStage = await this.trayRepo.manager
      .getRepository(TrayStageOrmEntity)
      .findOne({ where: { code: 'EMPTY', enabled: true } });
    if (!emptyStage) {
      throw new UnprocessableEntityException('EMPTY tray stage is not configured');
    }

    const tray = this.trayRepo.create({
      ...dto,
      serial_number: serialNumber,
      blade_count: dto.blade_count ?? 0,
      current_stage_id: emptyStage.id,
      enabled: dto.enabled ?? true,
      createdBy: userId,
      updatedBy: userId,
    });
    await tray.save();
    return tray;
  }

  async getTrayBySerialNumber(serialNumber: string) {
    const tray = await this.trayRepo.findOne({
      where: { serial_number: serialNumber.trim().toUpperCase(), enabled: true },
      relations: { summary: true, part_type: true, current_stage: true },
    });
    if (!tray) throw new NotFoundException(`Tray ${serialNumber} could not be found`);
    return this.enrichTrayInventoryView(tray);
  }

  private async enrichTrayInventoryView(entity: TrayOrmEntity) {
    const [bladeAssignments, containerAssignment, locationAssignment, cutterAssignment] = await Promise.all([
      this.trayRepo.manager.getRepository(BladeTrayOrmEntity).find({
        where: { tray_id: entity.id, enabled: true },
        relations: { blade: { summary: true, part_type: true } },
        order: { createdAt: 'ASC' },
      }),
      this.trayRepo.manager.getRepository(ContainerTrayOrmEntity).findOne({
        where: { tray_id: entity.id, enabled: true }, relations: { container: true },
      }),
      this.trayRepo.manager.getRepository(LocationTrayOrmEntity).findOne({
        where: { tray_id: entity.id, enabled: true }, relations: { location: true },
      }),
      this.trayRepo.manager.getRepository(CutterBuildTrayOrmEntity).findOne({ where: { tray_id: entity.id, enabled: true } }),
    ]);
    const view = {
      ...entity.toJSON(),
      current_cutter_build: cutterAssignment ? { id: cutterAssignment.cutter_build_id } : null,
      blades: bladeAssignments.filter(({ blade }) => blade.enabled).map(({ blade }) => ({
        id: blade.id, serial_number: blade.serial_number, status: blade.status, service_cycle: blade.service_cycle,
        summary_number: blade.summary?.number ?? null, part_type_code: blade.part_type?.code ?? null,
      })),
      current_container: containerAssignment?.container ? { id: containerAssignment.container.id, serial_number: containerAssignment.container.serial_number } : null,
      current_location: locationAssignment?.location ? {
        id: locationAssignment.location.id, serial_number: locationAssignment.location.serial_number, number: locationAssignment.location.number,
        description: locationAssignment.location.description, department: locationAssignment.location.department, location_type: locationAssignment.location.location_type,
      } : null,
    };
    return { ...view, workflow_eligibility: trayWorkflowEligibility(view),
      pending_grinding_count: view.blades.filter(b => isPendingGrindingStatus(b.status)).length };
  }

  async getTray(trayId: Uuid) {
    return this.trayRepo.findOneOrFail({
      where: { id: trayId },
      relations: { summary: true, part_type: true, current_stage: true },
    });
  }

  async getTrays(
    query?: InventoryListQueryDto,
  ) {
    return listTrays(this.trayRepo, query);
  }

  async getDashboard() {
    return loadTrayDashboard(this.trayRepo);
  }

  async getInventoryAvailability(summaryId: Uuid, partTypeId: string | null) {
    return this.trayRepo.manager.transaction('REPEATABLE READ', manager => readInventoryAvailability(manager, summaryId, partTypeId));
  }

  async getEmptyBodyShelves() {
    return listEmptyBodyShelves(this.trayRepo.manager);
  }

  async placeEmptyBody(bodyIdentifier: string, shelfSerial: string | null, userId: Uuid, expectedPlacementId: string | null = null) {
    return this.trayRepo.manager.transaction('SERIALIZABLE', manager => recordEmptyBodyShelf(manager, bodyIdentifier, shelfSerial, userId, expectedPlacementId));
  }

  /**
   * Grinding completion is the point where quantity becomes enforced.
   * Before this call the tray can contain a variable blade count.
   *
   * The requirement is copied onto the tray as a snapshot so a future admin
   * configuration change does not silently alter an already-ground blade set.
   */
  async completeGrinding(
    trayId: Uuid,
    summaryId: Uuid,
    partTypeId: Uuid,
    scrappedBladeCount: number,
    userId: Uuid,
    roughShelfInput?: string | null,
  ) {
    return this.trayRepo.manager.transaction(async (manager) => {
      const trayRepo = manager.getRepository(TrayOrmEntity);
      const bladeTrayRepo = manager.getRepository(BladeTrayOrmEntity);
      const bladeRepo = manager.getRepository(BladeOrmEntity);
      const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
      const requirementRepo = manager.getRepository(CutterBladeRequirementOrmEntity);
      const summaryRepo = manager.getRepository(PartSummaryOrmEntity);
      const partTypeRepo = manager.getRepository(CutterPartTypeOrmEntity);
      const stageRepo = manager.getRepository(TrayStageOrmEntity);
      const grindingRunRepo = manager.getRepository(TrayGrindingRunOrmEntity);
      const locationRepo = manager.getRepository(LocationOrmEntity);
      const locationTrayRepo = manager.getRepository(LocationTrayOrmEntity);

      const tray = await trayRepo.findOne({
        where: { id: trayId, enabled: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tray) throw new NotFoundException('Tray not found or disabled');

      if (tray.grinding_completed_at) {
        throw new ConflictException('Grinding has already been completed for this tray');
      }

      const activeContainer = await manager
        .getRepository(ContainerTrayOrmEntity)
        .findOne({ where: { tray_id: tray.id, enabled: true } });
      if (activeContainer) {
        throw new ConflictException(
          'Grinding cannot be changed while the tray is loaded in a Coater container',
        );
      }

      const activeBuild = await manager.getRepository(CutterBuildTrayOrmEntity).findOne({ where: { tray_id: tray.id, enabled: true } });
      if (activeBuild) throw new ConflictException('Grinding cannot be changed while the tray is assigned to a cutter build');

      const [summary, partType, grindingStage, readyForCoatingStage] =
        await Promise.all([
          summaryRepo.findOne({ where: { id: summaryId, enabled: true } }),
          partTypeRepo.findOne({ where: { id: partTypeId, enabled: true } }),
          stageRepo.findOne({ where: { code: 'GRINDING', enabled: true } }),
          stageRepo.findOne({
            where: { code: 'READY_FOR_COATING', enabled: true },
          }),
        ]);
      if (!summary) throw new NotFoundException('Part summary not found or disabled');
      if (!partType) throw new NotFoundException('Part type not found or disabled');
      if (!grindingStage || !readyForCoatingStage) {
        throw new UnprocessableEntityException(
          'GRINDING / READY_FOR_COATING tray stages are not configured',
        );
      }
      if (tray.current_stage_id !== grindingStage.id) {
        throw new ConflictException(
          'Tray must be in GRINDING stage before grinding can be completed',
        );
      }

      if (tray.summary_id && tray.summary_id !== summaryId) {
        throw new ConflictException('Tray already contains blades for a different summary');
      }
      if (tray.part_type_id && tray.part_type_id !== partTypeId) {
        throw new ConflictException('Tray already contains blades for a different part type');
      }

      const requirement = await requirementRepo.findOne({
        where: { summary_id: summaryId, part_type_id: partTypeId, enabled: true },
      });
      if (!requirement) {
        throw new UnprocessableEntityException(
          'No enabled blade quantity requirement exists for this summary and part type',
        );
      }

      const activeAssignments = await bladeTrayRepo.find({
        where: { tray_id: tray.id, enabled: true },
        relations: { blade: true },
        order: { createdAt: 'ASC' },
      });
      const activeBladeCount = activeAssignments.length;
      const pendingAssignments = activeAssignments.filter(({ blade }) => isPendingGrindingStatus(blade.status));
      const previouslyReadyCount = activeAssignments.filter(({ blade }) => blade.status === BladeStatus.READY_FOR_COATING).length;
      const startingBladeCount = pendingAssignments.length;
      if (!startingBladeCount) throw new ConflictException('No pending blades in this grinding pass');
      if (!Number.isInteger(scrappedBladeCount) || scrappedBladeCount < 0) {
        throw new UnprocessableEntityException('Scrap quantity must be a non-negative integer');
      }

      if (tray.blade_count !== activeBladeCount) {
        throw new ConflictException(
          `Tray count is out of sync: tray shows ${tray.blade_count} but ${activeBladeCount} active blade assignments exist`,
        );
      }

      if (scrappedBladeCount > startingBladeCount) {
        throw new UnprocessableEntityException(
          `Scrapped blade count cannot exceed the ${startingBladeCount} blades that entered grinding`,
        );
      }

      const returnedBladeCount = startingBladeCount - scrappedBladeCount;

      const requiredBladeCount = tray.required_blade_count ?? requirement.required_blade_count;
      if (!Number.isInteger(requiredBladeCount) || requiredBladeCount <= 0) {
        throw new UnprocessableEntityException('A positive whole-number blade requirement is required before completing grinding');
      }
      const totalReturnedBladeCount = previouslyReadyCount + returnedBladeCount;
      if (totalReturnedBladeCount > requiredBladeCount) {
        throw new UnprocessableEntityException(
          `After scrap, tray would contain ${totalReturnedBladeCount} blades but the requirement is ${requiredBladeCount}`,
        );
      }

      const mismatchedBlade = activeAssignments.find(
        ({ blade }) =>
          !blade.enabled ||
          blade.summary_id !== summaryId ||
          blade.part_type_id !== partTypeId ||
          (!isPendingGrindingStatus(blade.status) && blade.status !== BladeStatus.READY_FOR_COATING),
      );
      if (mismatchedBlade) {
        throw new UnprocessableEntityException(
          'One or more blades do not match the tray Summary and Part Type',
        );
      }

      // Choose a physical slot, never an automatic department-wide shelf.
      // Lock its routing metadata until the same transaction records placement.
      let roughShelf: LocationOrmEntity | null = null;
      let roughShelfSerial: string | null = null;
      if (totalReturnedBladeCount === requiredBladeCount) {
        const shelfTag = parseCuttergrindRoughShelfTag(String(roughShelfInput ?? ''));
        const expectedPrefix = cuttergrindRoughShelfForPartType(partType.code);
        if (!shelfTag || shelfTag.partTypeCode !== partType.code) {
          throw new UnprocessableEntityException(
            `Scan or select the actual numbered ${expectedPrefix ?? 'CGRR/CGRP'}-### shelf before completing a full tray`,
          );
        }
        roughShelfSerial = shelfTag.serialNumber;
        roughShelf = await locationRepo.findOne({
          where: { serial_number: roughShelfSerial, enabled: true },
          lock: { mode: 'pessimistic_read' },
        });
        if (!roughShelf || roughShelf.location_type !== shelfTag.locationType || roughShelf.department !== shelfTag.department) {
          throw new UnprocessableEntityException(`${roughShelfSerial} is missing, disabled, or not a correctly configured rough shelf`);
        }
      } else if (String(roughShelfInput ?? '').trim()) {
        throw new UnprocessableEntityException('A short tray needs replacement blades and cannot be placed on a ready-for-coating shelf');
      }

      // Operators do not scan individual blades during grinding disposition.
      // We preserve count accuracy by deterministically dispositioning the last
      // N internal blade records as scrap; the physical workflow is count-based.
      const returnedAssignments = pendingAssignments.slice(0, returnedBladeCount);
      const scrappedAssignments = pendingAssignments.slice(returnedBladeCount);
      const completedAt = new Date();
      const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [tray.id] }, userId);

      for (const assignment of returnedAssignments) {
        const blade = assignment.blade;
        const previousStatus = blade.status;

        blade.status = BladeStatus.READY_FOR_COATING;
        blade.updatedBy = userId;

        await historyRepo.save(
          historyRepo.create({
            blade_id: blade.id,
            event_type: BladeHistoryEvent.STATUS_CHANGED,
            from_status: previousStatus,
            to_status: BladeStatus.READY_FOR_COATING,
            service_cycle: blade.service_cycle ?? 0,
            tray_id: tray.id,
            notes: 'Grinding completed; blade returned to tray',
            createdBy: userId,
            updatedBy: userId,
          }),
        );
      }

      for (const assignment of scrappedAssignments) {
        const blade = assignment.blade;
        const previousStatus = blade.status;

        assignment.enabled = false;
        assignment.updatedBy = userId;
        blade.status = BladeStatus.SCRAPPED;
        blade.updatedBy = userId;

        await historyRepo.save(
          historyRepo.create({
            blade_id: blade.id,
            event_type: BladeHistoryEvent.SCRAPPED,
            from_status: previousStatus,
            to_status: BladeStatus.SCRAPPED,
            service_cycle: blade.service_cycle ?? 0,
            tray_id: tray.id,
            notes: 'Scrapped during grinding',
            createdBy: userId,
            updatedBy: userId,
          }),
        );
      }

      await bladeRepo.save(pendingAssignments.map(({ blade }) => blade));
      if (scrappedAssignments.length) {
        await bladeTrayRepo.save(scrappedAssignments);
      }

      tray.summary_id = summaryId;
      tray.part_type_id = partTypeId;
      tray.grinding_completed_at = completedAt;
      tray.required_blade_count = requiredBladeCount;
      tray.current_stage_id = readyForCoatingStage.id;
      tray.current_stage = readyForCoatingStage;
      tray.blade_count = totalReturnedBladeCount;
      tray.updatedBy = userId;
      await trayRepo.save(tray);

      // Short trays leave any stale location; a full tray records only the selected slot.
      // Both changes are captured by the existing tray cancellation journal.
      await locationTrayRepo.update(
        { tray_id: tray.id, enabled: true },
        { enabled: false, updatedBy: userId },
      );
      if (roughShelf) {
        await locationTrayRepo.save(
          locationTrayRepo.create({
            tray_id: tray.id,
            location_id: roughShelf.id,
            enabled: true,
            createdBy: userId,
            updatedBy: userId,
          }),
        );
      }

      const grindingRun = await grindingRunRepo.save(
        grindingRunRepo.create({
          tray_id: tray.id,
          summary_id: summaryId,
          part_type_id: partTypeId,
          starting_blade_count: startingBladeCount,
          returned_blade_count: returnedBladeCount,
          scrapped_blade_count: scrappedBladeCount,
          required_blade_count: requiredBladeCount,
          completed_by_user_id: userId,
          completed_at: completedAt,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      await journal.commit(tray.serial_number, 'Complete grinding');
      return {
        tray,
        grinding_run_id: grindingRun.id,
        starting_blade_count: startingBladeCount,
        scrapped_blade_count: scrappedBladeCount,
        returned_blade_count: returnedBladeCount,
        required_blade_count: requiredBladeCount,
        active_blade_count: totalReturnedBladeCount,
        previously_ready_blade_count: previouslyReadyCount,
        blades_needed: Math.max(
          requiredBladeCount - totalReturnedBladeCount,
          0,
        ),
        complete: totalReturnedBladeCount === requiredBladeCount,
        rough_shelf_serial_number: roughShelfSerial,
      };
    });
  }


  async startGrinding(trayId: Uuid, userId: Uuid) {
    return this.trayRepo.manager.transaction(async (manager) => {
      const trayRepo = manager.getRepository(TrayOrmEntity);
      const bladeTrayRepo = manager.getRepository(BladeTrayOrmEntity);
      const bladeRepo = manager.getRepository(BladeOrmEntity);
      const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
      const stageRepo = manager.getRepository(TrayStageOrmEntity);
      const locationTrayRepo = manager.getRepository(LocationTrayOrmEntity);

      // Lock the base tray row WITHOUT joining nullable relations.
      // PostgreSQL rejects FOR UPDATE against the nullable side of an OUTER JOIN,
      // which TypeORM can generate when `relations` and a pessimistic lock are
      // combined in one findOne().
      const lockedTray = await trayRepo.findOne({
        where: { id: trayId, enabled: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedTray) throw new NotFoundException('Tray not found or disabled');

      const tray = await trayRepo.findOne({
        where: { id: lockedTray.id, enabled: true },
        relations: { current_stage: true },
      });
      if (!tray) throw new NotFoundException('Tray not found or disabled');

      const [containerLink, cutterLink] = await Promise.all([
        manager.getRepository(ContainerTrayOrmEntity).findOne({ where: { tray_id: tray.id, enabled: true } }),
        manager.getRepository(CutterBuildTrayOrmEntity).findOne({ where: { tray_id: tray.id, enabled: true } }),
      ]);
      if (containerLink || cutterLink) throw new ConflictException('Tray must be in house and unassigned before grinding');

      if (tray.current_stage?.code !== 'WAITING_FOR_GRINDING') {
        throw new ConflictException(
          'Only a tray waiting on the shelf for grinding can start grinding',
        );
      }

      const grindingStage = await stageRepo.findOne({
        where: { code: 'GRINDING', enabled: true },
      });
      if (!grindingStage) {
        throw new UnprocessableEntityException('GRINDING tray stage is not configured');
      }

      const assignments = await bladeTrayRepo.find({
        where: { tray_id: tray.id, enabled: true },
        relations: { blade: true },
      });
      if (!assignments.length) {
        throw new UnprocessableEntityException('Tray has no blades to grind');
      }

      const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [tray.id] }, userId);
      for (const assignment of assignments) {
        const blade = assignment.blade;
        if (blade.status !== BladeStatus.WAITING_FOR_GRINDING) {
          throw new UnprocessableEntityException(
            'Every blade must be waiting for grinding before this tray can start',
          );
        }
        const previousStatus = blade.status;
        blade.status = BladeStatus.RESHARPENING;
        blade.updatedBy = userId;
        await historyRepo.save(
          historyRepo.create({
            blade_id: blade.id,
            event_type: BladeHistoryEvent.STATUS_CHANGED,
            from_status: previousStatus,
            to_status: BladeStatus.RESHARPENING,
            service_cycle: blade.service_cycle ?? 0,
            tray_id: tray.id,
            notes: 'Tray pulled from shelf for grinding',
            createdBy: userId,
            updatedBy: userId,
          }),
        );
      }

      await bladeRepo.save(assignments.map(({ blade }) => blade));
      await locationTrayRepo.update(
        { tray_id: tray.id, enabled: true },
        { enabled: false, updatedBy: userId },
      );

      tray.grinding_completed_at = null;
      tray.required_blade_count = null;
      tray.current_stage_id = grindingStage.id;
      tray.current_stage = grindingStage;
      tray.updatedBy = userId;
      await trayRepo.save(tray);

      await journal.commit(tray.serial_number, 'Start grinding');
      return {
        tray_id: tray.id,
        tray_serial_number: tray.serial_number,
        blade_count: assignments.length,
        stage: grindingStage.code,
      };
    });
  }


  async getGrindingRuns(trayId: Uuid) {
    return this.trayRepo.manager
      .getRepository(TrayGrindingRunOrmEntity)
      .find({
        where: { tray_id: trayId },
        relations: {
          summary: true,
          part_type: true,
        },
        order: { completed_at: 'DESC' },
      });
  }

  async getReadiness(trayId: Uuid) {
    const entity = await this.getTray(trayId);
    const tray = await this.enrichTrayInventoryView(entity);
    const activeCount = tray.blades.length;
    const pending = tray.pending_grinding_count;
    return {
      tray_id: tray.id, tray_serial_number: tray.serial_number,
      grinding_complete: Boolean(tray.grinding_completed_at) && pending === 0,
      summary_id: tray.summary_id, part_type_id: tray.part_type_id,
      required_blade_count: tray.required_blade_count, active_blade_count: activeCount,
      pending_grinding_count: pending,
      blades_needed: tray.required_blade_count == null ? null : Math.max(tray.required_blade_count - activeCount, 0),
      // Quantity readiness is used beyond Coater Load (including Cutter Builder).
      // Keep it distinct from the stage-specific picker eligibility.
      complete: Boolean(tray.grinding_completed_at) && pending === 0 &&
        tray.required_blade_count != null && tray.required_blade_count > 0 &&
        activeCount === tray.required_blade_count && tray.blade_count === activeCount,
      workflow_eligibility: tray.workflow_eligibility,
    };
  }

  async updateTray(trayId: Uuid, data: Partial<ITrayEntity>, userId: Uuid) {
    await this.trayRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(TrayOrmEntity);
      const tray = await repo.findOneOrFail({ where: { id: trayId }, lock: { mode: 'pessimistic_write' } });
      const serialNumber = data.serial_number === undefined ? tray.serial_number : this.normalizeSequentialSerial('T', data.serial_number, 'Tray');
      if (data.enabled === false || serialNumber !== tray.serial_number) {
        const [bladeCount, containerCount, locationCount, buildCount] = await Promise.all([
          manager.getRepository(BladeTrayOrmEntity).count({ where: { tray_id: trayId, enabled: true } }),
          manager.getRepository(ContainerTrayOrmEntity).count({ where: { tray_id: trayId, enabled: true } }),
          manager.getRepository(LocationTrayOrmEntity).count({ where: { tray_id: trayId, enabled: true } }),
          manager.getRepository(CutterBuildTrayOrmEntity).count({ where: { tray_id: trayId, enabled: true } }),
        ]);
        if (tray.blade_count || bladeCount || containerCount || locationCount || buildCount) throw new ConflictException('Empty and unassign this tray through its workflow before renaming or disabling it');
      }
      if (serialNumber !== tray.serial_number && await repo.count({ where: { serial_number: serialNumber, id: Not(trayId) } })) throw new ConflictException(`Tray serial ${serialNumber} already exists`);
      tray.serial_number = serialNumber;
      if (data.enabled !== undefined) tray.enabled = data.enabled;
      tray.updatedBy = userId;
      await repo.save(tray);
    });
    return this.getTray(trayId);
  }

  private normalizeSequentialSerial(
    prefix: 'T' | 'C',
    input: string,
    label: string,
  ): string {
    const raw = input.trim().toUpperCase();
    const match = new RegExp(`^(?:${prefix})?0*([0-9]+)$`).exec(raw);
    if (!match) {
      throw new UnprocessableEntityException(
        `${label} serial must be ${prefix} followed by digits, for example ${prefix}0001`,
      );
    }
    const numeric = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(numeric) || numeric < 1) {
      throw new UnprocessableEntityException(
        `${label} serial sequence must be 1 or greater`,
      );
    }
    return `${prefix}${String(numeric).padStart(4, '0')}`;
  }

  async deleteTray(trayId: Uuid, userId: Uuid): Promise<void> {
    await this.updateTray(trayId, { enabled: false }, userId);
  }

}
