/**
 * Read-only Cutter Builder queries (dashboard, build search) and the cutter body
 * identifier helpers. ServerFeatCutterBuildService delegates here; all writes stay there.
 */
import {
  LocationTrayOrmEntity,
  CutterBodyOrmEntity,
  CutterBuildOrmEntity,
  CutterEventOrmEntity,
  CutterTeardownOrmEntity,
} from '@libs/server/data-access';
import { DEPARTMENT_CUTTERGRIND } from '@libs/shared/util-constants';
import { DataSource, IsNull } from 'typeorm';

export function normalizeCutterSerial(
  value: string | null | undefined,
): string {
  return value?.trim().toUpperCase() ?? '';
}

export function currentCutterIdentifier(body: CutterBodyOrmEntity): string {
  return (
    normalizeCutterSerial(body.dana_serial_number) ||
    normalizeCutterSerial(body.mf_serial_number) ||
    `LEGACY-${body.id}`
  );
}

export async function loadCutterBuilderDashboard(dataSource: DataSource) {
  const buildRepo = dataSource.getRepository(CutterBuildOrmEntity);
  const teardownRepo = dataSource.getRepository(CutterTeardownOrmEntity);
  const locationTrayRepo = dataSource.getRepository(LocationTrayOrmEntity);
  const eventRepo = dataSource.getRepository(CutterEventOrmEntity);

  const shelfQueue = (stageCode: string) =>
    locationTrayRepo
      .createQueryBuilder('assignment')
      .innerJoinAndSelect('assignment.location', 'location')
      .innerJoinAndSelect('assignment.tray', 'tray')
      .innerJoinAndSelect('tray.current_stage', 'stage')
      .leftJoinAndSelect('tray.summary', 'summary')
      .leftJoinAndSelect('tray.part_type', 'partType')
      .where('assignment.enabled = true')
      .andWhere('location.location_type = :locationType', {
        locationType: 'SHELF',
      })
      .andWhere('location.department = :department', {
        department: DEPARTMENT_CUTTERGRIND,
      })
      .andWhere('location.serial_number LIKE :shelfPrefix', {
        shelfPrefix: stageCode === 'WAITING_FOR_GRINDING' ? 'CGD%' : 'CGF%',
      })
      .andWhere('stage.code = :stageCode', { stageCode })
      .orderBy('assignment.createdAt', 'ASC')
      .getMany();

  const countStatus = (code: string) =>
    buildRepo
      .createQueryBuilder('build')
      .innerJoin('build.status', 'status')
      .where('status.code = :code', { code })
      .andWhere('build.completed_at IS NULL')
      .getCount();

  const [
    buildsInProgress,
    readyToRun,
    onShelf,
    underTeardown,
    recentBuilds,
    recentTeardowns,
    waitingForGrinding,
    readyForCutter,
    pulledBuilds,
  ] = await Promise.all([
    buildRepo.count({ where: { completed_at: IsNull() } }),
    countStatus('READY'),
    countStatus('SHELF'),
    countStatus('PULLED'),
    buildRepo.find({
      relations: {
        cutter_body: true,
        summary: { model: true },
        part_type: true,
        status: true,
      },
      order: { built_at: 'DESC' },
      take: 5,
    }),
    teardownRepo.find({
      relations: {
        cutter_build: {
          cutter_body: true,
          summary: { model: true },
          part_type: true,
        },
        tray: true,
      },
      order: { torn_down_at: 'DESC' },
      take: 5,
    }),
    shelfQueue('WAITING_FOR_GRINDING'),
    shelfQueue('READY_FOR_CUTTER'),
    buildRepo
      .createQueryBuilder('build')
      .innerJoinAndSelect('build.cutter_body', 'body')
      .innerJoinAndSelect('build.summary', 'summary')
      .innerJoinAndSelect('build.part_type', 'partType')
      .innerJoinAndSelect('build.status', 'status')
      .where('build.completed_at IS NULL')
      .andWhere('status.code = :pulledStatus', { pulledStatus: 'PULLED' })
      .orderBy('build.updatedAt', 'ASC')
      .getMany(),
  ]);

  const pulledBuildRows = await Promise.all(
    pulledBuilds.map(async (build) => {
      const pullEvent = await eventRepo
        .createQueryBuilder('event')
        .leftJoinAndSelect('event.event_type', 'eventType')
        .leftJoinAndSelect('event.pull_reason', 'pullReason')
        .where('event.cutter_build_id = :buildId', { buildId: build.id })
        .andWhere('eventType.code = :eventCode', { eventCode: 'CP' })
        .orderBy('event.occurred_at', 'DESC')
        .getOne();

      return {
        build_number: build.build_number,
        cutter_body_serial_number: currentCutterIdentifier(build.cutter_body),
        summary_number: build.summary.number,
        part_type_code: build.part_type.code,
        pull_reason_code: pullEvent?.pull_reason?.code ?? null,
        pull_reason_name: pullEvent?.pull_reason?.name ?? null,
        pulled_at: pullEvent?.occurred_at ?? build.updatedAt,
        machine_number: pullEvent?.machine_number ?? null,
        final_piece_count: pullEvent?.piece_count ?? 0,
      };
    }),
  );

  return {
    counts: {
      builds_in_progress: buildsInProgress,
      ready_to_run: readyToRun,
      on_shelf: onShelf,
      under_teardown: underTeardown,
      waiting_for_grinding: waitingForGrinding.length,
      ready_for_cutter_shelf: readyForCutter.length,
    },
    recent_builds: recentBuilds.map((build) => ({
      build_number: build.build_number,
      cutter_body_serial_number: currentCutterIdentifier(build.cutter_body),
      summary_number: build.summary.number,
      part_type_code: build.part_type.code,
      status_code: build.status.code,
      built_at: build.built_at,
    })),
    recent_teardowns: recentTeardowns.map((teardown) => ({
      build_number: teardown.cutter_build.build_number,
      cutter_body_serial_number: currentCutterIdentifier(
        teardown.cutter_build.cutter_body,
      ),
      original_blade_count: teardown.original_blade_count,
      returned_blade_count: teardown.returned_blade_count,
      scrapped_blade_count: teardown.scrapped_blade_count,
      teardown_tray_serial_number: teardown.tray.serial_number,
      torn_down_at: teardown.torn_down_at,
    })),
    waiting_for_grinding: waitingForGrinding.map((assignment) => ({
      tray_id: assignment.tray.id,
      tray_serial_number: assignment.tray.serial_number,
      shelf_location: assignment.location.serial_number,
      shelf_description: assignment.location.description,
      summary_number: assignment.tray.summary?.number ?? null,
      part_type_code: assignment.tray.part_type?.code ?? null,
      blade_count: assignment.tray.blade_count,
    })),
    pulled_builds: pulledBuildRows,
    ready_for_cutter: readyForCutter.map((assignment) => ({
      tray_id: assignment.tray.id,
      tray_serial_number: assignment.tray.serial_number,
      shelf_location: assignment.location.serial_number,
      shelf_description: assignment.location.description,
      summary_number: assignment.tray.summary?.number ?? null,
      part_type_code: assignment.tray.part_type?.code ?? null,
      blade_count: assignment.tray.blade_count,
      required_blade_count: assignment.tray.required_blade_count,
    })),
  };
}

