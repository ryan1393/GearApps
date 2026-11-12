import { FindOptionsWhere, In, Repository } from 'typeorm';

import {
  BladeHistoryOrmEntity,
  BladeListQueryDto,
  BladeOrmEntity,
  BladeTrayOrmEntity,
  CutterBuildBladeOrmEntity,
  ContainerOrmEntity,
  CreateBladeDto,
  PaginationService,
  TrayOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import {
  BladeHistoryEvent,
  BladeStatus,
  IBladeEntity,
  SortOrderType,
  Uuid,
} from '@meshforge/manufacturing/shared/util-types';
import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class ServerFeatBladeService extends PaginationService<BladeOrmEntity> {
  private readonly logger = new Logger(ServerFeatBladeService.name);

  constructor(
    @InjectRepository(BladeOrmEntity)
    private readonly bladeRepo: Repository<BladeOrmEntity>,
    @InjectRepository(BladeHistoryOrmEntity)
    private readonly bladeHistoryRepo: Repository<BladeHistoryOrmEntity>,
  ) {
    super(BladeOrmEntity.prototype, bladeRepo);
  }

  async findBlade(
    find: FindOptionsWhere<BladeOrmEntity>,
  ): Promise<BladeOrmEntity | null> {
    return this.bladeRepo.findOneBy(find);
  }

  async createBlade(dto: CreateBladeDto, userId: Uuid): Promise<BladeOrmEntity> {
    const existing = await this.bladeRepo.findOne({
      where: { serial_number: dto.serial_number },
    });

    if (existing) {
      throw new UnprocessableEntityException(
        `Blade serial number ${dto.serial_number} already exists`,
      );
    }

    return this.bladeRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(BladeOrmEntity);
      const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
      const blade = repo.create({
        ...dto,
        status: dto.status ?? BladeStatus.NEW,
        service_cycle: dto.service_cycle ?? 0,
        enabled: dto.enabled ?? true,
        createdBy: userId,
        updatedBy: userId,
      });
      const saved = await repo.save(blade);

      await historyRepo.save(
        historyRepo.create({
          blade_id: saved.id,
          event_type: BladeHistoryEvent.CREATED,
          from_status: null,
          to_status: saved.status,
          service_cycle: saved.service_cycle,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      return saved;
    });
  }

  async getBlade(bladeId: Uuid) {
    return this.bladeRepo.findOneOrFail({ where: { id: bladeId } });
  }

  async getBlades(query?: BladeListQueryDto) {
    const page = Math.max(query?.page ?? 1, 1);
    const perPage = Math.min(Math.max(query?.perPage ?? 50, 1), 50);
    const search = query?.search?.trim();

    const qb = this.bladeRepo
      .createQueryBuilder('blade')
      .leftJoinAndSelect('blade.summary', 'summary')
      .leftJoinAndSelect('blade.part_type', 'part_type');

    if (query?.status) {
      qb.andWhere('blade.status = :status', { status: query.status });
    }

    if (search) {
      qb.andWhere(
        '(blade.serial_number ILIKE :search OR summary.number ILIKE :search OR part_type.code ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (query?.status === BladeStatus.SCRAPPED) {
      qb.orderBy('blade.updatedAt', 'DESC').addOrderBy('blade.serial_number', 'ASC');
    } else {
      qb.orderBy(
        'blade.serial_number',
        query?.order ?? SortOrderType.ASC,
      );
    }

    const [items, totalItems] = await qb
      .take(perPage)
      .skip((page - 1) * perPage)
      .getManyAndCount();

    const bladeIds = items.map((item) => item.id);
    const assignments = bladeIds.length
      ? await this.bladeRepo.manager.getRepository(BladeTrayOrmEntity).find({
          where: {
            blade_id: In(bladeIds),
            enabled: true,
          },
          relations: {
            tray: {
              summary: true,
              part_type: true,
              current_stage: true,
            },
          },
        })
      : [];

    const trayByBlade = new Map<string, TrayOrmEntity>(
      assignments.map(
        (assignment) =>
          [assignment.blade_id, assignment.tray] as [string, TrayOrmEntity],
      ),
    );

    const scrapHistory = bladeIds.length
      ? await this.bladeHistoryRepo.find({
          where: {
            blade_id: In(bladeIds),
            event_type: BladeHistoryEvent.SCRAPPED,
          },
          relations: { createdByUser: true },
          order: { createdAt: 'DESC' },
        })
      : [];

    const scrapHistoryByBlade = new Map<string, BladeHistoryOrmEntity>();
    for (const history of scrapHistory) {
      if (!scrapHistoryByBlade.has(history.blade_id)) {
        scrapHistoryByBlade.set(history.blade_id, history);
      }
    }

    const scrapTrayIds = Array.from(
      new Set(
        scrapHistory
          .map((history) => history.tray_id)
          .filter((id): id is Uuid => Boolean(id)),
      ),
    );
    const scrapTrays = scrapTrayIds.length
      ? await this.bladeRepo.manager.getRepository(TrayOrmEntity).find({
          where: { id: In(scrapTrayIds) },
        })
      : [];
    const scrapTrayById = new Map(
      scrapTrays.map((tray) => [tray.id, tray.serial_number] as const),
    );

    const totalPages = Math.max(Math.ceil(totalItems / perPage), 1);

    return {
      data: items.map((entity) => {
        const scrap = scrapHistoryByBlade.get(entity.id);
        const actorName = scrap
          ? [scrap.createdByUser?.firstName, scrap.createdByUser?.lastName]
              .filter(Boolean)
              .join(' ')
              .trim()
          : '';

        return {
          ...entity.toJSON(),
          current_tray: trayByBlade.get(entity.id)
            ? {
                id: trayByBlade.get(entity.id)!.id,
                serial_number: trayByBlade.get(entity.id)!.serial_number,
                stage_code: trayByBlade.get(entity.id)!.current_stage?.code ?? null,
                stage_name: trayByBlade.get(entity.id)!.current_stage?.name ?? null,
              }
            : null,
          scrap_details: scrap
            ? {
                occurred_at: scrap.createdAt,
                notes: scrap.notes ?? null,
                tray_serial_number: scrap.tray_id
                  ? scrapTrayById.get(scrap.tray_id) ?? null
                  : null,
                actor: actorName || scrap.createdByUser?.email || null,
              }
            : null,
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

  async getBladeHistory(bladeId: Uuid) {
    await this.bladeRepo.findOneOrFail({ where: { id: bladeId } });

    const history = await this.bladeHistoryRepo.find({
      where: { blade_id: bladeId },
      relations: { createdByUser: true },
      order: { createdAt: 'ASC' },
    });

    const trayIds = Array.from(
      new Set(
        history
          .map((item) => item.tray_id)
          .filter((id): id is Uuid => Boolean(id)),
      ),
    );
    const containerIds = Array.from(
      new Set(
        history
          .map((item) => item.container_id)
          .filter((id): id is Uuid => Boolean(id)),
      ),
    );

    const [trays, containers] = await Promise.all([
      trayIds.length
        ? this.bladeRepo.manager.getRepository(TrayOrmEntity).find({
            where: { id: In(trayIds) },
          })
        : Promise.resolve([] as TrayOrmEntity[]),
      containerIds.length
        ? this.bladeRepo.manager.getRepository(ContainerOrmEntity).find({
            where: { id: In(containerIds) },
          })
        : Promise.resolve([] as ContainerOrmEntity[]),
    ]);

    const traySerialById = new Map(
      trays.map((tray) => [tray.id, tray.serial_number] as const),
    );
    const containerSerialById = new Map(
      containers.map(
        (container) => [container.id, container.serial_number] as const,
      ),
    );

    return history.map((item) => {
      const actorName = [
        item.createdByUser?.firstName,
        item.createdByUser?.lastName,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();

      return {
        id: item.id,
        blade_id: item.blade_id,
        event_type: item.event_type,
        from_status: item.from_status ?? null,
        to_status: item.to_status ?? null,
        service_cycle: item.service_cycle,
        tray_id: item.tray_id ?? null,
        container_id: item.container_id ?? null,
        notes: item.notes ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        createdBy: item.createdBy,
        occurred_at: item.createdAt,
        tray_serial_number: item.tray_id
          ? traySerialById.get(item.tray_id) ?? null
          : null,
        container_serial_number: item.container_id
          ? containerSerialById.get(item.container_id) ?? null
          : null,
        actor: actorName || item.createdByUser?.email || null,
      };
    });
  }

  /**
   * Administrator correction of a loose blade (in no tray, coater set or cutter). Status is not
   * editable here: it changes only through the intake, grinding, coater, cutter and scrap
   * workflows, which record its history, so a scrapped blade can never come back this way.
   */
  async updateBlade(bladeId: Uuid, data: Partial<IBladeEntity>, userId: Uuid) {
    return this.bladeRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(BladeOrmEntity);
      const existing = await repo.findOneOrFail({ where: { id: bladeId }, lock: { mode: 'pessimistic_write' } });
      await this.assertBladeUnassigned(manager, bladeId);
      if (data.status !== undefined && data.status !== existing.status) {
        throw new UnprocessableEntityException(
          'Blade status changes only through the intake, grinding, coater, cutter and scrap workflows.',
        );
      }
      const changes = Object.fromEntries(
        Object.entries(data).filter(([key, value]) => value !== undefined && !['id', 'status'].includes(key)),
      );
      return repo.save({ ...existing, ...changes, id: bladeId, updatedBy: userId });
    });
  }

  private async assertBladeUnassigned(manager: import('typeorm').EntityManager, bladeId: Uuid): Promise<void> {
    const [tray, build, packedSets] = await Promise.all([
      manager.getRepository(BladeTrayOrmEntity).count({ where: { blade_id: bladeId, enabled: true } }),
      manager.getRepository(CutterBuildBladeOrmEntity).count({ where: { blade_id: bladeId, enabled: true } }),
      manager.query(
        'SELECT id FROM public.container_set_blades WHERE blade_id=$1 AND enabled AND "deletedAt" IS NULL', [bladeId],
      ) as Promise<unknown[]>,
    ]);
    if (tray || build || packedSets.length) throw new ConflictException('Remove this blade through its tray or cutter workflow before editing or deleting it');
  }

  async deleteBlade(bladeId: Uuid, userId: Uuid): Promise<void> {
    await this.bladeRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(BladeOrmEntity);
      const blade = await repo.findOne({ where: { id: bladeId }, lock: { mode: 'pessimistic_write' } });
      if (!blade) throw new UnprocessableEntityException('Error deleting blade');
      await this.assertBladeUnassigned(manager, bladeId);
      blade.deletedBy = userId;
      blade.updatedBy = userId;
      await repo.save(blade);
      await repo.softRemove(blade);
    });
  }

}
