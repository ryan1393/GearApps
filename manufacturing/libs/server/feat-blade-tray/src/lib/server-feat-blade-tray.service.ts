import { randomUUID } from 'crypto';
import { isPendingGrindingStatus } from '@gearapps/manufacturing/shared/util-constants';
import { FindOptionsWhere, Repository } from 'typeorm';

import { beginWorkflowJournal } from '@gearapps/manufacturing/server/data-access';
import {
  BladeHistoryOrmEntity,
  BladeOrmEntity,
  BladeTrayOrmEntity,
  ContainerTrayOrmEntity,
  CreateBladeBatchDto,
  CreateBladeTrayDto,
  CutterBuildTrayOrmEntity,
  CutterBuildBladeOrmEntity,
  CutterPartTypeOrmEntity,
  PaginationOptionsDto,
  PaginationService,
  PartSummaryOrmEntity,
  TrayOrmEntity,
  TrayStageOrmEntity,
  LocationTrayOrmEntity,
} from '@gearapps/manufacturing/server/data-access';
import {
  BladeHistoryEvent,
  BladeStatus,
  IBladeTray,
  IBladeTrayEntity,
  IPaginatedResponse,
  Uuid,
} from '@gearapps/manufacturing/shared/util-types';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';

@Injectable()
export class ServerFeatBladeTrayService extends PaginationService<BladeTrayOrmEntity> {
  private readonly logger = new Logger(ServerFeatBladeTrayService.name);

  constructor(
    @InjectRepository(BladeTrayOrmEntity)
    private readonly bladeTrayRepo: Repository<BladeTrayOrmEntity>,
  ) {
    super(BladeTrayOrmEntity.prototype, bladeTrayRepo);
  }

  async findBladeTray(
    find: FindOptionsWhere<BladeTrayOrmEntity>,
  ): Promise<BladeTrayOrmEntity | null> {
    return this.bladeTrayRepo.findOneBy(find);
  }

