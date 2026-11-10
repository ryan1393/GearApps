// DANA-R61R14-COUNT-SERVICE
import { beginWorkflowJournal, UserOrmEntity } from '@gearapps/manufacturing/server/data-access';
import { initializeShiftTracking } from './greenshed-shift-counts';
import { DataSource, In, IsNull } from 'typeorm';

import {
  CutterBuildLocationOrmEntity,
  CutterBuildOrmEntity,
  CutterBuildStatusOrmEntity,
  CutterCheckResultOrmEntity,
  CutterFrequencyCheckOrmEntity,
  CutterCmmCheckOrmEntity,
  CutterEventOrmEntity,
  CutterEventTypeOrmEntity,
  CutterMachineRunOrmEntity,
  MachineOrmEntity,
  PartOrmEntity,
  CutterPullReasonOrmEntity,
  LocationOrmEntity,
} from '@gearapps/manufacturing/server/data-access';
import {
  buildSummaryShelfTag,
  normalizeSummaryNumber,
} from '@gearapps/manufacturing/shared/util-constants';
import { dsfCutterCountsEnabled } from '@gearapps/manufacturing/server/util-common';
import { Uuid } from '@gearapps/manufacturing/shared/util-types';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  PullCutterDto,
  QualityCheckDto,
  SetupCutterDto,
} from './greenshed.dto';
import { GREENSHED_CHECK_INTERVAL, cutterBodyIdentifier, normalizeMachine, loadGreenshedDashboard, loadRunningMachines, loadGreenshedMachine } from './greenshed.queries';

