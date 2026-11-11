import { containerWorkflowEligibility } from '@meshforge/manufacturing/shared/util-constants';
import { EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';

import {
  BladeTrayOrmEntity,
  lockCoaterInventory,
  ContainerOrmEntity,
  ContainerTrayOrmEntity,
  CreateContainerDto,
  InventoryListQueryDto,
  PaginationService,
} from '@meshforge/manufacturing/server/data-access';
import {
  IPaginatedResponse,
  IContainer,
  IContainerEntity,
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

/** A container's complete blade set (moved out of its tray), as shown on container screens. */
export interface ContainerBladeSetView {
  id: string;
  summary_number: string | null;
  part_type_code: string | null;
  required_blade_count: number;
  location_serial_number: string | null;
  packed_from_tray_serial_number: string | null;
  packed_at: string;
  /** PACKED_FOR_COATER until dispatched, then AT_COATER (from the blades' status). */
  stage_code: 'PACKED_FOR_COATER' | 'AT_COATER' | 'NEEDS_REVIEW';
  blades: Array<{ id: string; serial_number: string; status: string; service_cycle: number; summary_number: string | null; part_type_code: string | null }>;
}

export async function loadContainerBladeSets(manager: EntityManager, containerIds: string[]): Promise<Map<string, ContainerBladeSetView>> {
  const result = new Map<string, ContainerBladeSetView>();
  if (!containerIds.length) return result;
  const sets = await manager.query(
    `SELECT cs.id, cs.container_id, cs.required_blade_count, cs.packed_at, ps.number AS summary_number, pt.code AS part_type_code,
            l.serial_number AS location_serial_number, t.serial_number AS packed_from_tray_serial_number
       FROM container_sets cs
       LEFT JOIN part_summaries ps ON ps.id = cs.summary_id
       LEFT JOIN part_types pt ON pt.id = cs.part_type_id
       LEFT JOIN locations l ON l.id = cs.location_id
       LEFT JOIN trays t ON t.id = cs.packed_from_tray_id
      WHERE cs.container_id::text = ANY($1::text[]) AND cs.enabled AND cs."deletedAt" IS NULL`,
    [containerIds],
  );
  if (!sets.length) return result;
  const blades = await manager.query(
    `SELECT sb.container_set_id, b.id, b.serial_number, b.status, b.service_cycle, ps.number AS summary_number, pt.code AS part_type_code
       FROM container_set_blades sb
       JOIN blades b ON b.id = sb.blade_id AND b.enabled
       LEFT JOIN part_summaries ps ON ps.id = b.summary_id
       LEFT JOIN part_types pt ON pt.id = b.part_type_id
      WHERE sb.container_set_id::text = ANY($1::text[]) AND sb.enabled AND sb."deletedAt" IS NULL
      ORDER BY b.serial_number, b.id`,
    [sets.map((set: { id: string }) => set.id)],
  );
  for (const set of sets) {
    const own = blades.filter((blade: { container_set_id: string }) => blade.container_set_id === set.id)
      .map((blade: { id: string; serial_number: string; status: string; service_cycle: number; summary_number: string | null; part_type_code: string | null }) => ({
        id: blade.id, serial_number: blade.serial_number, status: blade.status, service_cycle: blade.service_cycle,
        summary_number: blade.summary_number, part_type_code: blade.part_type_code,
      }));
    const statuses = new Set(own.map((blade: { status: string }) => blade.status));
    result.set(set.container_id, {
      id: set.id,
      summary_number: set.summary_number,
      part_type_code: set.part_type_code,
      required_blade_count: set.required_blade_count,
      location_serial_number: set.location_serial_number,
      packed_from_tray_serial_number: set.packed_from_tray_serial_number,
      packed_at: new Date(set.packed_at).toISOString(),
      stage_code: statuses.size !== 1 ? 'NEEDS_REVIEW' : statuses.has('at_coater') ? 'AT_COATER' : statuses.has('ready_for_coating') ? 'PACKED_FOR_COATER' : 'NEEDS_REVIEW',
      blades: own,
    });
  }
  return result;
}

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
    const bladeSet = (await loadContainerBladeSets(this.containerRepo.manager, [container.id])).get(container.id) ?? null;
    return {
      ...container.toJSON(),
      workflow_eligibility: containerWorkflowEligibility(container.enabled, assignments.length, trays, bladeSet),
      tray_count: trays.length,
      blade_count: trays.reduce((total, tray) => total + Number(tray.blade_count ?? 0), 0) + (bladeSet?.blades.length ?? 0),
      trays,
      blade_set: bladeSet,
    };
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

    const bladeSets = await loadContainerBladeSets(this.containerRepo.manager, containerIds);
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
          workflow_eligibility: containerWorkflowEligibility(entity.enabled, assignments.filter(a => a.container_id === entity.id).length, trays, bladeSets.get(entity.id) ?? null),
          tray_count: trays.length,
          blade_count: trays.reduce(
            (total, tray) => total + Number(tray.blade_count ?? 0),
            0,
          ) + (bladeSets.get(entity.id)?.blades.length ?? 0),
          trays,
          blade_set: bladeSets.get(entity.id) ?? null,
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
        const [setCount] = await manager.query('SELECT count(*)::int AS sets FROM container_sets WHERE container_id = $1 AND enabled AND "deletedAt" IS NULL', [containerId]);
        const sets = Number(setCount?.sets ?? 0);
        const reserved = await manager.query('SELECT container_id FROM dana_coater_shipment_containers_v1 WHERE container_id=$1 AND reserved=true', [containerId]);
        if (assigned || sets || reserved.length) throw new ConflictException('Unload this container and remove its active shipment reservation before renaming or disabling it');
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