  async createBladeBatch(dto: CreateBladeBatchDto, userId: Uuid) {
    if (!Number.isInteger(dto.quantity) || dto.quantity < 1 || dto.quantity > 500) {
      throw new UnprocessableEntityException('Batch quantity must be an integer from 1 to 500');
    }
    const status = dto.status ?? BladeStatus.NEW;
    if (
      status !== BladeStatus.NEW &&
      status !== BladeStatus.GRINDING &&
      status !== BladeStatus.WAITING_FOR_GRINDING
    ) {
      throw new UnprocessableEntityException(
        'A new blade batch must start NEW, GRINDING, or DULL (waiting for grinding); record grinding before coating',
      );
    }
    return this.bladeTrayRepo.manager.transaction(async (manager) => {
      const bladeRepo = manager.getRepository(BladeOrmEntity);
      const assignmentRepo = manager.getRepository(BladeTrayOrmEntity);
      const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
      const trayRepo = manager.getRepository(TrayOrmEntity);
      const summaryRepo = manager.getRepository(PartSummaryOrmEntity);
      const partTypeRepo = manager.getRepository(CutterPartTypeOrmEntity);
      const stageRepo = manager.getRepository(TrayStageOrmEntity);

      const tray = await trayRepo.findOne({
        where: { id: dto.tray_id, enabled: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tray) throw new NotFoundException('Tray not found or disabled');

      const [activeContainer, activeCutterBuild] = await Promise.all([
        manager
          .getRepository(ContainerTrayOrmEntity)
          .findOne({ where: { tray_id: tray.id, enabled: true } }),
        manager
          .getRepository(CutterBuildTrayOrmEntity)
          .findOne({ where: { tray_id: tray.id, enabled: true } }),
      ]);
      if (activeContainer) {
        throw new ConflictException(
          'Tray contents cannot be changed while the tray is loaded in a Coater container',
        );
      }
      if (activeCutterBuild) {
        throw new ConflictException(
          'Tray contents cannot be changed while the tray is assigned to a cutter build',
        );
      }

      const [summary, partType] = await Promise.all([
        summaryRepo.findOne({ where: { id: dto.summary_id, enabled: true } }),
        partTypeRepo.findOne({ where: { id: dto.part_type_id, enabled: true } }),
      ]);
      if (!summary) throw new NotFoundException('Part summary not found or disabled');
      if (!partType) throw new NotFoundException('Part type not found or disabled');

      const activeAssignments = await assignmentRepo.find({
        where: { tray_id: tray.id, enabled: true },
        relations: { blade: true },
      });
      const existingCount = activeAssignments.length;
      if (existingCount > 0 && status === BladeStatus.WAITING_FOR_GRINDING) {
        throw new UnprocessableEntityException('Dull intake must begin with an empty tray. Use NEW or GRINDING when adding replacement blades to an existing tray.');
      }
      if (tray.blade_count !== existingCount) {
        throw new ConflictException('Tray count differs from its active blade assignments; refresh inventory before adding');
      }
      const currentStage = tray.current_stage_id
        ? await stageRepo.findOne({ where: { id: tray.current_stage_id, enabled: true } })
        : null;
      if (!currentStage || !['EMPTY', 'GRINDING', 'READY_FOR_COATING'].includes(currentStage.code)) {
        throw new ConflictException('Tray is not available for intake. Start grinding from a waiting tray before adding blades');
      }
      if (existingCount === 0) {
        tray.summary_id = dto.summary_id;
        tray.part_type_id = dto.part_type_id;
        tray.required_blade_count = null;
      } else {
        if (currentStage.code === 'EMPTY' ||
          (currentStage.code === 'READY_FOR_COATING' && !tray.grinding_completed_at) ||
          (currentStage.code === 'GRINDING' && tray.grinding_completed_at)) {
          throw new ConflictException('Tray stage and grinding completion state are inconsistent; refresh inventory before adding');
        }
        if (tray.summary_id !== dto.summary_id) {
          throw new ConflictException('All blades in a tray must use the same part summary');
        }
        if (tray.part_type_id !== dto.part_type_id) {
          throw new ConflictException('All blades in a tray must use the same part type');
        }
        if (activeAssignments.some(({ blade }) => !blade.enabled ||
          blade.summary_id !== dto.summary_id || blade.part_type_id !== dto.part_type_id ||
          (!isPendingGrindingStatus(blade.status) && blade.status !== BladeStatus.READY_FOR_COATING))) {
          throw new ConflictException('Tray contains blades that are not available for an intake grinding pass');
        }
      }
      // A requirement snapshot survives a short, completed pass. New replacements
      // still require disposition; previous READY_FOR_COATING blades stay untouched.
      if (tray.required_blade_count != null && existingCount + dto.quantity > tray.required_blade_count) {
        throw new UnprocessableEntityException(
          `This post-grind tray requires exactly ${tray.required_blade_count} blades and cannot exceed that quantity`,
        );
      }
      const targetStageCode =
        status === BladeStatus.WAITING_FOR_GRINDING ? 'WAITING_FOR_GRINDING' : 'GRINDING';
      const targetStage = await stageRepo.findOne({ where: { code: targetStageCode, enabled: true } });
      if (!targetStage) {
        throw new UnprocessableEntityException(`${targetStageCode} tray stage is not configured`);
      }
      tray.grinding_completed_at = null;
      tray.current_stage_id = targetStage.id;
      tray.current_stage = targetStage;
      const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [tray.id] }, userId);
      await manager.getRepository(LocationTrayOrmEntity).update(
        { tray_id: tray.id, enabled: true }, { enabled: false, updatedBy: userId },
      );

      const serviceCycle = dto.service_cycle ?? 0;
      const created: BladeOrmEntity[] = [];

      for (let index = 0; index < dto.quantity; index += 1) {
        const blade = await bladeRepo.save(
          bladeRepo.create({
            summary_id: dto.summary_id,
            serial_number: `UNLABELED-${randomUUID()}`,
            part_type_id: dto.part_type_id,
            status,
            service_cycle: serviceCycle,
            enabled: true,
            createdBy: userId,
            updatedBy: userId,
          }),
        );

        await assignmentRepo.save(
          assignmentRepo.create({
            blade_id: blade.id,
            tray_id: dto.tray_id,
            enabled: true,
            createdBy: userId,
            updatedBy: userId,
          }),
        );

        await historyRepo.save([
          historyRepo.create({
            blade_id: blade.id,
            event_type: BladeHistoryEvent.CREATED,
            from_status: null,
            to_status: status,
            service_cycle: serviceCycle,
            createdBy: userId,
            updatedBy: userId,
          }),
          historyRepo.create({
            blade_id: blade.id,
            event_type: BladeHistoryEvent.ASSIGNED_TO_TRAY,
            service_cycle: serviceCycle,
            tray_id: dto.tray_id,
            createdBy: userId,
            updatedBy: userId,
          }),
        ]);

        created.push(blade);
      }

      tray.blade_count = existingCount + created.length;
      tray.updatedBy = userId;
      await trayRepo.save(tray);

      await journal.commit(tray.serial_number, `Intake ${created.length} blades`);
      return {
        tray_id: dto.tray_id,
        summary_id: tray.summary_id,
        part_type_id: tray.part_type_id,
        grinding_complete: Boolean(tray.grinding_completed_at),
        grinding_completed_at: tray.grinding_completed_at,
        current_stage: targetStage,
        pending_grinding_count: activeAssignments.filter(({ blade }) => isPendingGrindingStatus(blade.status)).length + created.length,
        required_blade_count: tray.required_blade_count,
        quantity: created.length,
        tray_blade_count: tray.blade_count,
        complete:
          Boolean(tray.grinding_completed_at) &&
          tray.required_blade_count != null &&
          tray.blade_count === tray.required_blade_count,
        blade_ids: created.map((blade) => blade.id),
      };
    });
  }