@Injectable()
export class ServerFeatGreenshedService {
  private static readonly CHECK_INTERVAL = GREENSHED_CHECK_INTERVAL;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await initializeShiftTracking(this.dataSource);
  }

  async getReferenceData() {
    const [pullReasons, checkResults] = await Promise.all([
      this.dataSource.getRepository(CutterPullReasonOrmEntity).find({
        where: { enabled: true },
        order: { sort_order: 'ASC' },
      }),
      this.dataSource.getRepository(CutterCheckResultOrmEntity).find({
        where: { enabled: true },
        order: { sort_order: 'ASC' },
      }),
    ]);

    return {
      check_types: [
        { code: 'FC', name: 'Frequency Check' },
        { code: 'CMM', name: 'CMM Check' },
      ],
      pull_reasons: pullReasons,
      check_results: checkResults,
      check_interval: ServerFeatGreenshedService.CHECK_INTERVAL,
      // True when DSF credits production to cutters: the running count then moves on its own
      // and a check records the count it was taken at instead of setting the running count.
      dsf_cutter_counts: dsfCutterCountsEnabled(),
    };
  }


  async getDashboard() {
    return loadGreenshedDashboard(this.dataSource);
  }

  async getBuild(buildNumber: string) {
    const build = await this.findBuild(buildNumber);

    const [run, location, previousRun] = await Promise.all([
      this.dataSource.getRepository(CutterMachineRunOrmEntity).findOne({
        where: { cutter_build_id: build.id, enabled: true },
        relations: { part: true },
      }),
      this.dataSource.getRepository(CutterBuildLocationOrmEntity).findOne({
        where: { cutter_build_id: build.id, enabled: true },
        relations: { location: true },
      }),
      // A cutter on a Greenshed shelf keeps the counts from its last machine run.
      build.status.code === 'SHELF'
        ? this.dataSource.getRepository(CutterMachineRunOrmEntity).findOne({
            where: { cutter_build_id: build.id, enabled: false },
            order: { removed_at: 'DESC' },
          })
        : Promise.resolve(null),
    ]);

    return {
      id: build.id,
      build_number: build.build_number,
      build_increment: build.build_increment,
      cutter_body_serial_number: cutterBodyIdentifier(build.cutter_body),
      summary_number: build.summary.number,
      summary_model: build.summary.model?.model_number?.toString() ?? '',
      part_type_code: build.part_type.code,
      status_code: build.status.code,
      built_at: build.built_at,
      // What the next setup will start from when this cutter comes back off the shelf.
      changeover_piece_count: previousRun?.current_piece_count ?? null,
      changeover_last_check_piece_count: previousRun?.last_check_piece_count ?? null,
      machine_run: run
        ? {
            id: run.id,
            machine_number: run.machine_number,
            part_number: run.part.part_number,
            current_piece_count: run.current_piece_count,
            last_check_piece_count: run.last_check_piece_count,
            next_check_piece_count:
              run.last_check_piece_count +
              ServerFeatGreenshedService.CHECK_INTERVAL,
            installed_at: run.installed_at,
          }
        : null,
      shelf_location: location?.location
        ? {
            serial_number: location.location.serial_number,
            number: location.location.number,
            description: location.location.description,
          }
        : null,
    };
  }


  async getRunningMachines(activeFilter = 'ACTIVE') {
    return loadRunningMachines(this.dataSource, activeFilter);
  }

  async getMachine(machineNumber: string) {
    return loadGreenshedMachine(this.dataSource, machineNumber);
  }

  async getHistory(buildNumber: string) {
    const build = await this.findBuild(buildNumber);
    const events = await this.dataSource.getRepository(CutterEventOrmEntity).find({
      withDeleted: true,
      where: { cutter_build_id: build.id },
      relations: {
        event_type: true,
        check_result: true,
        pull_reason: true,
      },
      order: { occurred_at: 'DESC' },
    });
    const userIds = [...new Set(events.flatMap(e => [e.user_id, e.deletedBy]).filter((id): id is string => !!id))];
    const users = userIds.length ? await this.dataSource.getRepository(UserOrmEntity).find({
      withDeleted: true, where: { id: In(userIds) }, select: { id: true, firstName: true, lastName: true },
    }) : [];
    const name = (id: string | null | undefined) => {
      const user = users.find(u => u.id === id);
      return user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || id : id || null;
    };
    return events.map(event => ({
      ...event.toJSON(), recorded_by: name(event.user_id),
      canceled_at: event.deletedAt ?? null, canceled_by: name(event.deletedBy),
    }));
  }

  async searchBuilds(q?: string, status?: string) {
    const repo = this.dataSource.getRepository(CutterBuildOrmEntity);
    const qb = repo
      .createQueryBuilder('build')
      .leftJoinAndSelect('build.cutter_body', 'body')
      .leftJoinAndSelect('build.summary', 'summary')
      .leftJoinAndSelect('build.part_type', 'partType')
      .leftJoinAndSelect('build.status', 'status')
      .where('build.completed_at IS NULL')
      .orderBy('build.built_at', 'DESC')
      .take(100);

    if (q?.trim()) {
      qb.andWhere(
        '(build.build_number ILIKE :q OR body.dana_serial_number ILIKE :q OR body.mf_serial_number ILIKE :q OR summary.number ILIKE :q)',
        { q: `%${q.trim()}%` },
      );
    }

    if (status?.trim()) {
      qb.andWhere('status.code = :status', {
        status: status.trim().toUpperCase(),
      });
    }

    const builds = await qb.getMany();
    return builds.map((build) => ({
      id: build.id,
      build_number: build.build_number,
      cutter_body_serial_number: cutterBodyIdentifier(build.cutter_body),
      summary_number: build.summary.number,
      part_type_code: build.part_type.code,
      status_code: build.status.code,
      built_at: build.built_at,
    }));
  }

  async setupCutter(dto: SetupCutterDto, userId: Uuid) {
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const buildRepo = manager.getRepository(CutterBuildOrmEntity);
      const runRepo = manager.getRepository(CutterMachineRunOrmEntity);
      const statusRepo = manager.getRepository(CutterBuildStatusOrmEntity);
      const eventTypeRepo = manager.getRepository(CutterEventTypeOrmEntity);
      const eventRepo = manager.getRepository(CutterEventOrmEntity);
      const locationRepo = manager.getRepository(CutterBuildLocationOrmEntity);
      const machineRepo = manager.getRepository(MachineOrmEntity);
      const partRepo = manager.getRepository(PartOrmEntity);

      const buildNumber = dto.build_number.trim().toUpperCase();
      const machineNumber = normalizeMachine(dto.machine_number);
      let startingPieceCount = dto.starting_piece_count ?? 0;
      let startingLastCheckPieceCount = startingPieceCount;

      const lockedMachineDefinition = await machineRepo.findOne({
        where: { machine_number: machineNumber, enabled: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedMachineDefinition) {
        throw new NotFoundException(
          `Machine ${machineNumber} is not configured in the shared Machine table`,
        );
      }

      const machineDefinition = await machineRepo.findOne({
        where: { id: lockedMachineDefinition.id, enabled: true },
        relations: { department: true },
      });
      if (!machineDefinition) {
        throw new NotFoundException(
          `Machine ${machineNumber} is not configured in the shared Machine table`,
        );
      }
      if (!machineDefinition.active || !machineDefinition.department?.active || !machineDefinition.department?.enabled) {
        throw new ConflictException(
          `Machine ${machineNumber} is INACTIVE and cannot receive a cutter setup`,
        );
      }


      const lockedBuild = await buildRepo.findOne({
        where: { build_number: buildNumber, completed_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedBuild) {
        throw new NotFoundException(`Open cutter build ${buildNumber} not found`);
      }

      const build = await buildRepo.findOne({
        where: { id: lockedBuild.id },
        relations: {
          cutter_body: true,
          summary: { model: true },
          part_type: true,
          status: true,
        },
      });
      if (!build) {
        throw new NotFoundException(`Open cutter build ${buildNumber} not found`);
      }
      if (!['READY', 'SHELF'].includes(build.status.code)) {
        throw new ConflictException(
          `Cutter ${buildNumber} cannot be setup while status is ${build.status.code}`,
        );
      }

      // An intact cutter coming back from a Greenshed shelf continues where it stopped: it
      // carries the piece count and last-check count of its previous run, whatever was typed.
      // Only a cutter new to a machine uses the requested starting count.
      if (build.status.code === 'SHELF') {
        const previousRun = await runRepo.findOne({
          where: { cutter_build_id: build.id, enabled: false },
          order: { removed_at: 'DESC' },
        });
        if (previousRun) {
          startingPieceCount = previousRun.current_piece_count;
          startingLastCheckPieceCount = previousRun.last_check_piece_count;
        }
      }

      const buildPartType = build.part_type.code.trim().toUpperCase();
      const machineDepartment = machineDefinition.department.description.trim().toUpperCase();
      const machineMatchesBuild =
        (buildPartType === 'PINION' && machineDepartment === 'PINION CUTTING') ||
        (buildPartType === 'RING' && machineDepartment === 'GEAR CUTTING');
      if (!machineMatchesBuild) {
        throw new ConflictException(
          `${buildPartType} Cutter Build ${buildNumber} cannot run on ${machineDepartment} machine ${machineNumber}`,
        );
      }

      const partNumber = dto.part_number.trim().toUpperCase();
      const lockedPart = await partRepo.findOne({
        where: {
          part_number: partNumber,
          active: true,
          enabled: true,
        },
        lock: { mode: 'pessimistic_read' },
      });

      if (!lockedPart) {
        throw new NotFoundException(
          `Active Part ${partNumber} was not found in the Parts master table`,
        );
      }

      const part = await partRepo.findOne({
        where: { id: lockedPart.id, active: true, enabled: true },
        relations: {
          summary: { model: true },
          part_type: true,
        },
      });

      if (!part) {
        throw new NotFoundException(
          `Active Part ${partNumber} was not found in the Parts master table`,
        );
      }

      if (part.summary_id !== build.summary_id) {
        throw new ConflictException(
          `Part ${partNumber} belongs to Summary ${part.summary.number}, but Cutter Build ${buildNumber} is Summary ${build.summary.number}`,
        );
      }

      if (part.part_type_id !== build.part_type_id) {
        throw new ConflictException(
          `Part ${partNumber} is ${part.part_type.name}, but Cutter Build ${buildNumber} is ${build.part_type.name}`,
        );
      }

      const [machineBusy, buildAlreadyRunning, runningStatus, setupEventType] =
        await Promise.all([
          runRepo.findOne({
            where: { machine_id: machineDefinition.id, enabled: true },
          }),
          runRepo.findOne({
            where: { cutter_build_id: build.id, enabled: true },
          }),
          statusRepo.findOne({ where: { code: 'RUNNING', enabled: true } }),
          eventTypeRepo.findOne({ where: { code: 'CS', enabled: true } }),
        ]);

      if (machineBusy) {
        const installed = await buildRepo.findOne({
          where: { id: machineBusy.cutter_build_id },
          select: { id: true, build_number: true },
        });
        throw new ConflictException(
          `Machine ${machineNumber} already has cutter ${installed?.build_number ?? 'build'} installed`,
        );
      }
      if (buildAlreadyRunning) {
        throw new ConflictException(
          `Cutter ${buildNumber} is already installed on a machine`,
        );
      }
      if (!runningStatus || !setupEventType) {
        throw new UnprocessableEntityException(
          'RUNNING status or Cutter Setup event type is not configured',
        );
      }

      await locationRepo.update(
        { cutter_build_id: build.id, enabled: true },
        { enabled: false, removed_at: new Date(), updatedBy: userId },
      );

      const installedAt = new Date();
      const run = await runRepo.save(
        runRepo.create({
          cutter_build_id: build.id,
          machine_id: machineDefinition.id,
          part_id: part.id,
          machine_number: machineNumber,
          shift: dto.shift?.trim() || null,
          installed_at: installedAt,
          removed_at: null,
          current_piece_count: startingPieceCount,
          last_check_piece_count: startingLastCheckPieceCount,
          installed_by_user_id: userId,
          removed_by_user_id: null,
          enabled: true,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      await eventRepo.save(
        eventRepo.create({
          cutter_build_id: build.id,
          event_type_id: setupEventType.id,
          piece_count: startingPieceCount,
          machine_number: machineNumber,
          part_number: part.part_number,
          user_id: userId,
          check_result_id: null,
          pull_reason_id: null,
          occurred_at: installedAt,
          comments: dto.comments?.trim() || null,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      build.status_id = runningStatus.id;
      build.status = runningStatus;
      build.updatedBy = userId;
      await buildRepo.save(build);

      return {
        run_id: run.id,
        build_number: build.build_number,
        machine_number: machineNumber,
        part_number: part.part_number,
        current_piece_count: startingPieceCount,
        next_check_piece_count:
          startingLastCheckPieceCount + ServerFeatGreenshedService.CHECK_INTERVAL,
        status_code: runningStatus.code,
        installed_at: installedAt,
      };
    });
  }

  async updatePieceCount(
    machineNumber: string,
    pieceCount: number,
    userId: Uuid,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const runRepo = manager.getRepository(CutterMachineRunOrmEntity);
      const machine = normalizeMachine(machineNumber);

      const lockedRun = await runRepo.findOne({
        where: { machine_number: machine, enabled: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedRun) {
        throw new NotFoundException(`Machine ${machine} has no active cutter`);
      }

      const run = await runRepo.findOne({
        where: { id: lockedRun.id, enabled: true },
        relations: { cutter_build: true },
      });
      if (!run) {
        throw new NotFoundException(`Machine ${machine} has no active cutter`);
      }
      if (pieceCount < run.current_piece_count) {
        throw new UnprocessableEntityException(
          `Piece count cannot decrease below ${run.current_piece_count}`,
        );
      }

      run.current_piece_count = pieceCount;
      run.updatedBy = userId;
      await runRepo.save(run);

      const nextCheck =
        run.last_check_piece_count + ServerFeatGreenshedService.CHECK_INTERVAL;

      return {
        build_number: run.cutter_build.build_number,
        machine_number: run.machine_number,
        current_piece_count: run.current_piece_count,
        next_check_piece_count: nextCheck,
        pieces_until_check: Math.max(nextCheck - pieceCount, 0),
        check_due: pieceCount >= nextCheck,
      };
    });
  }

  async qualityCheck(dto: QualityCheckDto, userId: Uuid) {
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const buildRepo = manager.getRepository(CutterBuildOrmEntity);
      const runRepo = manager.getRepository(CutterMachineRunOrmEntity);
      const eventTypeRepo = manager.getRepository(CutterEventTypeOrmEntity);
      const resultRepo = manager.getRepository(CutterCheckResultOrmEntity);
      const eventRepo = manager.getRepository(CutterEventOrmEntity);
      const frequencyRepo = manager.getRepository(CutterFrequencyCheckOrmEntity);
      const cmmRepo = manager.getRepository(CutterCmmCheckOrmEntity);

      const buildNumber = dto.build_number.trim().toUpperCase();
      const checkTypeCode = dto.check_type_code.trim().toUpperCase();
      const resultCode = dto.result_code.trim().toUpperCase();

      if (!['FC', 'CMM'].includes(checkTypeCode)) {
        throw new UnprocessableEntityException(
          'Check Type must be FC or CMM',
        );
      }

      const lockedBuild = await buildRepo.findOne({
        where: { build_number: buildNumber, completed_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedBuild) {
        throw new NotFoundException(`Open cutter build ${buildNumber} not found`);
      }

      const build = await buildRepo.findOne({
        where: { id: lockedBuild.id },
        relations: { status: true, summary: true },
      });
      if (!build) {
        throw new NotFoundException(`Open cutter build ${buildNumber} not found`);
      }
      if (build.status.code !== 'RUNNING') {
        throw new ConflictException(
          `Cutter ${buildNumber} is not currently RUNNING`,
        );
      }

      const lockedRun = await runRepo.findOne({
        where: { cutter_build_id: build.id, enabled: true },
        lock: { mode: 'pessimistic_write' },
      });

      const [run, eventType, result] = await Promise.all([
        lockedRun
          ? runRepo.findOne({
              where: { id: lockedRun.id, enabled: true },
              relations: { part: true },
            })
          : Promise.resolve(null),
        eventTypeRepo.findOne({
          where: { code: checkTypeCode, enabled: true },
        }),
        resultRepo.findOne({
          where: { code: resultCode, enabled: true },
        }),
      ]);

      if (!run) {
        throw new ConflictException(
          `Cutter ${buildNumber} does not have an active machine run`,
        );
      }
      if (!eventType || !result) {
        throw new UnprocessableEntityException(
          'Quality-check reference data is incomplete',
        );
      }
      if (
        (dto.expected_machine_number && normalizeMachine(dto.expected_machine_number) !== run.machine_number) ||
        (dto.expected_machine_run_id && dto.expected_machine_run_id !== run.id)
      ) {
        throw new ConflictException(
          'The active machine run has changed. Reopen the cutter before recording a check.',
        );
      }
      // Operator-counted cutters: a check also sets the running count, so it cannot go backwards.
      // DSF-counted cutters: the running count moves on its own and is usually already past the
      // check point, so a check records the count it was taken at, at or after the previous check.
      const dsfCounts = dsfCutterCountsEnabled();
      if (dsfCounts && dto.piece_count < run.last_check_piece_count) {
        throw new UnprocessableEntityException(
          `Check piece count cannot be below previous check count ${run.last_check_piece_count}`,
        );
      }
      if (!dsfCounts && dto.piece_count < run.current_piece_count) {
        throw new UnprocessableEntityException(
          `Check piece count cannot be below current machine count ${run.current_piece_count}`,
        );
      }

      const occurredAt = new Date();
      const journal = await beginWorkflowJournal(manager, { app: 'GREENSHED', buildIds: [build.id] }, userId);
      const event = await eventRepo.save(
        eventRepo.create({
          cutter_build_id: build.id,
          event_type_id: eventType.id,
          piece_count: dto.piece_count,
          machine_number: run.machine_number,
          part_number: run.part.part_number,
          user_id: userId,
          check_result_id: result.id,
          pull_reason_id: null,
          occurred_at: occurredAt,
          comments: dto.comments?.trim() || null,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      const passFail =
        result.code === 'PASS' ? true : result.code === 'FAIL' ? false : null;

      if (checkTypeCode === 'FC') {
        const detail = dto.frequency ?? {};
        await frequencyRepo.save(
          frequencyRepo.create({
            event_id: event.id,
            pass_fail: passFail,
            s_e_square: detail.s_e_square ?? null,
            s_e_after: detail.s_e_after ?? null,
            s_e_result: detail.s_e_result ?? null,
            total_fr: detail.total_fr ?? null,
            tooth_thickness: detail.tooth_thickness ?? null,
            flank1_pa: detail.flank1_pa ?? null,
            flank1_sa: detail.flank1_sa ?? null,
            flank2_pa: detail.flank2_pa ?? null,
            flank2_sa: detail.flank2_sa ?? null,
            size_check: detail.size_check ?? null,
            comments: dto.comments?.trim() || null,
            createdBy: userId,
            updatedBy: userId,
          }),
        );
      } else {
        const detail = dto.cmm ?? {};
        await cmmRepo.save(
          cmmRepo.create({
            event_id: event.id,
            pass_fail: passFail,
            flank_1_pa: detail.flank_1_pa ?? null,
            flank_1_sa: detail.flank_1_sa ?? null,
            flank_1_fp: detail.flank_1_fp ?? null,
            flank_1_fp_small: detail.flank_1_fp_small ?? null,
            flank_1_fu: detail.flank_1_fu ?? null,
            flank_1_frs: detail.flank_1_frs ?? null,
            flank_1_warp: detail.flank_1_warp ?? null,
            flank_1_toe_root: detail.flank_1_toe_root ?? null,
            flank_1_toe_top: detail.flank_1_toe_top ?? null,
            flank_1_heel_root: detail.flank_1_heel_root ?? null,
            flank_1_heel_top: detail.flank_1_heel_top ?? null,
            flank_2_pa: detail.flank_2_pa ?? null,
            flank_2_sa: detail.flank_2_sa ?? null,
            flank_2_fp: detail.flank_2_fp ?? null,
            flank_2_fp_small: detail.flank_2_fp_small ?? null,
            flank_2_fu: detail.flank_2_fu ?? null,
            flank_2_frs: detail.flank_2_frs ?? null,
            flank_2_warp: detail.flank_2_warp ?? null,
            flank_2_toe_root: detail.flank_2_toe_root ?? null,
            flank_2_toe_top: detail.flank_2_toe_top ?? null,
            flank_2_heel_root: detail.flank_2_heel_root ?? null,
            flank_2_heel_top: detail.flank_2_heel_top ?? null,
            tooth_thickness: detail.tooth_thickness ?? null,
            total_fr: detail.total_fr ?? null,
            sum_error_squared: detail.sum_error_squared ?? null,
            sum_error_after: detail.sum_error_after ?? null,
            result: detail.result ?? null,
            comments: dto.comments?.trim() || null,
            createdBy: userId,
            updatedBy: userId,
          }),
        );
      }

      run.current_piece_count = dsfCounts
        ? Math.max(run.current_piece_count, dto.piece_count)
        : dto.piece_count;
      run.last_check_piece_count = dto.piece_count;
      run.updatedBy = userId;
      await runRepo.save(run);
      await journal.commit(build.build_number, `${eventType.code} check at piece ${dto.piece_count}`);

      return {
        event_id: event.id,
        build_number: build.build_number,
        machine_number: run.machine_number,
        check_type_code: eventType.code,
        result_code: result.code,
        piece_count: dto.piece_count,
        next_check_piece_count:
          dto.piece_count + ServerFeatGreenshedService.CHECK_INTERVAL,
        occurred_at: occurredAt,
      };
    });
  }

  async pullCutter(dto: PullCutterDto, userId: Uuid) {
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const buildRepo = manager.getRepository(CutterBuildOrmEntity);
      const runRepo = manager.getRepository(CutterMachineRunOrmEntity);
      const statusRepo = manager.getRepository(CutterBuildStatusOrmEntity);
      const reasonRepo = manager.getRepository(CutterPullReasonOrmEntity);
      const eventTypeRepo = manager.getRepository(CutterEventTypeOrmEntity);
      const eventRepo = manager.getRepository(CutterEventOrmEntity);
      const locationRepo = manager.getRepository(LocationOrmEntity);
      const buildLocationRepo = manager.getRepository(
        CutterBuildLocationOrmEntity,
      );

      const buildNumber = dto.build_number.trim().toUpperCase();
      const reasonCode = dto.reason_code.trim().toUpperCase();

      const lockedBuild = await buildRepo.findOne({
        where: { build_number: buildNumber, completed_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedBuild) {
        throw new NotFoundException(`Open cutter build ${buildNumber} not found`);
      }

      const build = await buildRepo.findOne({
        where: { id: lockedBuild.id },
        relations: {
          cutter_body: true,
          summary: { model: true },
          part_type: true,
          status: true,
        },
      });
      if (!build) {
        throw new NotFoundException(`Open cutter build ${buildNumber} not found`);
      }
      if (build.status.code !== 'RUNNING') {
        throw new ConflictException(
          `Cutter ${buildNumber} must be RUNNING before it can be pulled`,
        );
      }

      const lockedRun = await runRepo.findOne({
        where: { cutter_build_id: build.id, enabled: true },
        lock: { mode: 'pessimistic_write' },
      });
      const run = lockedRun
        ? await runRepo.findOne({
            where: { id: lockedRun.id, enabled: true },
            relations: { part: true },
          })
        : null;
      if (!run) {
        throw new ConflictException(
          `Cutter ${buildNumber} does not have an active machine run`,
        );
      }

      if ((dto.expected_machine_number && normalizeMachine(dto.expected_machine_number) !== run.machine_number) ||
          (dto.expected_machine_run_id && dto.expected_machine_run_id !== run.id)) {
        throw new ConflictException('The machine run changed after this pull was opened. Refresh the machine and try again.');
      }

      const reason = await reasonRepo.findOne({
        where: { code: reasonCode, enabled: true },
      });
      if (!reason) {
        throw new NotFoundException(`Pull reason ${reasonCode} not found`);
      }

      const [targetStatus, pullEventType] = await Promise.all([
        statusRepo.findOne({
          where: {
            code: reason.returns_to_shelf ? 'SHELF' : 'PULLED',
            enabled: true,
          },
        }),
        eventTypeRepo.findOne({
          where: {
            code: reason.returns_to_shelf ? 'CC' : 'CP',
            enabled: true,
          },
        }),
      ]);

      if (!targetStatus || !pullEventType) {
        throw new UnprocessableEntityException(
          'Cutter pull status/event reference data is incomplete',
        );
      }

      let shelfLocation: LocationOrmEntity | null = null;
      if (reason.returns_to_shelf) {
        const shelfSerial = dto.shelf_location_serial_number
          ?.trim()
          .toUpperCase();
        if (!shelfSerial) {
          throw new UnprocessableEntityException(
            'A Green Shed part-specific summary shelf tag (GSR-<summary> for RING or GSP-<summary> for PINION) is required for a changeover',
          );
        }

        shelfLocation = await locationRepo.findOne({
          where: { serial_number: shelfSerial, enabled: true },
          lock: { mode: 'pessimistic_read' },
        });
        const expectedShelfSerial = buildSummaryShelfTag(
          'GREENSHED',
          build.summary.number,
          build.part_type.code,
        );
        if (
          !shelfLocation ||
          shelfLocation.location_type !== 'SHELF' ||
          shelfLocation.department !== 'GREENSHED' ||
          shelfLocation.number !== normalizeSummaryNumber(build.summary.number) ||
          shelfLocation.serial_number !== expectedShelfSerial
        ) {
          throw new UnprocessableEntityException(
            `Changeover cutter for Summary ${build.summary.number} must be returned to ${expectedShelfSerial}`,
          );
        }
      }

      const removedAt = new Date();

      run.enabled = false;
      run.removed_at = removedAt;
      run.removed_by_user_id = userId;
      run.updatedBy = userId;
      await runRepo.save(run);

      await buildLocationRepo.update(
        { cutter_build_id: build.id, enabled: true },
        { enabled: false, removed_at: removedAt, updatedBy: userId },
      );

      if (shelfLocation) {
        await buildLocationRepo.save(
          buildLocationRepo.create({
            cutter_build_id: build.id,
            location_id: shelfLocation.id,
            placed_at: removedAt,
            removed_at: null,
            enabled: true,
            createdBy: userId,
            updatedBy: userId,
          }),
        );
      }

      await eventRepo.save(
        eventRepo.create({
          cutter_build_id: build.id,
          event_type_id: pullEventType.id,
          piece_count: run.current_piece_count,
          machine_number: run.machine_number,
          part_number: run.part.part_number,
          user_id: userId,
          check_result_id: null,
          pull_reason_id: reason.id,
          occurred_at: removedAt,
          comments: dto.comments?.trim() || null,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      build.status_id = targetStatus.id;
      build.status = targetStatus;
      build.updatedBy = userId;
      await buildRepo.save(build);

      return {
        build_number: build.build_number,
        cutter_body_serial_number: cutterBodyIdentifier(build.cutter_body),
        machine_number: run.machine_number,
        part_number: run.part.part_number,
        final_piece_count: run.current_piece_count,
        reason_code: reason.code,
        status_code: targetStatus.code,
        requires_teardown: reason.requires_teardown,
        returned_to_shelf: reason.returns_to_shelf,
        shelf_location: shelfLocation?.serial_number ?? null,
        removed_at: removedAt,
      };
    });
  }

  private async findBuild(buildNumber: string) {
    const normalized = buildNumber.trim().toUpperCase();
    const build = await this.dataSource.getRepository(CutterBuildOrmEntity).findOne({
      where: { build_number: normalized },
      relations: {
        cutter_body: true,
        summary: { model: true },
        part_type: true,
        status: true,
      },
    });

    if (!build) {
      throw new NotFoundException(`Cutter build ${normalized} not found`);
    }
    return build;
  }
}
