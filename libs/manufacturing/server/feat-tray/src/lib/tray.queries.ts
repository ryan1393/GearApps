/**
 * Read-only tray queries (paged inventory list, Blade Tracking dashboard).
 * ServerFeatTrayService delegates here; grinding and other writes stay in the service.
 */
import {
  isPendingGrindingStatus,
  trayWorkflowEligibility,
} from '@meshforge/manufacturing/shared/util-constants';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  BladeOrmEntity,
  BladeTrayOrmEntity,
  ContainerOrmEntity,
  ContainerTrayOrmEntity,
  LocationOrmEntity,
  LocationTrayOrmEntity,
  CutterBuildTrayOrmEntity,
  InventoryListQueryDto,
  TrayOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import { BladeStatus } from '@meshforge/manufacturing/shared/util-types';

export async function listTrays(
  trayRepo: Repository<TrayOrmEntity>,
  query?: InventoryListQueryDto,
) {
  const page = Math.max(query?.page ?? 1, 1);
  const perPage = Math.min(Math.max(query?.perPage ?? 50, 1), 50);
  const search = query?.search?.trim();

  const qb = trayRepo
    .createQueryBuilder('tray')
    .leftJoinAndSelect('tray.summary', 'summary')
    .leftJoinAndSelect('tray.part_type', 'part_type')
    .leftJoinAndSelect('tray.current_stage', 'current_stage');

  if (search) {
    qb.andWhere(
      `(tray.serial_number ILIKE :search
          OR summary.number ILIKE :search
          OR part_type.code ILIKE :search
          OR current_stage.code ILIKE :search
          OR current_stage.name ILIKE :search)`,
      { search: `%${search}%` },
    );
  }

  const [items, totalItems] = await qb
    .orderBy('tray.serial_number', 'ASC')
    .take(perPage)
    .skip((page - 1) * perPage)
    .getManyAndCount();

  const trayIds = items.map((item) => item.id);
  const [
    bladeAssignments,
    containerAssignments,
    locationAssignments,
    cutterAssignments,
  ] = trayIds.length
    ? await Promise.all([
        trayRepo.manager.getRepository(BladeTrayOrmEntity).find({
          where: { tray_id: In(trayIds), enabled: true },
          relations: {
            blade: {
              summary: true,
              part_type: true,
            },
          },
          order: { createdAt: 'ASC' },
        }),
        trayRepo.manager.getRepository(ContainerTrayOrmEntity).find({
          where: { tray_id: In(trayIds), enabled: true },
          relations: { container: true },
        }),
        trayRepo.manager.getRepository(LocationTrayOrmEntity).find({
          where: { tray_id: In(trayIds), enabled: true },
          relations: { location: true },
        }),
        trayRepo.manager
          .getRepository(CutterBuildTrayOrmEntity)
          .find({ where: { tray_id: In(trayIds), enabled: true } }),
      ])
    : [[], [], [], []];

  const bladesByTray = new Map<string, BladeTrayOrmEntity[]>();
  for (const assignment of bladeAssignments) {
    const rows = bladesByTray.get(assignment.tray_id) ?? [];
    rows.push(assignment);
    bladesByTray.set(assignment.tray_id, rows);
  }

  const containerByTray = new Map<string, ContainerOrmEntity>(
    containerAssignments.map(
      (assignment) =>
        [assignment.tray_id, assignment.container] as [
          string,
          ContainerOrmEntity,
        ],
    ),
  );
  const locationByTray = new Map<string, LocationOrmEntity>(
    locationAssignments.map(
      (assignment) =>
        [assignment.tray_id, assignment.location] as [
          string,
          LocationOrmEntity,
        ],
    ),
  );

  const cutterByTray = new Map(
    cutterAssignments.map((a) => [a.tray_id, a.cutter_build_id]),
  );
  const totalPages = Math.max(Math.ceil(totalItems / perPage), 1);

  return {
    data: items
      .map((entity) => ({
        ...entity.toJSON(),
        current_cutter_build: cutterByTray.has(entity.id)
          ? { id: cutterByTray.get(entity.id)! }
          : null,
        blades: (bladesByTray.get(entity.id) ?? [])
          .filter(({ blade }) => blade.enabled)
          .map(({ blade }) => ({
            id: blade.id,
            serial_number: blade.serial_number,
            status: blade.status,
            service_cycle: blade.service_cycle,
            summary_number: blade.summary?.number ?? null,
            part_type_code: blade.part_type?.code ?? null,
          })),
        current_container: containerByTray.get(entity.id)
          ? {
              id: containerByTray.get(entity.id)!.id,
              serial_number: containerByTray.get(entity.id)!.serial_number,
            }
          : null,
        current_location: locationByTray.get(entity.id)
          ? {
              id: locationByTray.get(entity.id)!.id,
              serial_number: locationByTray.get(entity.id)!.serial_number,
              number: locationByTray.get(entity.id)!.number,
              description: locationByTray.get(entity.id)!.description,
              department: locationByTray.get(entity.id)!.department,
              location_type: locationByTray.get(entity.id)!.location_type,
            }
          : null,
      }))
      .map((view) => ({
        ...view,
        workflow_eligibility: trayWorkflowEligibility(view),
        pending_grinding_count: view.blades.filter((b) =>
          isPendingGrindingStatus(b.status),
        ).length,
      })),
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

export async function loadTrayDashboard(trayRepo: Repository<TrayOrmEntity>) {
  const bladeRepo = trayRepo.manager.getRepository(BladeOrmEntity);
  const containerTrayRepo = trayRepo.manager.getRepository(
    ContainerTrayOrmEntity,
  );
  const locationTrayRepo = trayRepo.manager.getRepository(
    LocationTrayOrmEntity,
  );

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    bladesInProcess,
    totalEnabledTrays,
    traysAtCoater,
    locationMovesToday,
    containerLoadsToday,
    containerReturnsToday,
    stageRows,
    locationRows,
    coaterRows,
    recentLocationAssignments,
    recentContainerAssignments,
  ] = await Promise.all([
    bladeRepo
      .createQueryBuilder('blade')
      .where('blade.enabled = :enabled', { enabled: true })
      .andWhere('blade.status <> :scrapped', {
        scrapped: BladeStatus.SCRAPPED,
      })
      .getCount(),
    trayRepo.count({ where: { enabled: true } }),
    containerTrayRepo
      .createQueryBuilder('assignment')
      .innerJoin('assignment.tray', 'tray')
      .innerJoin('tray.current_stage', 'stage')
      .where('assignment.enabled = :enabled', { enabled: true })
      .andWhere('tray.enabled = true AND stage.code = :atCoater', {
        atCoater: 'AT_COATER',
      })
      .getCount(),
    locationTrayRepo
      .createQueryBuilder('assignment')
      .where('assignment.createdAt >= :startOfToday', { startOfToday })
      .andWhere('assignment.createdBy IS NOT NULL')
      .getCount(),
    containerTrayRepo
      .createQueryBuilder('assignment')
      .where('assignment.createdAt >= :startOfToday', { startOfToday })
      .andWhere('assignment.createdBy IS NOT NULL')
      .getCount(),
    containerTrayRepo
      .createQueryBuilder('assignment')
      .where('assignment.enabled = :enabled', { enabled: false })
      .andWhere('assignment.updatedAt >= :startOfToday', { startOfToday })
      .andWhere('assignment.updatedAt > assignment.createdAt')
      .andWhere('assignment.updatedBy IS NOT NULL')
      .getCount(),
    trayRepo
      .createQueryBuilder('tray')
      .leftJoin('tray.current_stage', 'stage')
      .select("COALESCE(stage.code, 'UNASSIGNED')", 'code')
      .addSelect("COALESCE(stage.name, 'Unassigned')", 'name')
      .addSelect('COUNT(tray.id)', 'tray_count')
      .addSelect('COALESCE(SUM(tray.blade_count), 0)', 'blade_count')
      .where('tray.enabled = :enabled', { enabled: true })
      .groupBy('stage.code')
      .addGroupBy('stage.name')
      .orderBy('COUNT(tray.id)', 'DESC')
      .getRawMany<{
        code: string;
        name: string;
        tray_count: string;
        blade_count: string;
      }>(),
    locationTrayRepo
      .createQueryBuilder('assignment')
      .innerJoin('assignment.location', 'location')
      .innerJoin('assignment.tray', 'tray')
      .select('location.id', 'id')
      .addSelect('location.serial_number', 'serial_number')
      .addSelect('location.number', 'number')
      .addSelect('location.description', 'description')
      .addSelect('location.department', 'department')
      .addSelect('location.location_type', 'location_type')
      .addSelect('COUNT(assignment.id)', 'tray_count')
      .addSelect('COALESCE(SUM(tray.blade_count), 0)', 'blade_count')
      .where('assignment.enabled = :enabled', { enabled: true })
      .andWhere('tray.enabled = :trayEnabled', { trayEnabled: true })
      .groupBy('location.id')
      .addGroupBy('location.serial_number')
      .addGroupBy('location.number')
      .addGroupBy('location.description')
      .addGroupBy('location.department')
      .addGroupBy('location.location_type')
      .orderBy('COUNT(assignment.id)', 'DESC')
      .addOrderBy('location.serial_number', 'ASC')
      .limit(8)
      .getRawMany<{
        id: string;
        serial_number: string;
        number: string;
        description: string | null;
        department: string | null;
        location_type: string;
        tray_count: string;
        blade_count: string;
      }>(),
    containerTrayRepo
      .createQueryBuilder('assignment')
      .innerJoin('assignment.container', 'container')
      .innerJoin('assignment.tray', 'tray')
      .innerJoin('tray.current_stage', 'stage')
      .select('container.id', 'id')
      .addSelect('container.serial_number', 'serial_number')
      .addSelect('COUNT(assignment.id)', 'tray_count')
      .addSelect('COALESCE(SUM(tray.blade_count), 0)', 'blade_count')
      .where('assignment.enabled = :enabled', { enabled: true })
      .andWhere('tray.enabled = :trayEnabled', { trayEnabled: true })
      .andWhere('stage.code = :atCoater', { atCoater: 'AT_COATER' })
      .groupBy('container.id')
      .addGroupBy('container.serial_number')
      .orderBy('COUNT(assignment.id)', 'DESC')
      .addOrderBy('container.serial_number', 'ASC')
      .limit(8)
      .getRawMany<{
        id: string;
        serial_number: string;
        tray_count: string;
        blade_count: string;
      }>(),
    locationTrayRepo.find({
      where: { createdBy: Not(IsNull()) },
      relations: {
        tray: true,
        location: true,
      },
      order: { createdAt: 'DESC' },
      take: 10,
    }),
    containerTrayRepo.find({
      where: { createdBy: Not(IsNull()) },
      relations: {
        tray: true,
        container: true,
      },
      order: { updatedAt: 'DESC' },
      take: 10,
    }),
  ]);

  const recentActivity = [
    ...recentLocationAssignments.map((assignment) => ({
      type: 'LOCATION_MOVE' as const,
      occurred_at: assignment.createdAt,
      title: `${assignment.tray.serial_number} moved`,
      detail: `Moved to ${assignment.location.serial_number}${
        assignment.location.description
          ? ` · ${assignment.location.description}`
          : ''
      }`,
      tray_serial_number: assignment.tray.serial_number,
      destination_serial_number: assignment.location.serial_number,
    })),
    ...recentContainerAssignments.flatMap((assignment) => {
      const events: Array<{
        type: 'CONTAINER_LOAD' | 'CONTAINER_RETURN';
        occurred_at: Date;
        title: string;
        detail: string;
        tray_serial_number: string;
        destination_serial_number: string;
      }> = [
        {
          type: 'CONTAINER_LOAD',
          occurred_at: assignment.createdAt,
          title: `${assignment.tray.serial_number} loaded`,
          detail: `Loaded into ${assignment.container.serial_number}`,
          tray_serial_number: assignment.tray.serial_number,
          destination_serial_number: assignment.container.serial_number,
        },
      ];

      if (
        !assignment.enabled &&
        assignment.updatedAt.getTime() > assignment.createdAt.getTime()
      ) {
        events.push({
          type: 'CONTAINER_RETURN' as const,
          occurred_at: assignment.updatedAt,
          title: `${assignment.tray.serial_number} returned`,
          detail: `Removed from ${assignment.container.serial_number}`,
          tray_serial_number: assignment.tray.serial_number,
          destination_serial_number: assignment.container.serial_number,
        });
      }

      return events;
    }),
  ]
    .sort(
      (left, right) => right.occurred_at.getTime() - left.occurred_at.getTime(),
    )
    .slice(0, 10);

  return {
    generated_at: new Date(),
    counts: {
      blades_in_process: bladesInProcess,
      trays_at_coater: traysAtCoater,
      trays_in_house: Math.max(totalEnabledTrays - traysAtCoater, 0),
      total_trays: totalEnabledTrays,
      movements_today:
        locationMovesToday + containerLoadsToday + containerReturnsToday,
    },
    stage_breakdown: stageRows.map((row) => ({
      code: row.code,
      name: row.name,
      tray_count: Number(row.tray_count),
      blade_count: Number(row.blade_count),
    })),
    top_locations: locationRows.map((row) => ({
      ...row,
      tray_count: Number(row.tray_count),
      blade_count: Number(row.blade_count),
    })),
    coater_containers: coaterRows.map((row) => ({
      ...row,
      tray_count: Number(row.tray_count),
      blade_count: Number(row.blade_count),
    })),
    recent_activity: recentActivity,
  };
}
