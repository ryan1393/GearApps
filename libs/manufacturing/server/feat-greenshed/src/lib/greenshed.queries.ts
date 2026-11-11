/**
 * Read-only Greenshed queries (dashboard, Running Machines board, machine detail)
 * and their display helpers. ServerFeatGreenshedService delegates here; all
 * setup/check/pull writes stay in the service.
 */
import { loadCurrentShiftCounts } from './greenshed-shift-counts';
import { loadDsfCutterShiftCounts } from './dsf-count/dsf-cutter-shift-counts';
import { DataSource, In, IsNull } from 'typeorm';
import {
  CutterBuildLocationOrmEntity,
  CutterBuildOrmEntity,
  CutterEventOrmEntity,
  CutterMachineRunOrmEntity,
  MachineOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

/** Pieces between required quality checks. */
export const GREENSHED_CHECK_INTERVAL = 25;

export function cutterBodyIdentifier(body: {
  id: string;
  dana_serial_number: string | null;
  mf_serial_number: string | null;
}): string {
  return (
    body.dana_serial_number?.trim() ||
    body.mf_serial_number?.trim() ||
    `LEGACY-${body.id}`
  );
}

export function machineCellColor(cell: number | null): string {
  const palette = [
    '#0b9bcf',
    '#2c3949',
    '#2e6376',
    '#397c94',
    '#646464',
    '#366669',
    '#848484',
    '#0e262e',
  ];

  if (cell == null || cell < 0) return '#eaf3f3';
  return palette[cell % palette.length] ?? '#eaf3f3';
}

export function normalizeMachine(value: string): string {
  const machine = value.trim().toUpperCase();
  if (!machine) {
    throw new UnprocessableEntityException('Machine Number is required');
  }
  return machine;
}

export async function loadGreenshedDashboard(dataSource: DataSource) {
  const runRepo = dataSource.getRepository(CutterMachineRunOrmEntity);
  const buildLocationRepo = dataSource.getRepository(
    CutterBuildLocationOrmEntity,
  );
  const buildRepo = dataSource.getRepository(CutterBuildOrmEntity);

  const [runs, shelfAssignments, pulledCount, availableBuilds] =
    await Promise.all([
      runRepo.find({
        where: { enabled: true },
        relations: {
          part: true,
          cutter_build: {
            cutter_body: true,
            summary: { model: true },
            part_type: true,
            status: true,
          },
        },
        order: { machine_number: 'ASC' },
      }),
      buildLocationRepo.find({
        where: { enabled: true },
        relations: {
          cutter_build: {
            cutter_body: true,
            summary: { model: true },
            part_type: true,
            status: true,
          },
          location: true,
        },
        order: { placed_at: 'ASC' },
      }),
      buildRepo
        .createQueryBuilder('build')
        .innerJoin('build.status', 'status')
        .where('build.completed_at IS NULL')
        .andWhere('status.code = :code', { code: 'PULLED' })
        .getCount(),
      buildRepo.find({
        where: {
          completed_at: IsNull(),
          status: { code: In(['READY', 'SHELF']) },
        },
        relations: {
          cutter_body: true,
          summary: { model: true },
          part_type: true,
          status: true,
        },
        order: {
          built_at: 'DESC',
        },
      }),
    ]);

  const activeMachines = runs.map((run) => {
    const nextCheckPieceCount =
      run.last_check_piece_count + GREENSHED_CHECK_INTERVAL;
    return {
      run_id: run.id,
      build_number: run.cutter_build.build_number,
      cutter_body_serial_number: cutterBodyIdentifier(
        run.cutter_build.cutter_body,
      ),
      summary_number: run.cutter_build.summary.number,
      part_type_code: run.cutter_build.part_type.code,
      part_number: run.part.part_number,
      machine_number: run.machine_number,
      current_piece_count: run.current_piece_count,
      last_check_piece_count: run.last_check_piece_count,
      next_check_piece_count: nextCheckPieceCount,
      pieces_until_check: Math.max(
        nextCheckPieceCount - run.current_piece_count,
        0,
      ),
      check_due: run.current_piece_count >= nextCheckPieceCount,
      installed_at: run.installed_at,
    };
  });

  const activeLocationByBuildId = new Map<string, CutterBuildLocationOrmEntity>(
    shelfAssignments.map(
      (assignment) =>
        [assignment.cutter_build_id, assignment] as [
          string,
          CutterBuildLocationOrmEntity,
        ],
    ),
  );

  // "Available" in Green Shed means an open cutter build that can legally
  // be installed: READY (new build) or SHELF (usable changeover stock).
  // This intentionally comes from cutter_builds, not only
  // cutter_build_locations, so imported historical available cutters are
  // visible even when the legacy source never recorded a shelf location.
  const availableCutters = availableBuilds.map((build) => {
    const assignment = activeLocationByBuildId.get(build.id) ?? null;
    return {
      build_number: build.build_number,
      cutter_body_serial_number: cutterBodyIdentifier(build.cutter_body),
      summary_number: build.summary.number,
      part_type_code: build.part_type.code,
      status_code: build.status.code,
      shelf_location: assignment?.location.serial_number ?? null,
      shelf_description: assignment?.location.description ?? null,
      placed_at: assignment?.placed_at ?? null,
      built_at: build.built_at,
    };
  });

  return {
    counts: {
      running: activeMachines.length,
      checks_due: activeMachines.filter((run) => run.check_due).length,
      on_shelf: availableCutters.filter(
        (cutter) => cutter.shelf_location !== null,
      ).length,
      pulled_for_cutter_builder: pulledCount,
      ready_for_setup: availableCutters.length,
      available: availableCutters.length,
    },
    active_machines: activeMachines,
    available_cutters: availableCutters,
    // Kept for compatibility with any older client still reading this field.
    shelf_cutters: availableCutters
      .filter((cutter) => cutter.shelf_location !== null)
      .map((cutter) => ({
        build_number: cutter.build_number,
        cutter_body_serial_number: cutter.cutter_body_serial_number,
        summary_number: cutter.summary_number,
        part_type_code: cutter.part_type_code,
        shelf_location: cutter.shelf_location as string,
        shelf_description: cutter.shelf_description,
        placed_at: cutter.placed_at as Date,
      })),
  };
}

export async function loadRunningMachines(
  dataSource: DataSource,
  activeFilter = 'ACTIVE',
) {
  const machineRepo = dataSource.getRepository(MachineOrmEntity);
  const runRepo = dataSource.getRepository(CutterMachineRunOrmEntity);
  const eventRepo = dataSource.getRepository(CutterEventOrmEntity);

  const normalizedFilter = activeFilter.trim().toUpperCase();
  if (!['ALL', 'ACTIVE', 'INACTIVE'].includes(normalizedFilter)) {
    throw new UnprocessableEntityException(
      'Machine filter must be ALL, ACTIVE, or INACTIVE',
    );
  }

  const machineQb = machineRepo
    .createQueryBuilder('machine')
    .leftJoinAndSelect('machine.department', 'department')
    .where('machine.enabled = :enabled', { enabled: true })
    .andWhere('department.code IN (:...departmentCodes)', {
      departmentCodes: ['132', '152'],
    });

  if (normalizedFilter === 'ACTIVE') {
    machineQb.andWhere('machine.active = :active', { active: true });
  } else if (normalizedFilter === 'INACTIVE') {
    machineQb.andWhere('machine.active = :active', { active: false });
  }

  const machines = await machineQb
    .orderBy('department.code', 'ASC')
    .addOrderBy('machine.cell', 'ASC', 'NULLS LAST')
    .addOrderBy('machine.machine_number', 'ASC')
    .getMany();

  const refreshedAt = new Date();
  const shiftCounts = await loadCurrentShiftCounts(
    dataSource,
    machines.map((machine) => machine.id),
    refreshedAt,
  );

  // With DSF cutter crediting on, Shift Count is what DSF credited to the installed cutter in
  // this shift (keyed by cutter run, so a previous cutter's pieces never show under a new one).
  // Otherwise it stays the machine's recorded increases, exactly as before.
  const dsfShiftCounts = await loadDsfCutterShiftCounts(
    dataSource,
    shiftCounts.currentShift.starts_at,
    machines.map((machine) => machine.id),
  );

  const rows = await Promise.all(
    machines.map(async (machine) => {
      const run = await runRepo.findOne({
        where: { machine_id: machine.id, enabled: true },
        relations: {
          part: true,
          cutter_build: {
            cutter_body: true,
            summary: { model: true },
            part_type: true,
            status: true,
          },
        },
      });

      const machineBackgroundColor = machineCellColor(machine.cell);

      if (!run) {
        return {
          machine_id: machine.id,
          machine_number: machine.machine_number,
          department_code: machine.department.code,
          cell: machine.cell,
          machine_active: machine.active,
          machine_background_color: machineBackgroundColor,
          has_cutter: false,
          run_id: null,
          build_number: null,
          part_number: null,
          summary_number: null,
          part_type_code: null,
          cutter_body_serial_number: null,
          shift: null,
          shift_piece_count: dsfShiftCounts ? 0 : (shiftCounts.counts.get(machine.id) ?? 0),
          current_piece_count: 0,
          last_check_code: null,
          last_check_name: null,
          last_check_result: null,
          last_check_at: null,
          next_check_piece_count: null,
          check_due: false,
        };
      }

      const lastEvent = await eventRepo
        .createQueryBuilder('event')
        .leftJoinAndSelect('event.event_type', 'eventType')
        .leftJoinAndSelect('event.check_result', 'checkResult')
        .where('event.cutter_build_id = :buildId', {
          buildId: run.cutter_build_id,
        })
        .andWhere('event.machine_number = :machineNumber', {
          machineNumber: run.machine_number,
        })
        .andWhere('eventType.code IN (:...codes)', {
          codes: ['CS', 'FC', 'CMM'],
        })
        .orderBy('event.occurred_at', 'DESC')
        .getOne();

      const nextCheckPieceCount =
        run.last_check_piece_count + GREENSHED_CHECK_INTERVAL;

      return {
        machine_id: machine.id,
        machine_number: machine.machine_number,
        department_code: machine.department.code,
        cell: machine.cell,
        machine_active: machine.active,
        machine_background_color: machineBackgroundColor,
        has_cutter: true,
        run_id: run.id,
        build_number: run.cutter_build.build_number,
        part_number: run.part.part_number,
        summary_number: run.cutter_build.summary.number,
        part_type_code: run.cutter_build.part_type.code,
        cutter_body_serial_number: cutterBodyIdentifier(
          run.cutter_build.cutter_body,
        ),
        shift: run.shift,
        shift_piece_count: dsfShiftCounts
          ? (dsfShiftCounts.get(run.id) ?? 0)
          : (shiftCounts.counts.get(machine.id) ?? 0),
        current_piece_count: run.current_piece_count,
        last_check_code: lastEvent?.event_type?.code ?? 'CS',
        last_check_name: lastEvent?.event_type?.name ?? 'Setup',
        last_check_result: lastEvent?.check_result?.code ?? null,
        last_check_at: lastEvent?.occurred_at ?? run.installed_at,
        next_check_piece_count: nextCheckPieceCount,
        check_due: run.current_piece_count >= nextCheckPieceCount,
      };
    }),
  );

  const departments = Array.from(
    new Set(machines.map((machine) => machine.department.code)),
  );

  return {
    active_filter: normalizedFilter,
    refreshed_at: refreshedAt,
    current_shift: shiftCounts.currentShift,
    departments: departments.map((department_code) => ({
      department_code,
      machines: rows.filter((row) => row.department_code === department_code),
    })),
  };
}

export async function loadGreenshedMachine(
  dataSource: DataSource,
  machineNumber: string,
) {
  const normalized = normalizeMachine(machineNumber);
  const machineRepo = dataSource.getRepository(MachineOrmEntity);
  const machine = await machineRepo.findOne({
    where: { machine_number: normalized, enabled: true },
    relations: { department: true },
  });

  if (!machine) {
    throw new NotFoundException(`Machine ${normalized} not found`);
  }

  const run = await dataSource
    .getRepository(CutterMachineRunOrmEntity)
    .findOne({
      where: { machine_id: machine.id, enabled: true },
      relations: {
        part: true,
        cutter_build: {
          cutter_body: true,
          summary: { model: true },
          part_type: true,
          status: true,
        },
      },
    });

  if (!run) {
    return {
      machine_id: machine.id,
      machine_number: machine.machine_number,
      department_code: machine.department.code,
      cell: machine.cell,
      machine_active: machine.active,
      active_run: null,
    };
  }

  const nextCheckPieceCount =
    run.last_check_piece_count + GREENSHED_CHECK_INTERVAL;

  return {
    machine_id: machine.id,
    machine_number: machine.machine_number,
    department_code: machine.department.code,
    cell: machine.cell,
    machine_active: machine.active,
    active_run: {
      run_id: run.id,
      build_number: run.cutter_build.build_number,
      part_number: run.part.part_number,
      cutter_body_serial_number: cutterBodyIdentifier(
        run.cutter_build.cutter_body,
      ),
      summary_number: run.cutter_build.summary.number,
      part_type_code: run.cutter_build.part_type.code,
      current_piece_count: run.current_piece_count,
      last_check_piece_count: run.last_check_piece_count,
      next_check_piece_count: nextCheckPieceCount,
      pieces_until_check: Math.max(
        nextCheckPieceCount - run.current_piece_count,
        0,
      ),
      check_due: run.current_piece_count >= nextCheckPieceCount,
      installed_at: run.installed_at,
    },
  };
}