export async function searchCutterBuilds(
  dataSource: DataSource,
  query?: {
    q?: string;
    status?: string;
    partType?: string;
    cutterBody?: string;
    limit?: number;
  },
) {
  const repo = dataSource.getRepository(CutterBuildOrmEntity);
  const requestedLimit = Number(query?.limit ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100)
    : 50;

  const qb = repo
    .createQueryBuilder('build')
    .leftJoinAndSelect('build.cutter_body', 'body')
    .leftJoinAndSelect('build.summary', 'summary')
    .leftJoinAndSelect('summary.model', 'model')
    .leftJoinAndSelect('build.part_type', 'partType')
    .leftJoinAndSelect('build.status', 'status')
    .orderBy('build.built_at', 'DESC')
    .take(limit);

  const q = query?.q?.trim();
  if (q) {
    qb.andWhere(
      '(build.build_number ILIKE :q OR body.dana_serial_number ILIKE :q OR body.mf_serial_number ILIKE :q OR summary.number ILIKE :q)',
      { q: `%${q}%` },
    );
  }

  if (query?.status?.trim()) {
    qb.andWhere('status.code = :status', {
      status: query.status.trim().toUpperCase(),
    });
  }

  if (query?.partType?.trim()) {
    qb.andWhere('partType.code = :partType', {
      partType: query.partType.trim().toUpperCase(),
    });
  }

  if (query?.cutterBody?.trim()) {
    qb.andWhere(
      '(body.dana_serial_number ILIKE :cutterBody OR body.mf_serial_number ILIKE :cutterBody)',
      {
        cutterBody: `%${query.cutterBody.trim()}%`,
      },
    );
  }

  const builds = await qb.getMany();

  return builds.map((build) => ({
    id: build.id,
    build_number: build.build_number,
    build_increment: build.build_increment,
    cutter_body_serial_number: currentCutterIdentifier(build.cutter_body),
    summary_number: build.summary.number,
    summary_model: build.summary.model?.model_number?.toString() ?? '',
    part_type_code: build.part_type.code,
    status_code: build.status.code,
    built_at: build.built_at,
    completed_at: build.completed_at,
  }));
}