  async createBladeTray(
    dto: CreateBladeTrayDto,
    userId: Uuid,
  ): Promise<BladeTrayOrmEntity> {
    return this.bladeTrayRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(BladeTrayOrmEntity);
      const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
      const trayRepo = manager.getRepository(TrayOrmEntity);
      const bladeRepo = manager.getRepository(BladeOrmEntity);
      const stageRepo = manager.getRepository(TrayStageOrmEntity);

      const observedAssignments = await repo.find({ where: { blade_id: dto.blade_id, enabled: true } });
      const lockedTrayIds = [...new Set([dto.tray_id, ...observedAssignments.map(row => row.tray_id)])].sort();
      for (const trayId of lockedTrayIds) {
        const locked = await trayRepo.findOne({ where: { id: trayId, enabled: true }, lock: { mode: 'pessimistic_write' } });
        if (!locked) throw new NotFoundException('Source or destination tray is unavailable');
      }
      const blade = await bladeRepo.findOne({
        where: { id: dto.blade_id, enabled: true }, lock: { mode: 'pessimistic_write' },
      });
      if (!blade) throw new NotFoundException('Blade not found or disabled');
      if (await manager.getRepository(CutterBuildBladeOrmEntity).count({ where: { blade_id: blade.id, enabled: true } })) {
        throw new ConflictException('Installed blades must be returned through cutter teardown before assigning them to a tray');
      }

      const targetTray = await trayRepo.findOne({
        where: { id: dto.tray_id, enabled: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!targetTray) throw new NotFoundException('Tray not found or disabled');

      const [activeContainer, activeCutterBuild] = await Promise.all([
        manager
          .getRepository(ContainerTrayOrmEntity)
          .findOne({ where: { tray_id: targetTray.id, enabled: true } }),
        manager
          .getRepository(CutterBuildTrayOrmEntity)
          .findOne({ where: { tray_id: targetTray.id, enabled: true } }),
      ]);
      if (activeContainer) {
        throw new ConflictException(
          'Tray contents cannot be changed while the tray is loaded in a Coater container',
        );
      }
      if (activeCutterBuild) {
        throw new ConflictException(
          'Tray contents cannot be changed while the tray is assigned to a cutter build',
        );
      }

      const previousAssignments = await repo.find({
        where: { blade_id: dto.blade_id, enabled: true },
      });

      if (previousAssignments.some(row => !lockedTrayIds.includes(row.tray_id))) {
        throw new ConflictException('Blade assignment changed during transfer. Scan again.');
      }
      for (const previous of previousAssignments) {
        if (previous.tray_id === dto.tray_id) continue;
        const [container, build] = await Promise.all([
          manager.getRepository(ContainerTrayOrmEntity).count({ where: { tray_id: previous.tray_id, enabled: true } }),
          manager.getRepository(CutterBuildTrayOrmEntity).count({ where: { tray_id: previous.tray_id, enabled: true } }),
        ]);
        if (container || build) throw new ConflictException('Source tray is in a coater container or cutter build; use its dedicated workflow');
      }
      const alreadyInTarget = previousAssignments.find(
        (assignment) => assignment.tray_id === targetTray.id,
      );
      if (alreadyInTarget) {
        return alreadyInTarget;
      }

      const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [targetTray.id, ...previousAssignments.map(a => a.tray_id)], bladeIds: [blade.id] }, userId);
      const targetCount = await repo.count({
        where: { tray_id: targetTray.id, enabled: true },
      });

      if (targetCount === 0) {
        const targetStageCode =
          blade.status === BladeStatus.WAITING_FOR_GRINDING
            ? 'WAITING_FOR_GRINDING'
            : 'GRINDING';
        const targetStage = await stageRepo.findOne({
          where: { code: targetStageCode, enabled: true },
        });
        if (!targetStage) {
          throw new UnprocessableEntityException(
            `${targetStageCode} tray stage is not configured`,
          );
        }

        targetTray.summary_id = blade.summary_id;
        targetTray.part_type_id = blade.part_type_id;
        targetTray.grinding_completed_at = null;
        targetTray.required_blade_count = null;
        targetTray.current_stage_id = targetStage.id;
      } else if (
        targetTray.summary_id !== blade.summary_id ||
        targetTray.part_type_id !== blade.part_type_id
      ) {
        throw new ConflictException('Blade does not match the tray summary and part type');
      }

      if (
        targetTray.grinding_completed_at &&
        targetTray.required_blade_count != null &&
        targetCount + 1 > targetTray.required_blade_count
      ) {
        throw new UnprocessableEntityException(
          'Post-grind tray is already at its required blade quantity',
        );
      }

      await repo.update(
        { blade_id: dto.blade_id, enabled: true },
        { enabled: false, updatedBy: userId },
      );

      const assignment = await repo.save(
        repo.create({
          ...dto,
          enabled: true,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      targetTray.blade_count = targetCount + 1;
      targetTray.updatedBy = userId;
      await trayRepo.save(targetTray);

      for (const previous of previousAssignments) {
        if (previous.tray_id === targetTray.id) continue;
        await this.resetTrayIfEmpty(manager, previous.tray_id, userId);
      }

      await historyRepo.save(
        historyRepo.create({
          blade_id: dto.blade_id,
          event_type: BladeHistoryEvent.ASSIGNED_TO_TRAY,
          service_cycle: blade.service_cycle ?? 0,
          tray_id: dto.tray_id,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      await journal.commit(targetTray.serial_number, 'Assign blade to tray');
      return assignment;
    });
  }

  async getBladeTray(bladeTrayId: Uuid) {
    return this.bladeTrayRepo.findOneOrFail({ where: { id: bladeTrayId } });
  }

  async getActiveBladesForTray(trayId: Uuid): Promise<BladeTrayOrmEntity[]> {
    return this.bladeTrayRepo.find({
      where: { tray_id: trayId, enabled: true },
      relations: { blade: { summary: true, part_type: true }, tray: true },
      order: { createdAt: 'ASC' },
    });
  }

  async getBladeTrays(
    paginationOptions?: PaginationOptionsDto,
  ): Promise<IPaginatedResponse<IBladeTray>> {
    return this.paginate<IBladeTray>(
      paginationOptions,
      (entity) => entity.toJSON(),
    );
  }

  async updateBladeTray(_bladeTrayId: Uuid, _data: Partial<IBladeTrayEntity>, _userId: Uuid): Promise<never> {
    throw new UnprocessableEntityException('Blade assignments cannot be patched directly. Use the validated intake, transfer, or removal workflow.');
  }

  async deleteBladeTray(bladeTrayId: Uuid, userId: Uuid): Promise<void> {
    await this.bladeTrayRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(BladeTrayOrmEntity);
      const assignment = await repo.findOne({ where: { id: bladeTrayId } });

      if (!assignment) {
        this.logger.log(`Blade-tray assignment ${bladeTrayId} does not exist`);
        throw new UnprocessableEntityException('Error removing blade from tray');
      }

      const tray = await manager.getRepository(TrayOrmEntity).findOne({ where: { id: assignment.tray_id }, lock: { mode: 'pessimistic_write' } });
      if (!tray) throw new NotFoundException('Tray not found');
      if (!assignment.enabled) return;

      const activeContainer = await manager
        .getRepository(ContainerTrayOrmEntity)
        .findOne({
          where: { tray_id: assignment.tray_id, enabled: true },
        });
      if (activeContainer) {
        throw new ConflictException(
          'Blade cannot be removed while its tray is loaded in a Coater container',
        );
      }

      const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [tray.id], bladeIds: [assignment.blade_id] }, userId);
      assignment.enabled = false;
      assignment.updatedBy = userId;
      await repo.save(assignment);

      await this.resetTrayIfEmpty(manager, assignment.tray_id, userId);
      await journal.commit(tray.serial_number, 'Remove blade from tray');
    });
  }

  private async resetTrayIfEmpty(
    manager: EntityManager,
    trayId: Uuid,
    userId: Uuid,
  ): Promise<void> {
    const repo = manager.getRepository(BladeTrayOrmEntity);
    const trayRepo = manager.getRepository(TrayOrmEntity);
    const activeCount = await repo.count({
      where: { tray_id: trayId, enabled: true },
    });
    const tray = await trayRepo.findOne({ where: { id: trayId } });
    if (!tray) return;

    tray.blade_count = activeCount;
    if (activeCount === 0) {
      const emptyStage = await manager.getRepository(TrayStageOrmEntity).findOne({
        where: { code: 'EMPTY', enabled: true },
      });
      if (!emptyStage) {
        throw new UnprocessableEntityException('EMPTY tray stage is not configured');
      }

      await manager.getRepository(LocationTrayOrmEntity).update(
        { tray_id: tray.id, enabled: true },
        { enabled: false, updatedBy: userId },
      );

      tray.summary_id = null;
      tray.part_type_id = null;
      tray.grinding_completed_at = null;
      tray.required_blade_count = null;
      tray.current_stage_id = emptyStage.id;
    }
    tray.updatedBy = userId;
    await trayRepo.save(tray);
  }
}
