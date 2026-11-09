import { containerWorkflowEligibility } from '@libs/shared/util-constants';
import { FindOptionsWhere, In, Repository } from 'typeorm';

import {
  BladeTrayOrmEntity,
  lockCoaterInventory,
  ContainerOrmEntity,
  ContainerTrayOrmEntity,
  CreateContainerDto,
  InventoryListQueryDto,
  PaginationService,
} from '@libs/server/data-access';
import {
  IPaginatedResponse,
  IContainer,
  IContainerEntity,
  Uuid,
} from '@libs/shared/util-types';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class ServerFeatContainerService extends PaginationService<ContainerOrmEntity> {
  private readonly logger = new Logger(ServerFeatContainerService.name);

  constructor(
    @InjectRepository(ContainerOrmEntity)
    private containerRepo: Repository<ContainerOrmEntity>,
  ) {
    super(ContainerOrmEntity.prototype, containerRepo);
  }

  async findContainer(
    find: FindOptionsWhere<ContainerOrmEntity>,
  ): Promise<ContainerOrmEntity | null> {
    return this.containerRepo.findOneBy(find);
  }

  async createContainer(dto: CreateContainerDto, userId: Uuid): Promise<ContainerOrmEntity> {
    const serialNumber = this.normalizeSequentialSerial('C', dto.serial_number, 'Container');
    const duplicate = await this.containerRepo.findOne({ where: { serial_number: serialNumber } });
    if (duplicate) {
      throw new ConflictException(`Container serial ${serialNumber} already exists`);
    }

    const container = this.containerRepo.create({
      ...dto,
      serial_number: serialNumber,
      createdBy: userId,
      updatedBy: userId,
    });
    await container.save();
    return container;
  }

  async getContainerBySerialNumber(serialNumber: string) {
    const container = await this.containerRepo.findOne({
      where: { serial_number: serialNumber.trim().toUpperCase(), enabled: true },
    });

    if (!container) {
      throw new NotFoundException(`Container ${serialNumber} could not be found`);
    }

    const assignments = await this.containerRepo.manager.getRepository(ContainerTrayOrmEntity).find({
      where: { container_id: container.id, enabled: true },
      relations: { tray: { summary: true, part_type: true, current_stage: true } },
      order: { createdAt: 'ASC' },
    });
    const activeAssignments = assignments.filter(({ tray }) => tray.enabled);
    const trayIds = activeAssignments.map(({ tray_id }) => tray_id);
    const bladeAssignments = trayIds.length
      ? await this.containerRepo.manager.getRepository(BladeTrayOrmEntity).find({
          where: { tray_id: In(trayIds), enabled: true },
          relations: { blade: { summary: true, part_type: true } },
          order: { createdAt: 'ASC' },
        })
      : [];
    const bladesByTray = new Map<string, BladeTrayOrmEntity[]>();
    for (const assignment of bladeAssignments) {
      if (!assignment.blade.enabled) continue;
      const rows = bladesByTray.get(assignment.tray_id) ?? [];
      rows.push(assignment);
      bladesByTray.set(assignment.tray_id, rows);
    }
    const trays = activeAssignments.map(({ tray }) => ({
      id: tray.id,
      serial_number: tray.serial_number,
      blade_count: tray.blade_count,
      summary_number: tray.summary?.number ?? null,
      part_type_code: tray.part_type?.code ?? null,
      stage_code: tray.current_stage?.code ?? null,
      stage_name: tray.current_stage?.name ?? null,
      blades: (bladesByTray.get(tray.id) ?? []).map(({ blade }) => ({
        id: blade.id,
        serial_number: blade.serial_number,
        status: blade.status,
        service_cycle: blade.service_cycle,
        summary_number: blade.summary?.number ?? null,
        part_type_code: blade.part_type?.code ?? null,
      })),
    }));
    return { ...container.toJSON(), workflow_eligibility: containerWorkflowEligibility(container.enabled, assignments.length, trays), tray_count: trays.length, blade_count: trays.reduce((total, tray) => total + Number(tray.blade_count ?? 0), 0), trays };
  }

  async getContainer(containerId: Uuid) {
    return await this.containerRepo.findOneOrFail({ where: { id: containerId } });
  }

  async getContainers(
    query?: InventoryListQueryDto,
  ) {
    const page = Math.max(query?.page ?? 1, 1);
    const perPage = Math.min(Math.max(query?.perPage ?? 50, 1), 50);
    const search = query?.search?.trim();

    const qb = this.containerRepo.createQueryBuilder('container');

    if (search) {
      qb.andWhere('container.serial_number ILIKE :search', {
        search: `%${search}%`,
      });
    }

    const [items, totalItems] = await qb
      .orderBy('container.serial_number', 'ASC')
      .take(perPage)
      .skip((page - 1) * perPage)
      .getManyAndCount();

    const containerIds = items.map((item) => item.id);
    const assignments = containerIds.length
      ? await this.containerRepo.manager
          .getRepository(ContainerTrayOrmEntity)
          .find({
            where: {
              container_id: In(containerIds),
              enabled: true,
            },
            relations: {
              tray: {
                summary: true,
                part_type: true,
                current_stage: true,
              },
            },
            order: { createdAt: 'ASC' },
          })
      : [];

    const activeAssignments = assignments.filter(({ tray }) => tray.enabled);
    const trayIds = activeAssignments.map(({ tray_id }) => tray_id);
    const bladeAssignments = trayIds.length
      ? await this.containerRepo.manager.getRepository(BladeTrayOrmEntity).find({
          where: { tray_id: In(trayIds), enabled: true },
          relations: { blade: { summary: true, part_type: true } },
          order: { createdAt: 'ASC' },
        })
      : [];

    const bladesByTray = new Map<string, BladeTrayOrmEntity[]>();
    for (const assignment of bladeAssignments) {
      if (!assignment.blade.enabled) continue;
      const rows = bladesByTray.get(assignment.tray_id) ?? [];
      rows.push(assignment);
      bladesByTray.set(assignment.tray_id, rows);
    }

    const traysByContainer = new Map<string, ContainerTrayOrmEntity[]>();
    for (const assignment of activeAssignments) {
      const rows = traysByContainer.get(assignment.container_id) ?? [];
      rows.push(assignment);
      traysByContainer.set(assignment.container_id, rows);
    }

    const totalPages = Math.max(Math.ceil(totalItems / perPage), 1);

    return {
      data: items.map((entity) => {
        const activeAssignments = traysByContainer.get(entity.id) ?? [];
        const trays = activeAssignments.map(({ tray }) => ({
          id: tray.id,
          serial_number: tray.serial_number,
          blade_count: tray.blade_count,
          summary_number: tray.summary?.number ?? null,
          part_type_code: tray.part_type?.code ?? null,
          stage_code: tray.current_stage?.code ?? null,
          stage_name: tray.current_stage?.name ?? null,
          blades: (bladesByTray.get(tray.id) ?? []).map(({ blade }) => ({
            id: blade.id,
            serial_number: blade.serial_number,
            status: blade.status,
            service_cycle: blade.service_cycle,
            summary_number: blade.summary?.number ?? null,
            part_type_code: blade.part_type?.code ?? null,
          })),
        }));

        return {
          ...entity.toJSON(),
          workflow_eligibility: containerWorkflowEligibility(entity.enabled, assignments.filter(a => a.container_id === entity.id).length, trays),
          tray_count: trays.length,
          blade_count: trays.reduce(
            (total, tray) => total + Number(tray.blade_count ?? 0),
            0,
          ),
          trays,
        };
      }),
      meta: {
        page,
        perPage,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
        nextPage: page < totalPages ? String(page + 1) : null,
        previousPage: page > 1 ? String(page - 1) : null,
      },
    };
  }

  // async getContainerByEmail(email: string): Promise<ContainerOrmEntity> {
  //   const container = await this.containerRepo.findOne({
  //     where: {
  //       email,
  //     },
  //   });

  //   if (!container) {
  //     throw new NotFoundException(`Container could not be found!`);
  //   }

  //   return container;
  // }

  async updateContainer(containerId: Uuid, data: Partial<IContainerEntity>, userId: Uuid) {
    return this.containerRepo.manager.transaction(async (manager) => {
      await lockCoaterInventory(manager);
      const repo = manager.getRepository(ContainerOrmEntity);
      const container = await repo.findOneOrFail({ where: { id: containerId }, lock: { mode: 'pessimistic_write' } });
      const serialNumber = data.serial_number === undefined ? container.serial_number : this.normalizeSequentialSerial('C', data.serial_number, 'Container');
      if (data.enabled === false || serialNumber !== container.serial_number) {
        const assigned = await manager.getRepository(ContainerTrayOrmEntity).count({ where: { container_id: containerId, enabled: true } });
        const reserved = await manager.query('SELECT container_id FROM dana_coater_shipment_containers_v1 WHERE container_id=$1 AND reserved=true', [containerId]);
        if (assigned || reserved.length) throw new ConflictException('Unload this container and remove its active shipment reservation before renaming or disabling it');
      }
      if (serialNumber !== container.serial_number) {
        const duplicate = await repo.findOne({ where: { serial_number: serialNumber } });
        if (duplicate && duplicate.id !== containerId) throw new ConflictException(`Container serial ${serialNumber} already exists`);
      }
      container.serial_number = serialNumber;
      if (data.enabled !== undefined) container.enabled = data.enabled;
      container.updatedBy = userId;
      return repo.save(container);
    });
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

  async deleteContainer(containerId: Uuid, userId: Uuid): Promise<void> {
    await this.updateContainer(containerId, { enabled: false }, userId);
  }

}
