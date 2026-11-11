import { EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';

import { beginWorkflowJournal, lockCoaterInventory, lockEmptyContainer, packTrayIntoContainerSet, resolveCoaterPlacement } from '@meshforge/manufacturing/server/data-access';
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

export interface LoadedContainerSet {
  container_id: string;
  container_serial_number: string;
  tray_id: string;
  tray_serial_number: string;
  container_set_id: string;
  blade_count: number;
  location_serial_number: string;
  tray_emptied: true;
}

export interface ReceivedContainerSet {
  container_id: string;
  container_serial_number: string;
  tray_id: string;
  tray_serial_number: string;
  blade_count: number;
  shelf_serial_number: string;
}

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
   * Load Container: a full, ground tray waiting at the coater staging area or on a rough shelf
   * bin has its complete set moved into an empty container, which takes the tray's place. The
   * tray is emptied for reuse. Coater Shipments owns the separate, atomic AT_COATER dispatch.
   */
  async createContainerTray(
    dto: CreateContainerTrayDto,
    userId: Uuid,
  ): Promise<LoadedContainerSet> {
    return this.containerTrayRepo.manager.transaction(async (manager) => {
      await lockCoaterInventory(manager);
      const trayRepo = manager.getRepository(TrayOrmEntity);
      const locationTrayRepo = manager.getRepository(LocationTrayOrmEntity);

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

      const [containerRow, cutterLink, existingContainer] = await Promise.all([
        manager.getRepository(ContainerOrmEntity).findOne({ where: { id: dto.container_id, enabled: true } }),
        manager.getRepository(CutterBuildTrayOrmEntity).findOne({ where: { tray_id: tray.id, enabled: true } }),
        manager.getRepository(ContainerTrayOrmEntity).findOne({ where: { tray_id: tray.id, enabled: true } }),
      ]);
      if (!containerRow) throw new NotFoundException('Container not found or disabled');
      if (cutterLink) throw new ConflictException('Tray is still assigned to a cutter build');
      if (existingContainer) throw new ConflictException('Tray is already loaded in a container');
      const container = await lockEmptyContainer(manager, containerRow.serial_number);

      if (
        tray.current_stage?.code !== 'READY_FOR_COATING' ||
        !tray.grinding_completed_at ||
        !tray.summary_id || !tray.part_type_id || !tray.part_type?.code ||
        tray.required_blade_count == null ||
        tray.blade_count !== tray.required_blade_count
      ) {
        throw new UnprocessableEntityException('Only a complete, ground tray (one full set) can be loaded for coating');
      }

      // The container takes the tray's place: the coater staging area or its rough shelf bin.
      const currentPlace = await locationTrayRepo.findOne({
        where: { tray_id: tray.id, enabled: true },
        relations: { location: true },
      });
      const placement = await resolveCoaterPlacement(manager, currentPlace?.location?.serial_number ?? null, tray.part_type.code);

      const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [tray.id], containerIds: [container.id] }, userId);
      const traySerial = tray.serial_number;
      const packed = await packTrayIntoContainerSet(manager, {
        tray, container, placement,
        summaryId: tray.summary_id,
        partTypeId: tray.part_type_id,
        requiredBladeCount: tray.required_blade_count,
        grindingCompletedAt: tray.grinding_completed_at,
        userId,
      });
      await journal.commit(traySerial, `Move set into container ${container.serial_number} at ${placement.serial_number}; tray emptied, not yet sent to coater`);
      return {
        container_id: container.id,
        container_serial_number: container.serial_number,
        tray_id: tray.id,
        tray_serial_number: traySerial,
        container_set_id: packed.container_set_id,
        blade_count: packed.blade_count,
        location_serial_number: placement.serial_number,
        tray_emptied: true,
      };
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
  ): Promise<ContainerTrayOrmEntity | ReceivedContainerSet> {
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

      // A container holding a blade set is received into the scanned empty tray. A tray that
      // was packed whole the old way (container_tray) comes back out as before.
      const [activeSet] = await manager.query(
        'SELECT id FROM public.container_sets WHERE container_id = $1 AND enabled AND "deletedAt" IS NULL FOR UPDATE',
        [containerId],
      );
      if (activeSet) return this.receiveSetIntoTray(manager, containerId, activeSet.id, lockedTray, shelfLocationSerialNumber, userId);

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
      tray.current_stage = readyForCutterStage;
      tray.updatedBy = userId;
      await trayRepo.save(tray);

      assignment.enabled = false;
      assignment.updatedBy = userId;
      const received = await repo.save(assignment);
      await journal.commit(tray.serial_number, `Receive tray to ${shelfSerial}`);
      return received;
    });
  }

  /**
   * One complete set comes back from the coater into one empty tray, which goes onto a finished
   * shelf bin ready for a cutter build: AT_COATER -> RETURNED_FROM_COATING, tray READY_FOR_CUTTER.
   */
  private async receiveSetIntoTray(
    manager: EntityManager,
    containerId: Uuid,
    setId: string,
    tray: TrayOrmEntity,
    shelfLocationSerialNumber: string,
    userId: Uuid,
  ): Promise<ReceivedContainerSet> {
    const [set] = await manager.query(
      `SELECT cs.id, cs.summary_id, cs.part_type_id, cs.required_blade_count, cs.grinding_completed_at,
              c.serial_number AS container_serial, c.enabled AS container_enabled, pt.code AS part_type_code
         FROM public.container_sets cs
         JOIN public.containers c ON c.id = cs.container_id
         JOIN public.part_types pt ON pt.id = cs.part_type_id
        WHERE cs.id = $1`,
      [setId],
    );
    if (!set?.container_enabled) throw new ConflictException('Only an enabled coater container can be received');

    const [links] = await manager.query(
      `SELECT (SELECT count(*)::int FROM public.blade_tray WHERE tray_id = $1 AND enabled AND "deletedAt" IS NULL) AS blades,
              (SELECT count(*)::int FROM public.container_tray WHERE tray_id = $1 AND enabled AND "deletedAt" IS NULL) AS containers,
              (SELECT count(*)::int FROM public.cutter_build_trays WHERE tray_id = $1 AND enabled AND "deletedAt" IS NULL) AS builds,
              (SELECT code FROM public.tray_stages WHERE id = $2) AS stage`,
      [tray.id, tray.current_stage_id],
    );
    if (links.stage !== 'EMPTY' || tray.blade_count !== 0 || links.blades || links.containers || links.builds) {
      throw new ConflictException(`Tray ${tray.serial_number} is not empty. Scan an empty tray for the returned set.`);
    }

    const shelfSerial = shelfLocationSerialNumber.trim().toUpperCase();
    const finishedPrefix = set.part_type_code === 'RING' ? 'CGFR' : 'CGFP';
    const shelfTag = parseCuttergrindNumberedShelfTag(shelfSerial);
    const shelf = await manager.getRepository(LocationOrmEntity).findOne({
      where: { serial_number: shelfSerial, enabled: true },
      lock: { mode: 'pessimistic_read' },
    });
    if (!shelf || !shelfTag || shelfTag.kind !== 'CUTTERGRIND_FINISHED' || shelfTag.partTypeCode !== set.part_type_code
        || shelf.location_type !== 'SHELF' || shelf.department !== DEPARTMENT_CUTTERGRIND) {
      throw new UnprocessableEntityException(
        `Finished coated ${set.part_type_code} sets must be received to a ${finishedPrefix} shelf such as ${finishedPrefix}-A1A (shelf, layer, bin)`,
      );
    }
    const readyForCutterStage = await manager.getRepository(TrayStageOrmEntity).findOne({ where: { code: 'READY_FOR_CUTTER', enabled: true } });
    if (!readyForCutterStage) throw new UnprocessableEntityException('READY_FOR_CUTTER tray stage is not configured');

    const setBlades: Array<{ link_id: string; id: string }> = await manager.query(
      `SELECT sb.id AS link_id, b.id FROM public.container_set_blades sb JOIN public.blades b ON b.id = sb.blade_id
        WHERE sb.container_set_id = $1 AND sb.enabled AND sb."deletedAt" IS NULL ORDER BY b.serial_number, b.id`,
      [setId],
    );
    const bladeRepo = manager.getRepository(BladeOrmEntity);
    const blades = setBlades.length ? await bladeRepo.findBy({ id: In(setBlades.map(row => row.id)) }) : [];
    if (!blades.length || blades.length !== set.required_blade_count) {
      throw new ConflictException(`Container ${set.container_serial} holds ${blades.length} blades but its set is ${set.required_blade_count}; refresh inventory before receiving`);
    }
    if (blades.some(blade => !blade.enabled || blade.status !== BladeStatus.AT_COATER
        || blade.summary_id !== set.summary_id || blade.part_type_id !== set.part_type_id)) {
      throw new ConflictException(`Container ${set.container_serial} has not been sent to the coater, or its blades need review`);
    }

    const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [tray.id], containerIds: [containerId] }, userId);
    const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
    const bladeTrayRepo = manager.getRepository(BladeTrayOrmEntity);
    await historyRepo.save(blades.map(blade => historyRepo.create({
      blade_id: blade.id,
      event_type: BladeHistoryEvent.RETURNED_FROM_COATER,
      from_status: blade.status,
      to_status: BladeStatus.RETURNED_FROM_COATING,
      service_cycle: blade.service_cycle ?? 0,
      tray_id: tray.id,
      container_id: containerId,
      notes: `Set received from container ${set.container_serial} into tray ${tray.serial_number}`,
      createdBy: userId,
      updatedBy: userId,
    })));
    for (const blade of blades) {
      blade.status = BladeStatus.RETURNED_FROM_COATING;
      blade.updatedBy = userId;
    }
    await bladeRepo.save(blades);
    await bladeTrayRepo.save(blades.map(blade => bladeTrayRepo.create({
      tray_id: tray.id, blade_id: blade.id, enabled: true, createdBy: userId, updatedBy: userId,
    })));
    await manager.query(
      'UPDATE public.container_set_blades SET enabled = false, "updatedAt" = now(), "updatedBy" = $2 WHERE container_set_id = $1 AND enabled',
      [setId, userId],
    );
    await manager.query('UPDATE public.container_sets SET enabled = false, "updatedAt" = now(), "updatedBy" = $2 WHERE id = $1', [setId, userId]);

    const locationTrayRepo = manager.getRepository(LocationTrayOrmEntity);
    await locationTrayRepo.update({ tray_id: tray.id, enabled: true }, { enabled: false, updatedBy: userId });
    await locationTrayRepo.save(locationTrayRepo.create({ tray_id: tray.id, location_id: shelf.id, enabled: true, createdBy: userId, updatedBy: userId }));

    tray.summary_id = set.summary_id;
    tray.part_type_id = set.part_type_id;
    tray.required_blade_count = set.required_blade_count;
    tray.grinding_completed_at = new Date(set.grinding_completed_at);
    tray.blade_count = blades.length;
    tray.current_stage_id = readyForCutterStage.id;
    tray.current_stage = readyForCutterStage;
    tray.updatedBy = userId;
    await manager.getRepository(TrayOrmEntity).save(tray);

    await journal.commit(tray.serial_number, `Receive set from container ${set.container_serial} into tray, to ${shelfSerial}`);
    return {
      container_id: containerId,
      container_serial_number: set.container_serial,
      tray_id: tray.id,
      tray_serial_number: tray.serial_number,
      blade_count: blades.length,
      shelf_serial_number: shelfSerial,
    };
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
