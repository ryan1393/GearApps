import { BladeStatus } from '@meshforge/manufacturing/shared/util-types';
import { FindOptionsWhere, Repository } from 'typeorm';
import { beginWorkflowJournal } from '@meshforge/manufacturing/server/data-access';

import {
  BladeTrayOrmEntity,
  ContainerTrayOrmEntity,
  CutterBuildTrayOrmEntity,
  CreateLocationTrayDto,
  LocationOrmEntity,
  LocationTrayOrmEntity,
  TrayOrmEntity,
  PaginationOptionsDto,
  PaginationService,
} from '@meshforge/manufacturing/server/data-access';
import {
  ILocationTray,
  ILocationTrayEntity,
  IPaginatedResponse,
  Uuid,
} from '@meshforge/manufacturing/shared/util-types';
import { isCoaterStagingLocation, parseCuttergrindNumberedShelfTag, parseCuttergrindRoughShelfTag, parseSummaryShelfTag } from '@meshforge/manufacturing/shared/util-constants';
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class ServerFeatLocationTrayService extends PaginationService<LocationTrayOrmEntity> {
  private readonly logger = new Logger(ServerFeatLocationTrayService.name);

  constructor(
    @InjectRepository(LocationTrayOrmEntity)
    private readonly locationTrayRepo: Repository<LocationTrayOrmEntity>,
  ) {
    super(LocationTrayOrmEntity.prototype, locationTrayRepo);
  }

  async findLocationTray(
    find: FindOptionsWhere<LocationTrayOrmEntity>,
  ): Promise<LocationTrayOrmEntity | null> {
    return this.locationTrayRepo.findOneBy(find);
  }

  async createLocationTray(
    dto: CreateLocationTrayDto,
    userId: Uuid,
  ): Promise<LocationTrayOrmEntity> {
    return this.locationTrayRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(LocationTrayOrmEntity);
      const trayRepo = manager.getRepository(TrayOrmEntity);
      const locationRepo = manager.getRepository(LocationOrmEntity);
      const containerRepo = manager.getRepository(ContainerTrayOrmEntity);

      const lockedTray = await trayRepo.findOne({ where: { id: dto.tray_id, enabled: true }, lock: { mode: 'pessimistic_write' } });
      if (!lockedTray) throw new NotFoundException('Tray not found or disabled');
      const activeBuild = await manager.getRepository(CutterBuildTrayOrmEntity).findOne({ where: { tray_id: dto.tray_id, enabled: true } });
      if (activeBuild) throw new ConflictException('A cutter-assigned tray cannot be moved');
      const [tray, location, activeContainer] = await Promise.all([
        trayRepo.findOne({
          where: { id: dto.tray_id, enabled: true },
          relations: { summary: true, part_type: true, current_stage: true },
        }),
        locationRepo.findOne({ where: { id: dto.location_id, enabled: true }, lock: { mode: 'pessimistic_read' } }),
        containerRepo.findOne({
          where: { tray_id: dto.tray_id, enabled: true },
        }),
      ]);

      if (!tray) throw new NotFoundException('Tray not found or disabled');
      if (!location) throw new NotFoundException('Location not found or disabled');
      if (tray.blade_count <= 0) throw new ConflictException('Empty trays remain in the reusable pool and do not require a shelf');
      if (!['WAITING_FOR_GRINDING', 'GRINDING', 'READY_FOR_COATING', 'READY_FOR_CUTTER'].includes(tray.current_stage?.code ?? '')) {
        throw new ConflictException('Tray stage does not permit internal movement');
      }
      if (/^CG[DF][RP]-/.test(location.serial_number) && !parseCuttergrindNumberedShelfTag(location.serial_number)) {
        throw new UnprocessableEntityException('Use a numbered Cuttergrind shelf, not a Summary-derived tag');
      }
      if (activeContainer) {
        throw new ConflictException(
          'Tray location cannot be changed while the tray is loaded in a container',
        );
      }

      if (!tray.summary_id || !tray.part_type_id) {
        throw new ConflictException('Tray configuration is missing; refresh inventory before moving');
      }
      const blades = await manager.getRepository(BladeTrayOrmEntity).find({ where: { tray_id: tray.id, enabled: true }, relations: { blade: true } });
      if (blades.length !== tray.blade_count || blades.some(({ blade }) => !blade.enabled || blade.summary_id !== tray.summary_id || blade.part_type_id !== tray.part_type_id)) {
        throw new ConflictException('Tray count or blade configuration is inconsistent; refresh inventory before moving');
      }

      const roughShelf = parseCuttergrindRoughShelfTag(location.serial_number);
      if (/^(CGRR|CGRP)/i.test(location.serial_number) && !roughShelf) {
        throw new UnprocessableEntityException('Use an actual rough shelf bin such as CGRR-A1A or CGRP-A1A (shelf, layer, bin); other rough locations are legacy records only');
      }
      const cuttergrindShelf = roughShelf ? null : parseCuttergrindNumberedShelfTag(location.serial_number);
      const summaryShelf = roughShelf || cuttergrindShelf ? null : parseSummaryShelfTag(location.serial_number);
      if (
        location.department === 'GREENSHED' &&
        location.location_type === 'SHELF'
      ) {
        throw new UnprocessableEntityException(
          'Tray records cannot be assigned to Green Shed cutter shelves',
        );
      }
      if (roughShelf) {
        if (location.department !== roughShelf.department || location.location_type !== roughShelf.locationType) {
          throw new UnprocessableEntityException('Rough shelf routing metadata is inconsistent');
        }
        if (!tray.part_type || tray.part_type.code !== roughShelf.partTypeCode) {
          throw new UnprocessableEntityException(
            `Tray Part Type does not match shelf ${location.serial_number}; expected ${roughShelf.partTypeCode}`,
          );
        }
        if (tray.current_stage?.code !== 'READY_FOR_COATING' || !tray.grinding_completed_at || !tray.required_blade_count || tray.blade_count !== tray.required_blade_count || blades.some(({blade}) => blade.status !== BladeStatus.READY_FOR_COATING)) {
          throw new UnprocessableEntityException(
            `${location.serial_number} requires completed grinding and tray stage READY_FOR_COATING`,
          );
        }
      }
      if (isCoaterStagingLocation(location.serial_number) &&
          (tray.current_stage?.code !== 'READY_FOR_COATING' || !tray.grinding_completed_at || !tray.required_blade_count ||
           tray.blade_count !== tray.required_blade_count || blades.some(({ blade }) => blade.status !== BladeStatus.READY_FOR_COATING))) {
        throw new UnprocessableEntityException(`${location.serial_number} only takes a full, ground tray waiting for the coater`);
      }
      if (cuttergrindShelf) {
        if (location.department !== cuttergrindShelf.department || location.location_type !== cuttergrindShelf.locationType) {
          throw new UnprocessableEntityException('Numbered shelf routing metadata is inconsistent');
        }
        if (!tray.part_type || tray.part_type.code !== cuttergrindShelf.partTypeCode) {
          throw new UnprocessableEntityException(
            `Tray Part Type does not match shelf ${location.serial_number}; expected ${cuttergrindShelf.partTypeCode}`,
          );
        }
        const requiredStage =
          cuttergrindShelf.kind === 'CUTTERGRIND_DULL'
            ? 'WAITING_FOR_GRINDING'
            : 'READY_FOR_CUTTER';
        if (tray.current_stage?.code !== requiredStage) {
          throw new UnprocessableEntityException(
            `${location.serial_number} requires tray stage ${requiredStage}`,
          );
        }
      }
      if (summaryShelf) {
        if (!tray.summary || tray.summary.number !== summaryShelf.summaryNumber) {
          throw new UnprocessableEntityException(
            `Tray summary does not match shelf ${location.serial_number}`,
          );
        }
        if (!tray.part_type || tray.part_type.code !== summaryShelf.partTypeCode) {
          throw new UnprocessableEntityException(
            `Tray Part Type does not match shelf ${location.serial_number}; expected ${summaryShelf.partTypeCode}`,
          );
        }

        const requiredStage =
          summaryShelf.kind === 'CUTTERGRIND_DULL'
            ? 'WAITING_FOR_GRINDING'
            : 'READY_FOR_CUTTER';
        if (tray.current_stage?.code !== requiredStage) {
          throw new UnprocessableEntityException(
            `${location.serial_number} requires tray stage ${requiredStage}`,
          );
        }
      }

      // Moving a tray closes its previous active location assignment but keeps history.
      const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [tray.id] }, userId);
      await repo.update(
        { tray_id: dto.tray_id, enabled: true },
        { enabled: false, updatedBy: userId },
      );

      const moved = await repo.save(
        repo.create({
          tray_id: dto.tray_id,
          location_id: dto.location_id,
          enabled: true,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
      await journal.commit(tray.serial_number, `Move tray to ${location.serial_number}`);
      return moved;
    });
  }

  async getLocationTray(locationTrayId: Uuid) {
    return this.locationTrayRepo.findOneOrFail({ where: { id: locationTrayId } });
  }

  async getCurrentLocationForTray(trayId: Uuid) {
    const assignment = await this.locationTrayRepo.findOne({
      where: { tray_id: trayId, enabled: true },
      relations: { location: true, tray: true },
      order: { createdAt: 'DESC' },
    });
    if (!assignment) {
      throw new NotFoundException('Tray does not currently have an internal location');
    }
    return assignment;
  }

  async getLocationTrays(
    paginationOptions?: PaginationOptionsDto,
  ): Promise<IPaginatedResponse<ILocationTray>> {
    return this.paginate<ILocationTray>(paginationOptions, (entity) => entity.toJSON());
  }

  async updateLocationTray(
    locationTrayId: Uuid,
    data: Partial<ILocationTrayEntity>,
    userId: Uuid,
  ) {
    await this.locationTrayRepo.findOneOrFail({ where: { id: locationTrayId } });
    throw new UnprocessableEntityException('Location assignments are workflow controlled. Use Move Tray.');
  }

  async deleteLocationTray(locationTrayId: Uuid, userId: Uuid): Promise<void> {
    await this.locationTrayRepo.manager.transaction(async manager => {
      const repo = manager.getRepository(LocationTrayOrmEntity);
      const assignment = await repo.findOne({ where: { id: locationTrayId } });
      if (!assignment) throw new UnprocessableEntityException('Error removing tray from location');
      const tray = await manager.getRepository(TrayOrmEntity).findOne({ where: { id: assignment.tray_id }, lock: { mode: 'pessimistic_write' } });
      if (!tray) throw new NotFoundException('Tray not found');
      if (!assignment.enabled) return;
      const journal = await beginWorkflowJournal(manager, { app: 'BLADE_TRACKING', trayIds: [tray.id] }, userId);
      assignment.enabled = false;
      assignment.updatedBy = userId;
      await repo.save(assignment);
      await journal.commit(tray.serial_number, 'Remove tray from shelf');
    });
  }
}
