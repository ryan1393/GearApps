import { FindOptionsWhere, Repository } from 'typeorm';

import { beginWorkflowJournal, lockCoaterInventory } from '@meshforge/manufacturing/server/data-access';
import {
  BladeHistoryOrmEntity,
  BladeOrmEntity,
  BladeTrayOrmEntity,
  ContainerTrayOrmEntity,
  ContainerOrmEntity,
  CutterBuildTrayOrmEntity,
  LocationOrmEntity,
  LocationTrayOrmEntity,
  CreateContainerTrayDto,
  PaginationOptionsDto,
  PaginationService,
  TrayOrmEntity,
  TrayStageOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import {
  cuttergrindRoughShelfForPartType,
  parseCuttergrindRoughShelfTag,
  DEPARTMENT_CUTTERGRIND,
  parseCuttergrindNumberedShelfTag,
} from '@meshforge/manufacturing/shared/util-constants';
import {
  BladeHistoryEvent,
  BladeStatus,
  IContainerTray,
  IContainerTrayEntity,
  IPaginatedResponse,
  Uuid,
} from '@meshforge/manufacturing/shared/util-types';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class ServerFeatContainerTrayService extends PaginationService<ContainerTrayOrmEntity> {
  private readonly logger = new Logger(ServerFeatContainerTrayService.name);

  constructor(
    @InjectRepository(ContainerTrayOrmEntity)
    private readonly containerTrayRepo: Repository<ContainerTrayOrmEntity>,
  ) {
    super(ContainerTrayOrmEntity.prototype, containerTrayRepo);
  }

  async findContainerTray(
    find: FindOptionsWhere<ContainerTrayOrmEntity>,
  ): Promise<ContainerTrayOrmEntity | null> {
    return this.containerTrayRepo.findOneBy(find);
  }

  /**
   * Packing records physical loading only: READY_FOR_COATING -> PACKED_FOR_COATER.
   * Coater Shipments owns the separate, atomic AT_COATER dispatch.
   */
  async createContainerTray(
    dto: CreateContainerTrayDto,
    userId: Uuid,
  ): Promise<ContainerTrayOrmEntity> {
    return this.containerTrayRepo.manager.transaction(async (manager) => {
      await lockCoaterInventory(manager);
      const repo = manager.getRepository(ContainerTrayOrmEntity);
      const trayRepo = manager.getRepository(TrayOrmEntity);
      const bladeTrayRepo = manager.getRepository(BladeTrayOrmEntity);
      const bladeRepo = manager.getRepository(BladeOrmEntity);
      const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
      const locationTrayRepo = manager.getRepository(LocationTrayOrmEntity);
      const trayStageRepo = manager.getRepository(TrayStageOrmEntity);

      const lockedTray = await trayRepo.findOne({
        where: { id: dto.tray_id, enabled: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedTray) throw new NotFoundException('Tray not found or disabled');

      const tray = await trayRepo.findOne({
        where: { id: lockedTray.id, enabled: true },
        relations: { current_stage: true, part_type: true },
      });
      if (!tray) throw new NotFoundException('Tray not found or disabled');

      const [container, cutterLink] = await Promise.all([
        manager.getRepository(ContainerOrmEntity).findOne({ where: { id: dto.container_id, enabled: true }, lock: { mode: 'pessimistic_write' } }),
        manager.getRepository(CutterBuildTrayOrmEntity).findOne({ where: { tray_id: tray.id, enabled: true } }),
      ]);
      if (!container) throw new NotFoundException('Container not found or disabled');
      if (cutterLink) throw new ConflictException('Tray is still assigned to a cutter build');
      const loaded = await repo.find({ where: { container_id: container.id, enabled: true }, relations: { tray: { current_stage: true } } });
      if (loaded.some(link => !link.tray?.enabled || link.tray.current_stage?.code !== 'PACKED_FOR_COATER')) {
        throw new ConflictException('This container has trays already sent to the coater or inventory needing review.');
      }

      const existingContainer = await repo.findOne({
        where: { tray_id: tray.id, enabled: true },
      });
      if (existingContainer) {
        throw new ConflictException('Tray is already loaded in a container');
      }

      if (
        tray.current_stage?.code !== 'READY_FOR_COATING' ||
        !tray.grinding_completed_at ||
        tray.required_blade_count == null ||
        tray.blade_count !== tray.required_blade_count
      ) {
        throw new UnprocessableEntityException(
          'Only a complete post-grind tray can be loaded for coating',
        );
      }

      const roughShelfSerial = cuttergrindRoughShelfForPartType(tray.part_type?.code);
      const activeRoughShelf = await locationTrayRepo.findOne({
        where: { tray_id: tray.id, enabled: true },
        relations: { location: true },
      });
      const roughTag = parseCuttergrindRoughShelfTag(activeRoughShelf?.location?.serial_number ?? '');
      if (!roughTag || roughTag.partTypeCode !== tray.part_type?.code || !activeRoughShelf?.location?.enabled || activeRoughShelf.location.location_type !== 'SHELF' || activeRoughShelf.location.department !== DEPARTMENT_CUTTERGRIND) {
        throw new UnprocessableEntityException(
          `Complete post-grind trays must be staged on an actual numbered ${roughShelfSerial ?? 'CGRR/CGRP'}-### shelf before coating`,
        );
      }

      const assignments = await bladeTrayRepo.find({
        where: { tray_id: tray.id, enabled: true },
        relations: { blade: true },
      });

      if (assignments.length !== tray.required_blade_count) {
        throw new UnprocessableEntityException(
          `Tray requires exactly ${tray.required_blade_count} active blades before coating`,
        );
      }

      const badBlade = assignments.find(
        ({ blade }) =>
          !blade.enabled ||
          blade.summary_id !== tray.summary_id ||
          blade.part_type_id !== tray.part_type_id ||
          blade.status !== BladeStatus.READY_FOR_COATING,
      );
      if (badBlade) {
        throw new UnprocessableEntityException(
          'Every blade in the tray must be ready for coating and match the tray configuration',
        );
      }

      const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [tray.id] }, userId);
      const assignment = await repo.save(
        repo.create({
          ...dto,
          packed_from_location_id: activeRoughShelf!.location_id,
          packed_at: new Date(),
          enabled: true,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      for (const { blade } of assignments) {
        await historyRepo.save(historyRepo.create({
          blade_id: blade.id, event_type: BladeHistoryEvent.LOADED_TO_CONTAINER,
          from_status: blade.status, to_status: blade.status,
          service_cycle: blade.service_cycle ?? 0, tray_id: tray.id,
          container_id: dto.container_id, notes: 'Packed for shipment; not yet sent to coater',
          createdBy: userId, updatedBy: userId,
        }));
      }
      const atCoaterStage = await trayStageRepo.findOne({
        where: { code: 'PACKED_FOR_COATER', enabled: true },
      });
      if (!atCoaterStage) {
        throw new UnprocessableEntityException('PACKED_FOR_COATER tray stage is not configured');
      }

      await locationTrayRepo.update(
        { tray_id: tray.id, enabled: true },
        { enabled: false, updatedBy: userId },
      );
      tray.current_stage_id = atCoaterStage.id;
      tray.current_stage = atCoaterStage;
      tray.updatedBy = userId;
      await trayRepo.save(tray);

      await journal.commit(tray.serial_number, 'Pack tray into container; not yet sent to coater');
      return assignment;
    });
  }

  async getContainerTray(containerTrayId: Uuid) {
    return this.containerTrayRepo.findOneOrFail({
      where: { id: containerTrayId },
    });
  }

  async getCurrentContainerForTray(
    trayId: Uuid,
  ): Promise<ContainerTrayOrmEntity | null> {
    return this.containerTrayRepo.findOne({
      where: { tray_id: trayId, enabled: true },
      relations: { container: true, tray: true },
      order: { createdAt: 'DESC' },
    });
  }

  async getActiveContainerTrays(
    containerId: Uuid,
  ): Promise<ContainerTrayOrmEntity[]> {
    return this.containerTrayRepo.find({
      where: { container_id: containerId, enabled: true },
      relations: { tray: true },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Receiving/unloading a tray is the Coater return transition:
   * AT_COATER -> RETURNED_FROM_COATING.
   */
  async unloadTrayFromContainer(
    containerId: Uuid,
    trayId: Uuid,
    shelfLocationSerialNumber: string,
    userId: Uuid,
  ): Promise<ContainerTrayOrmEntity> {
    return this.containerTrayRepo.manager.transaction(async (manager) => {
      await lockCoaterInventory(manager);
      const repo = manager.getRepository(ContainerTrayOrmEntity);
      const bladeTrayRepo = manager.getRepository(BladeTrayOrmEntity);
      const bladeRepo = manager.getRepository(BladeOrmEntity);
      const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
      const locationRepo = manager.getRepository(LocationOrmEntity);
      const locationTrayRepo = manager.getRepository(LocationTrayOrmEntity);
      const trayRepo = manager.getRepository(TrayOrmEntity);
      const trayStageRepo = manager.getRepository(TrayStageOrmEntity);

      const lockedTray = await trayRepo.findOne({ where: { id: trayId, enabled: true }, lock: { mode: 'pessimistic_write' } });
      if (!lockedTray) throw new NotFoundException('Tray not found or disabled');

      const lockedAssignment = await repo.findOne({
        where: {
          container_id: containerId,
          tray_id: trayId,
          enabled: true,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedAssignment) {
        throw new UnprocessableEntityException(
          'Tray is not currently assigned to this container',
        );
      }

      const assignment = await repo.findOne({
        where: { id: lockedAssignment.id, enabled: true },
        relations: { tray: { summary: true, part_type: true, current_stage: true }, container: true },
      });

      if (!assignment) {
        throw new UnprocessableEntityException(
          'Tray is not currently assigned to this container',
        );
      }

      const shelfSerial = shelfLocationSerialNumber.trim().toUpperCase();
      const [shelfLocation, readyForCutterStage] = await Promise.all([
        locationRepo.findOne({
          where: { serial_number: shelfSerial, enabled: true },
          lock: { mode: 'pessimistic_read' },
        }),
        trayStageRepo.findOne({
          where: { code: 'READY_FOR_CUTTER', enabled: true },
        }),
      ]);

      const summaryNumber = assignment.tray.summary?.number;
      const partTypeCode = assignment.tray.part_type?.code;
      if (!summaryNumber) {
        throw new UnprocessableEntityException(
          'The coated tray does not have a summary assigned',
        );
      }
      if (!partTypeCode) {
        throw new UnprocessableEntityException(
          'The coated tray does not have a Part Type assigned',
        );
      }
      const numberedShelf = parseCuttergrindNumberedShelfTag(shelfSerial);
      if (!assignment.container.enabled || assignment.tray.current_stage?.code !== 'AT_COATER') {
        throw new ConflictException('Only an enabled coater container with an AT_COATER tray can be received');
      }
      if (!shelfLocation || !numberedShelf || numberedShelf.kind !== 'CUTTERGRIND_FINISHED' ||
          numberedShelf.partTypeCode !== partTypeCode || shelfLocation.location_type !== 'SHELF' ||
          shelfLocation.department !== DEPARTMENT_CUTTERGRIND) {
        throw new UnprocessableEntityException(
          `Finished coated ${partTypeCode} trays must be received to a ${partTypeCode === 'RING' ? 'CGFR' : 'CGFP'} shelf such as ${partTypeCode === 'RING' ? 'CGFR' : 'CGFP'}-A1A (shelf, layer, bin)`,
        );
      }
      if (!readyForCutterStage) {
        throw new UnprocessableEntityException(
          'READY_FOR_CUTTER tray stage is not configured',
        );
      }

      const bladeAssignments = await bladeTrayRepo.find({
        where: { tray_id: trayId, enabled: true },
        relations: { blade: true },
      });

      if (!bladeAssignments.length || bladeAssignments.length !== assignment.tray.blade_count) {
        throw new ConflictException('Coater tray count differs from its active blade assignments; refresh inventory before receiving');
      }

      const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [trayId] }, userId);
      for (const bladeAssignment of bladeAssignments) {
        const blade = bladeAssignment.blade;

        if (!blade.enabled || blade.status !== BladeStatus.AT_COATER || blade.summary_id !== assignment.tray.summary_id || blade.part_type_id !== assignment.tray.part_type_id) {
          throw new UnprocessableEntityException(
            'One or more blades are not in the expected AT_COATER status',
          );
        }

        const previousStatus = blade.status;
        blade.status = BladeStatus.RETURNED_FROM_COATING;
        blade.updatedBy = userId;

        await historyRepo.save(
          historyRepo.create({
            blade_id: blade.id,
            event_type: BladeHistoryEvent.RETURNED_FROM_COATER,
            from_status: previousStatus,
            to_status: BladeStatus.RETURNED_FROM_COATING,
            service_cycle: blade.service_cycle ?? 0,
            tray_id: trayId,
            container_id: containerId,
            createdBy: userId,
            updatedBy: userId,
          }),
        );
      }

      await bladeRepo.save(bladeAssignments.map(({ blade }) => blade));

      const tray = await trayRepo.findOneOrFail({
        where: { id: trayId, enabled: true },
        lock: { mode: 'pessimistic_write' },
      });

      await locationTrayRepo.update(
        { tray_id: tray.id, enabled: true },
        { enabled: false, updatedBy: userId },
      );
      await locationTrayRepo.save(
        locationTrayRepo.create({
          tray_id: tray.id,
          location_id: shelfLocation.id,
          enabled: true,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      tray.current_stage_id = readyForCutterStage.id;
      tray.updatedBy = userId;
      await trayRepo.save(tray);

      assignment.enabled = false;
      assignment.updatedBy = userId;
      const received = await repo.save(assignment);
      await journal.commit(tray.serial_number, `Receive tray to ${shelfSerial}`);
      return received;
    });
  }

  async getContainerTrays(
    paginationOptions?: PaginationOptionsDto,
  ): Promise<IPaginatedResponse<IContainerTray>> {
    return this.paginate<IContainerTray>(
      paginationOptions,
      (entity) => entity.toJSON(),
    );
  }

  async updateContainerTray(
    containerTrayId: Uuid,
    _data: Partial<IContainerTrayEntity>,
    _userId: Uuid,
  ) {
    await this.containerTrayRepo.findOneOrFail({
      where: { id: containerTrayId },
    });
    throw new UnprocessableEntityException(
      'Container-tray assignments are workflow controlled. Use the load and unload endpoints.',
    );
  }

  async deleteContainerTray(
    containerTrayId: Uuid,
    _userId: Uuid,
  ): Promise<void> {
    const assignment = await this.containerTrayRepo.findOne({
      where: { id: containerTrayId },
    });
    if (!assignment) {
      this.logger.log(
        `Container-tray assignment ${containerTrayId} does not exist`,
      );
      throw new UnprocessableEntityException(
        'Error removing tray from container',
      );
    }

    if (!assignment.enabled) return;

    throw new UnprocessableEntityException(
      'Container-tray assignments must be received with a scanned shelf location',
    );
  }
}
