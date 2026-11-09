import { beginWorkflowJournal } from '@gearapps/manufacturing/server/data-access';
import {
  BladeHistoryOrmEntity,
  BladeOrmEntity,
  BladeTrayOrmEntity,
  ContainerTrayOrmEntity,
  LocationOrmEntity,
  LocationTrayOrmEntity,
  MachineOrmEntity,
  CutterBladeRequirementOrmEntity,
  CutterBodyOrmEntity,
  CutterBuildBladeOrmEntity,
  CutterBuildOrmEntity,
  CutterBuildStatusOrmEntity,
  CutterBuildTrayOrmEntity,
  CutterMachineRunOrmEntity,
  CutterEventOrmEntity,
  CutterEventTypeOrmEntity,
  CutterPartTypeOrmEntity,
  CutterTeardownOrmEntity,
  PartSummaryOrmEntity,
  TrayOrmEntity,
  TrayStageOrmEntity,
  UserOrmEntity,
} from '@gearapps/manufacturing/server/data-access';
import {
  DEPARTMENT_CUTTERGRIND,
  cutterBodyMatchesRequirement,
  parseCuttergrindNumberedShelfTag,
} from '@gearapps/manufacturing/shared/util-constants';
import {
  BladeHistoryEvent,
  BladeStatus,
  ICutterBuilderBuildResult,
  ICutterTeardownResult,
  Uuid,
} from '@gearapps/manufacturing/shared/util-types';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import { buildCutterCardIpl, cutterCardBuildDate } from './cutter-card-ipl';

import {
  AssignCutterBodyDanaSerialDto,
  CreateCutterBodyDto,
  CreateCutterBuilderBuildDto,
  CreateCutterTeardownDto,
  UpdateCutterBodyDto,
} from './cutter-build.dto';
import { normalizeCutterSerial, currentCutterIdentifier, loadCutterBuilderDashboard, searchCutterBuilds } from './cutter-build.queries';

@Injectable()
export class ServerFeatCutterBuildService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async createCutterBody(dto: CreateCutterBodyDto, userId: Uuid) {
    const mfSerial = normalizeCutterSerial(dto.mf_serial_number);
    const danaSerial = dto.dana_serial_number
      ? normalizeCutterSerial(dto.dana_serial_number)
      : null;

    const repo = this.dataSource.getRepository(CutterBodyOrmEntity);

    const existingMf = await repo.findOne({
      where: { mf_serial_number: mfSerial },
    });
    if (existingMf) {
      throw new ConflictException(`Cutter body MF serial ${mfSerial} already exists`);
    }

    if (danaSerial) {
      const existingDana = await repo.findOne({
        where: { dana_serial_number: danaSerial },
      });
      if (existingDana) {
        throw new ConflictException(`Cutter body Dana serial ${danaSerial} already exists`);
      }
    }

    return repo.save(
      repo.create({
        dana_serial_number: danaSerial,
        mf_serial_number: mfSerial,
        description: dto.description?.trim() || null,
        enabled: true,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
  }

  /**

   * Resolve a cutter body from the identifier an operator enters.
   *
   * Primary scanner key: Dana S/N (serial_number)
   * Temporary/manual fallback: MF S/N (mf_serial_number)
   *
   * MF S/N is not assumed globally unique. If legacy/reference data ever
   * contains the same MF S/N on more than one enabled body, require Dana S/N
   * rather than silently selecting the wrong cutter.
   */
  async assignCutterBodyDanaSerial(
    id: Uuid,
    dto: AssignCutterBodyDanaSerialDto,
    userId: Uuid,
  ) {
    const danaSerial = normalizeCutterSerial(dto.dana_serial_number);
    if (!danaSerial) {
      throw new UnprocessableEntityException('Dana serial number cannot be empty');
    }

    const repo = this.dataSource.getRepository(CutterBodyOrmEntity);
    const body = await repo.findOne({
      where: { id, enabled: true },
      relations: { definition: true },
    });

    if (!body) {
      throw new NotFoundException(`Cutter body ${id} could not be found`);
    }

    const existingDana = await repo.findOne({
      where: { dana_serial_number: danaSerial },
    });

    if (existingDana && existingDana.id !== body.id) {
      throw new ConflictException(
        `Dana serial ${danaSerial} is already assigned to another cutter body`,
      );
    }

    // Updating the same cutter-body row preserves every pre-etch build and
    // event because history is linked through cutter_body_id (UUID).
    body.dana_serial_number = danaSerial;
    body.updatedBy = userId;
    return repo.save(body);
  }

  async getCutterBodyBySerial(serialNumber: string) {
    const identifier = normalizeCutterSerial(serialNumber);
    const repo = this.dataSource.getRepository(CutterBodyOrmEntity);

    const matches = await repo
      .createQueryBuilder('body')
      .leftJoinAndSelect('body.definition', 'definition')
      .where('body.enabled = :enabled', { enabled: true })
      .andWhere(
        '(UPPER(body.mf_serial_number) = :identifier OR UPPER(body.dana_serial_number) = :identifier)',
        { identifier },
      )
      .orderBy(
        'CASE WHEN UPPER(body.dana_serial_number) = :identifier THEN 0 ELSE 1 END',
        'ASC',
      )
      .getMany();

    if (matches.length === 0) {
      throw new NotFoundException(
        `No cutter body found for Dana or manufacturer serial ${identifier}`,
      );
    }

    const danaMatch = matches.find(
      (body) => body.dana_serial_number?.toUpperCase() === identifier,
    );
    if (danaMatch) return danaMatch;

    if (matches.length > 1) {
      throw new ConflictException(
        `Manufacturer serial ${identifier} matches multiple cutter bodies. Enter the Dana serial number.`,
      );
    }

    return matches[0];
  }

  async listCutterBodiesAdmin() {
    return this.dataSource.getRepository(CutterBodyOrmEntity).find({
      relations: { definition: true },
      order: { mf_serial_number: 'ASC' },
    });
  }

  async updateCutterBody(id: Uuid, dto: UpdateCutterBodyDto, userId: Uuid) {
    const repo = this.dataSource.getRepository(CutterBodyOrmEntity);
    const body = await repo.findOne({ where: { id } });
    if (!body) throw new NotFoundException('Cutter body not found');

    if (dto.mf_serial_number !== undefined) {
      const value = dto.mf_serial_number ? normalizeCutterSerial(dto.mf_serial_number) : null;
      if (!value) throw new UnprocessableEntityException('MF / manufacturer serial is required');
      const duplicate = await repo.findOne({ where: { mf_serial_number: value } });
      if (duplicate && duplicate.id !== id) throw new ConflictException(`Cutter body MF serial ${value} already exists`);
      body.mf_serial_number = value;
    }
    if (dto.dana_serial_number !== undefined) {
      const value = dto.dana_serial_number ? normalizeCutterSerial(dto.dana_serial_number) : null;
      if (value) {
        const duplicate = await repo.findOne({ where: { dana_serial_number: value } });
        if (duplicate && duplicate.id !== id) throw new ConflictException(`Cutter body Dana serial ${value} already exists`);
      }
      body.dana_serial_number = value;
    }
    if (dto.description !== undefined) body.description = dto.description?.trim() || null;
    if (dto.enabled !== undefined) body.enabled = dto.enabled;
    body.updatedBy = userId;
    return repo.save(body);
  }

  async listCutterBuilderMachines() {
    return this.dataSource.getRepository(MachineOrmEntity)
      .createQueryBuilder('machine')
      .leftJoinAndSelect('machine.department', 'department')
      .where('machine.enabled = true')
      .andWhere('machine.active = true')
      .andWhere('machine.machine_type = :type', { type: 'CUTTER_BUILDER' })
      .andWhere('department.code = :department', { department: '45' })
      .andWhere('department.enabled = true')
      .andWhere('department.active = true')
      .orderBy('machine.machine_number', 'ASC')
      .getMany();
  }

  async listCutterBodies() {
    return this.dataSource
      .getRepository(CutterBodyOrmEntity)
      .createQueryBuilder('body')
      .where('body.enabled = :enabled', { enabled: true })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM cutter_builds open_build WHERE open_build.cutter_body_id = body.id AND open_build.completed_at IS NULL)',
      )
      .orderBy('body.mf_serial_number', 'ASC')
      .getMany();
  }

  async createBuild(
    dto: CreateCutterBuilderBuildDto,
    userId: Uuid,
  ): Promise<ICutterBuilderBuildResult> {
    return this.dataSource.transaction(
      'SERIALIZABLE',
      async (manager) => {
        const bodyRepo = manager.getRepository(CutterBodyOrmEntity);
        const buildRepo = manager.getRepository(CutterBuildOrmEntity);
        const trayRepo = manager.getRepository(TrayOrmEntity);
        const bladeTrayRepo = manager.getRepository(BladeTrayOrmEntity);
        const bladeRepo = manager.getRepository(BladeOrmEntity);
        const buildBladeRepo = manager.getRepository(CutterBuildBladeOrmEntity);
        const buildTrayRepo = manager.getRepository(CutterBuildTrayOrmEntity);
        const requirementRepo = manager.getRepository(
          CutterBladeRequirementOrmEntity,
        );
        const summaryRepo = manager.getRepository(PartSummaryOrmEntity);
        const partTypeRepo = manager.getRepository(CutterPartTypeOrmEntity);
        const statusRepo = manager.getRepository(CutterBuildStatusOrmEntity);
        const eventTypeRepo = manager.getRepository(CutterEventTypeOrmEntity);
        const eventRepo = manager.getRepository(CutterEventOrmEntity);
        const containerTrayRepo = manager.getRepository(ContainerTrayOrmEntity);
        const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
        const locationTrayRepo = manager.getRepository(LocationTrayOrmEntity);
        const trayStageRepo = manager.getRepository(TrayStageOrmEntity);
        const machineRepo = manager.getRepository(MachineOrmEntity);

        const builderMachine = await machineRepo.findOne({
          where: { id: dto.cutter_builder_machine_id, enabled: true, active: true, machine_type: 'CUTTER_BUILDER' },
          relations: { department: true },
        });
        if (!builderMachine || builderMachine.department?.code !== '45' || !builderMachine.department.enabled || !builderMachine.department.active) {
          throw new UnprocessableEntityException('Select an enabled Department 45 machine with Machine Type Cutter Builder');
        }

        const cutterBodyIdentifier = normalizeCutterSerial(
          dto.cutter_body_identifier,
        );
        // Tray barcodes are looked up exactly as Blade Tracking stores them.
        // Do not force case here because existing tray creation does not normalize case.
        const traySerial = dto.tray_serial_number.trim();

        const bodyMatches = await bodyRepo
          .createQueryBuilder('body')
          .leftJoinAndSelect('body.definition', 'definition')
          .setLock('pessimistic_write', undefined, ['body'])
          .where('body.enabled = :enabled', { enabled: true })
          .andWhere(
            '(UPPER(body.mf_serial_number) = :identifier OR UPPER(body.dana_serial_number) = :identifier)',
            { identifier: cutterBodyIdentifier },
          )
          .getMany();

        if (bodyMatches.length === 0) {
          throw new NotFoundException(
            `Cutter body ${cutterBodyIdentifier} could not be found`,
          );
        }

        const body =
          bodyMatches.find(
            (candidate) =>
              candidate.dana_serial_number?.toUpperCase() === cutterBodyIdentifier,
          ) ?? bodyMatches[0];

        if (
          bodyMatches.length > 1 &&
          !bodyMatches.some(
            (candidate) =>
              candidate.dana_serial_number?.toUpperCase() === cutterBodyIdentifier,
          )
        ) {
          throw new ConflictException(
            `Manufacturer serial ${cutterBodyIdentifier} matches multiple cutter bodies. Enter the Dana serial number.`,
          );
        }

        const bodyIdentifier =
          currentCutterIdentifier(body);

        const openBuild = await buildRepo.findOne({
          where: {
            cutter_body_id: body.id,
            completed_at: IsNull(),
          },
        });
        if (openBuild) {
          throw new ConflictException(
            `Cutter body ${bodyIdentifier} already has open build ${openBuild.build_number}`,
          );
        }

        const tray = await trayRepo.findOne({
          where: { serial_number: traySerial, enabled: true },
          lock: { mode: 'pessimistic_write' },
        });
        if (!tray) {
          throw new NotFoundException(`Tray ${traySerial} could not be found`);
        }

        if (!tray.summary_id || !tray.part_type_id) {
          throw new UnprocessableEntityException(
            `Tray ${traySerial} does not have a post-grind Summary and Part Type`,
          );
        }

        const summaryId = tray.summary_id;
        const partTypeId = tray.part_type_id;

        const activeContainerAssignment = await containerTrayRepo.findOne({
          where: { tray_id: tray.id, enabled: true },
        });
        if (activeContainerAssignment) {
          throw new ConflictException(
            `Tray ${traySerial} is still loaded in a container`,
          );
        }

        const activeBuildTrayAssignment = await buildTrayRepo.findOne({
          where: { tray_id: tray.id, enabled: true },
        });
        if (activeBuildTrayAssignment) {
          throw new ConflictException(
            `Tray ${traySerial} is already assigned to an active cutter build`,
          );
        }

        const [summary, partType, requirement, readyStatus, buildEventType, readyForCutterStage] =
          await Promise.all([
            summaryRepo.findOne({
              where: { id: summaryId, enabled: true },
              relations: { model: true },
            }),
            partTypeRepo.findOne({
              where: { id: partTypeId, enabled: true },
            }),
            requirementRepo.findOne({
              where: {
                summary_id: summaryId,
                part_type_id: partTypeId,
                enabled: true,
              },
            }),
            statusRepo.findOne({
              where: { code: 'READY', enabled: true },
            }),
            eventTypeRepo.findOne({
              where: { code: 'CB', enabled: true },
            }),
            trayStageRepo.findOne({
              where: { code: 'READY_FOR_CUTTER', enabled: true },
            }),
          ]);

        if (!summary) {
          throw new NotFoundException('Part summary not found or disabled');
        }
        if (!partType) {
          throw new NotFoundException('Part type not found or disabled');
        }
        if (!requirement) {
          throw new UnprocessableEntityException(
            'No blade requirement exists for this Summary and Part Type',
          );
        }
        if (!cutterBodyMatchesRequirement(body, requirement.required_blade_count, partType.code)) {
          throw new UnprocessableEntityException('Cutter body capacity or blade family does not match this tray requirement');
        }
        if (!readyStatus || !buildEventType || !readyForCutterStage) {
          throw new UnprocessableEntityException(
            'Cutter reference data or tray stages are incomplete',
          );
        }

        if (!tray.grinding_completed_at) {
          throw new UnprocessableEntityException(
            'Grinding is not complete for this tray',
          );
        }
        if (tray.current_stage_id !== readyForCutterStage.id) {
          throw new UnprocessableEntityException(
            'Tray must be READY_FOR_CUTTER on the shelf before Cutter Builder can build it',
          );
        }
        if (tray.summary_id !== summaryId) {
          throw new UnprocessableEntityException(
            'Tray Summary does not match the cutter build',
          );
        }
        if (tray.part_type_id !== partTypeId) {
          throw new UnprocessableEntityException(
            'Tray Part Type does not match the cutter build',
          );
        }
        if (
          tray.required_blade_count !== requirement.required_blade_count
        ) {
          throw new UnprocessableEntityException(
            'Tray required quantity does not match the current cutter requirement',
          );
        }

        const assignments = await bladeTrayRepo.find({
          where: { tray_id: tray.id, enabled: true },
          relations: { blade: true },
          order: { createdAt: 'ASC' },
        });

        if (
          assignments.length !== requirement.required_blade_count ||
          tray.blade_count !== requirement.required_blade_count
        ) {
          throw new UnprocessableEntityException(
            `Tray ${traySerial} must contain exactly ${requirement.required_blade_count} blades`,
          );
        }

        const badBlade = assignments.find(
          ({ blade }) =>
            !blade.enabled ||
            blade.summary_id !== summaryId ||
            blade.part_type_id !== partTypeId,
        );
        if (badBlade) {
          throw new UnprocessableEntityException(
            'One or more blades in the tray do not match the selected Summary and Part Type',
          );
        }

        const notReadyForCutter = assignments.find(
          ({ blade }) => blade.status !== BladeStatus.RETURNED_FROM_COATING,
        );
        if (notReadyForCutter) {
          throw new UnprocessableEntityException(
            'Every blade must be returned from coating before the tray can be used to build a cutter',
          );
        }

        const alreadyInstalled = await buildBladeRepo
          .createQueryBuilder('buildBlade')
          .where('buildBlade.blade_id IN (:...bladeIds)', {
            bladeIds: assignments.map(({ blade_id }) => blade_id),
          })
          .andWhere('buildBlade.enabled = :enabled', { enabled: true })
          .getOne();

        if (alreadyInstalled) {
          throw new ConflictException(
            'One or more blades are already installed in an active cutter build',
          );
        }

        const { buildNumber, buildIncrement } =
          await this.nextBuildNumber(
            manager,
            body.id,
            bodyIdentifier,
            partType.code,
            summary.number,
          );
        const builtAt = new Date();
        const journal = await beginWorkflowJournal(manager, { app: 'CUTTER_BUILDER', trayIds: [tray.id], bodyIds: [body.id] }, userId);

        const build = await buildRepo.save(
          buildRepo.create({
            build_number: buildNumber,
            build_increment: buildIncrement,
            cutter_body_id: body.id,
            summary_id: summaryId,
            part_type_id: partTypeId,
            status_id: readyStatus.id,
            honed: dto.honed ?? false,
            coated: dto.coated ?? false,
            ib_ro: dto.ib_ro ?? null,
            ob_ro: dto.ob_ro ?? null,
            comments: dto.comments?.trim() || null,
            built_by_user_id: userId,
            cutter_builder_machine_id: builderMachine.id,
            built_at: builtAt,
            completed_at: null,
            createdBy: userId,
            updatedBy: userId,
          }),
        );

        await buildBladeRepo.save(
          assignments.map((assignment, index) =>
            buildBladeRepo.create({
              cutter_build_id: build.id,
              blade_id: assignment.blade_id,
              position: index + 1,
              installed_at: builtAt,
              removed_at: null,
              enabled: true,
              createdBy: userId,
              updatedBy: userId,
            }),
          ),
        );

        // Preserve which complete tray supplied this build, while immediately
        // releasing it because the blades are now physically in the cutter.
        await buildTrayRepo.save(
          buildTrayRepo.create({
            cutter_build_id: build.id,
            tray_id: tray.id,
            enabled: false,
            assigned_at: builtAt,
            released_at: builtAt,
            createdBy: userId,
            updatedBy: userId,
          }),
        );

        await eventRepo.save(
          eventRepo.create({
            cutter_build_id: build.id,
            event_type_id: buildEventType.id,
            piece_count: 0,
            machine_number: null,
            part_number: null,
            user_id: userId,
            occurred_at: builtAt,
            comments: dto.comments?.trim() || null,
            createdBy: userId,
            updatedBy: userId,
          }),
        );

        for (const assignment of assignments) {
          assignment.enabled = false;
          assignment.updatedBy = userId;

          const previousStatus = assignment.blade.status;

          await historyRepo.save([
            historyRepo.create({
              blade_id: assignment.blade_id,
              event_type: BladeHistoryEvent.REMOVED_FROM_TRAY,
              service_cycle: assignment.blade.service_cycle ?? 0,
              tray_id: tray.id,
              notes: `Installed in cutter build ${buildNumber}`,
              createdBy: userId,
              updatedBy: userId,
            }),
            historyRepo.create({
              blade_id: assignment.blade_id,
              event_type: BladeHistoryEvent.INSTALLED_IN_CUTTER,
              from_status: previousStatus,
              to_status: BladeStatus.IN_CUTTER,
              service_cycle: assignment.blade.service_cycle ?? 0,
              notes: `Cutter build ${buildNumber}`,
              createdBy: userId,
              updatedBy: userId,
            }),
          ]);

          assignment.blade.status = BladeStatus.IN_CUTTER;
          assignment.blade.updatedBy = userId;
        }
        await bladeRepo.save(assignments.map(({ blade }) => blade));
        await bladeTrayRepo.save(assignments);

        const emptyStage = await trayStageRepo.findOne({
          where: { code: 'EMPTY', enabled: true },
        });
        if (!emptyStage) {
          throw new UnprocessableEntityException('EMPTY tray stage is not configured');
        }

        await locationTrayRepo.update(
          { tray_id: tray.id, enabled: true },
          { enabled: false, updatedBy: userId },
        );

        // The complete set has been consumed by Cutter Builder. The physical tray
        // is empty and immediately reusable.
        tray.blade_count = 0;
        tray.summary_id = null;
        tray.part_type_id = null;
        tray.grinding_completed_at = null;
        tray.required_blade_count = null;
        tray.current_stage_id = emptyStage.id;
        tray.updatedBy = userId;
        await trayRepo.save(tray);

        await journal.commit(build.build_number, `Build cutter from tray ${traySerial}`);
        return {
          build: {
            cutter_build_id: build.id,
            build_number: build.build_number,
            build_increment: build.build_increment,
            cutter_body_serial_number: currentCutterIdentifier(body),
            summary_id: summary.id,
            summary_number: summary.number,
            summary_model: summary.model?.model_number?.toString() ?? '',
            part_type_id: partType.id,
            part_type_code: partType.code,
            blade_count: assignments.length,
            source_tray_serial_number: traySerial,
            honed: build.honed,
            coated: build.coated,
            ib_ro: build.ib_ro,
            ob_ro: build.ob_ro,
            comments: build.comments,
            built_at: build.built_at,
            built_by_user_id: build.built_by_user_id,
            cutter_builder_machine_id: builderMachine.id,
            cutter_builder_machine_number: builderMachine.machine_number,
            status_code: readyStatus.code,
          },
          blade_ids: assignments.map(({ blade_id }) => blade_id),
          tray_released: true,
        };
      },
    );
  }


  async teardownBuild(
    dto: CreateCutterTeardownDto,
    userId: Uuid,
  ): Promise<ICutterTeardownResult> {
    return this.dataSource.transaction(
      'SERIALIZABLE',
      async (manager) => {
        const buildRepo = manager.getRepository(CutterBuildOrmEntity);
        const buildBladeRepo = manager.getRepository(CutterBuildBladeOrmEntity);
        const teardownRepo = manager.getRepository(CutterTeardownOrmEntity);
        const trayRepo = manager.getRepository(TrayOrmEntity);
        const bladeTrayRepo = manager.getRepository(BladeTrayOrmEntity);
        const bladeRepo = manager.getRepository(BladeOrmEntity);
        const containerTrayRepo = manager.getRepository(ContainerTrayOrmEntity);
        const buildTrayRepo = manager.getRepository(CutterBuildTrayOrmEntity);
        const statusRepo = manager.getRepository(CutterBuildStatusOrmEntity);
        const eventTypeRepo = manager.getRepository(CutterEventTypeOrmEntity);
        const eventRepo = manager.getRepository(CutterEventOrmEntity);
        const historyRepo = manager.getRepository(BladeHistoryOrmEntity);
        const locationRepo = manager.getRepository(LocationOrmEntity);
        const locationTrayRepo = manager.getRepository(LocationTrayOrmEntity);
        const trayStageRepo = manager.getRepository(TrayStageOrmEntity);

        const buildNumber = dto.build_number.trim().toUpperCase();
        const teardownTraySerial = dto.teardown_tray_serial_number.trim();
        const shelfLocationSerial = dto.shelf_location_serial_number
          ?.trim()
          .toUpperCase() || null;

        const lockedBuild = await buildRepo.findOne({
          where: {
            build_number: buildNumber,
            completed_at: IsNull(),
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!lockedBuild) {
          throw new NotFoundException(
            `Open cutter build ${buildNumber} could not be found`,
          );
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
          throw new NotFoundException(
            `Open cutter build ${buildNumber} could not be found`,
          );
        }

        if (build.status.code !== 'PULLED') {
          throw new ConflictException(
            `Cutter build ${buildNumber} must be PULLED before Cutter Builder can tear it down`,
          );
        }

        const existingTeardown = await teardownRepo.findOne({
          where: { cutter_build_id: build.id },
        });
        if (existingTeardown) {
          throw new ConflictException(
            `Cutter build ${buildNumber} has already been torn down`,
          );
        }

        const tray = await trayRepo.findOne({
          where: {
            serial_number: teardownTraySerial,
            enabled: true,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!tray) {
          throw new NotFoundException(
            `Teardown tray ${teardownTraySerial} could not be found`,
          );
        }

        const [activeTrayBladeCount, activeContainer, activeCutterTray] =
          await Promise.all([
            bladeTrayRepo.count({
              where: { tray_id: tray.id, enabled: true },
            }),
            containerTrayRepo.findOne({
              where: { tray_id: tray.id, enabled: true },
            }),
            buildTrayRepo.findOne({
              where: { tray_id: tray.id, enabled: true },
            }),
          ]);

        if (activeTrayBladeCount !== 0 || tray.blade_count !== 0) {
          throw new ConflictException(
            `Teardown tray ${teardownTraySerial} must be empty`,
          );
        }
        if (activeContainer) {
          throw new ConflictException(
            `Teardown tray ${teardownTraySerial} is still loaded in a container`,
          );
        }
        if (activeCutterTray) {
          throw new ConflictException(
            `Teardown tray ${teardownTraySerial} is already assigned to a cutter build`,
          );
        }

        const buildBlades = await buildBladeRepo.find({
          where: {
            cutter_build_id: build.id,
            enabled: true,
          },
          relations: { blade: true },
          order: { position: 'ASC', createdAt: 'ASC' },
        });

        const allSnapshotCount = await buildBladeRepo.count({
          where: { cutter_build_id: build.id },
        });

        if (buildBlades.length === 0 || buildBlades.length !== allSnapshotCount) {
          throw new UnprocessableEntityException(
            'Cutter build blade snapshot is incomplete or has already been modified',
          );
        }

        const originalBladeCount = allSnapshotCount;
        const scrappedBladeCount = dto.scrapped_blade_count;

        if (scrappedBladeCount > originalBladeCount) {
          throw new UnprocessableEntityException(
            `Scrapped blade count cannot exceed the original cutter quantity of ${originalBladeCount}`,
          );
        }

        const returnedBladeCount = originalBladeCount - scrappedBladeCount;
        const returnedRows = buildBlades.slice(0, returnedBladeCount);
        const scrappedRows = buildBlades.slice(returnedBladeCount);

        const [closedStatus, teardownEventType] = await Promise.all([
          statusRepo.findOne({
            where: { code: 'CLOSED', enabled: true },
          }),
          eventTypeRepo.findOne({
            where: { code: 'TD', enabled: true },
          }),
        ]);

        if (!closedStatus || !teardownEventType) {
          throw new UnprocessableEntityException(
            'Cutter teardown reference data is incomplete',
          );
        }

        const [waitingStage, emptyStage] = await Promise.all([
          trayStageRepo.findOne({
            where: { code: 'WAITING_FOR_GRINDING', enabled: true },
          }),
          trayStageRepo.findOne({
            where: { code: 'EMPTY', enabled: true },
          }),
        ]);

        if (!waitingStage || !emptyStage) {
          throw new UnprocessableEntityException(
            'Required tray stages are not configured',
          );
        }

        const expectedDullShelfPrefix = build.part_type.code === 'RING' ? 'CGDR' : 'CGDP';
        let shelfLocation: LocationOrmEntity | null = null;
        if (returnedBladeCount > 0) {
          if (!shelfLocationSerial) {
            throw new UnprocessableEntityException(
              `Teardown returned ${returnedBladeCount} blade(s). Scan required dull shelf ${expectedDullShelfPrefix}-NNN.`,
            );
          }
          shelfLocation = await locationRepo.findOne({
            where: { serial_number: shelfLocationSerial, enabled: true },
            lock: { mode: 'pessimistic_read' },
          });
          const numberedShelf = parseCuttergrindNumberedShelfTag(shelfLocationSerial);
          if (
            !shelfLocation ||
            !numberedShelf ||
            numberedShelf.kind !== 'CUTTERGRIND_DULL' ||
            numberedShelf.partTypeCode !== build.part_type.code ||
            shelfLocation.location_type !== 'SHELF' ||
            shelfLocation.department !== DEPARTMENT_CUTTERGRIND
          ) {
            throw new UnprocessableEntityException(
              `Teardown ${build.part_type.code} blades for Summary ${build.summary.number} must be returned to ${expectedDullShelfPrefix}-NNN`,
            );
          }
        }

        const tornDownAt = new Date();

        // Returned cutter blades go to a tagged shelf location and wait for grinding.
        // Required quantity remains null until grinding is completed.
        if (returnedBladeCount > 0) {
          tray.summary_id = build.summary_id;
          tray.part_type_id = build.part_type_id;
          tray.blade_count = returnedBladeCount;
          tray.grinding_completed_at = null;
          tray.required_blade_count = null;
          tray.current_stage_id = waitingStage.id;
        } else {
          tray.summary_id = null;
          tray.part_type_id = null;
          tray.blade_count = 0;
          tray.grinding_completed_at = null;
          tray.required_blade_count = null;
          tray.current_stage_id = emptyStage.id;
        }
        tray.updatedBy = userId;
        await trayRepo.save(tray);

        // Empty trays do not require a physical location. Clear any prior placement.
        // Once teardown returns blades, the tray becomes Summary/Part Type specific and
        // must be physically assigned to the matching Cuttergrind dull shelf.
        await locationTrayRepo.update(
          { tray_id: tray.id, enabled: true },
          { enabled: false, updatedBy: userId },
        );
        if (returnedBladeCount > 0 && shelfLocation) {
          await locationTrayRepo.save(
            locationTrayRepo.create({
              tray_id: tray.id,
              location_id: shelfLocation.id,
              enabled: true,
              createdBy: userId,
              updatedBy: userId,
            }),
          );
        }

        for (const buildBlade of returnedRows) {
          const blade = buildBlade.blade;
          const previousStatus = blade.status;

          buildBlade.enabled = false;
          buildBlade.removed_at = tornDownAt;
          buildBlade.updatedBy = userId;

          blade.status = BladeStatus.WAITING_FOR_GRINDING;
          blade.updatedBy = userId;

          await bladeTrayRepo.save(
            bladeTrayRepo.create({
              blade_id: blade.id,
              tray_id: tray.id,
              enabled: true,
              createdBy: userId,
              updatedBy: userId,
            }),
          );

          await historyRepo.save([
            historyRepo.create({
              blade_id: blade.id,
              event_type: BladeHistoryEvent.REMOVED_FROM_CUTTER,
              from_status: previousStatus,
              to_status: BladeStatus.WAITING_FOR_GRINDING,
              service_cycle: blade.service_cycle ?? 0,
              notes: `Removed from cutter build ${build.build_number}; placed on shelf ${shelfLocation!.serial_number}`,
              createdBy: userId,
              updatedBy: userId,
            }),
            historyRepo.create({
              blade_id: blade.id,
              event_type: BladeHistoryEvent.ASSIGNED_TO_TRAY,
              service_cycle: blade.service_cycle ?? 0,
              tray_id: tray.id,
              notes: `Cutter teardown ${build.build_number}`,
              createdBy: userId,
              updatedBy: userId,
            }),
          ]);
        }

        for (const buildBlade of scrappedRows) {
          const blade = buildBlade.blade;
          const previousStatus = blade.status;

          buildBlade.enabled = false;
          buildBlade.removed_at = tornDownAt;
          buildBlade.updatedBy = userId;

          blade.status = BladeStatus.SCRAPPED;
          blade.updatedBy = userId;

          await historyRepo.save([
            historyRepo.create({
              blade_id: blade.id,
              event_type: BladeHistoryEvent.REMOVED_FROM_CUTTER,
              from_status: previousStatus,
              to_status: BladeStatus.SCRAPPED,
              service_cycle: blade.service_cycle ?? 0,
              notes: `Scrapped during cutter teardown ${build.build_number}`,
              createdBy: userId,
              updatedBy: userId,
            }),
            historyRepo.create({
              blade_id: blade.id,
              event_type: BladeHistoryEvent.SCRAPPED,
              service_cycle: blade.service_cycle ?? 0,
              notes: `Cutter teardown ${build.build_number}`,
              createdBy: userId,
              updatedBy: userId,
            }),
          ]);
        }

        await buildBladeRepo.save(buildBlades);
        await bladeRepo.save(buildBlades.map(({ blade }) => blade));

        const teardown = await teardownRepo.save(
          teardownRepo.create({
            cutter_build_id: build.id,
            tray_id: tray.id,
            original_blade_count: originalBladeCount,
            returned_blade_count: returnedBladeCount,
            scrapped_blade_count: scrappedBladeCount,
            torn_down_by_user_id: userId,
            torn_down_at: tornDownAt,
            comments: dto.comments?.trim() || null,
            createdBy: userId,
            updatedBy: userId,
          }),
        );

        await eventRepo.save(
          eventRepo.create({
            cutter_build_id: build.id,
            event_type_id: teardownEventType.id,
            piece_count: 0,
            machine_number: null,
            part_number: null,
            user_id: userId,
            occurred_at: tornDownAt,
            comments:
              dto.comments?.trim() ||
              `Teardown: ${returnedBladeCount} returned, ${scrappedBladeCount} scrapped`,
            createdBy: userId,
            updatedBy: userId,
          }),
        );

        build.status_id = closedStatus.id;
        build.status = closedStatus;
        build.completed_at = tornDownAt;
        build.updatedBy = userId;
        await buildRepo.save(build);

        return {
          teardown_id: teardown.id,
          build_number: build.build_number,
          cutter_body_serial_number: currentCutterIdentifier(build.cutter_body),
          teardown_tray_serial_number: tray.serial_number,
          shelf_location_serial_number: shelfLocation?.serial_number ?? null,
          original_blade_count: originalBladeCount,
          returned_blade_count: returnedBladeCount,
          scrapped_blade_count: scrappedBladeCount,
          build_closed: true,
          tray_waiting_for_grinding: returnedBladeCount > 0,
          tray_available_for_use: returnedBladeCount === 0,
          torn_down_at: tornDownAt,
        };
      },
    );
  }



  async getDashboard() {
    return loadCutterBuilderDashboard(this.dataSource);
  }

  async searchBuilds(query?: {
    q?: string;
    status?: string;
    partType?: string;
    cutterBody?: string;
    limit?: number;
  }) {
    return searchCutterBuilds(this.dataSource, query);
  }

  async getTeardownByBuildNumber(buildNumber: string) {
    const build = await this.getBuildByNumber(buildNumber);
    const teardown = await this.dataSource
      .getRepository(CutterTeardownOrmEntity)
      .findOne({
        where: { cutter_build_id: build.id },
        relations: { tray: true, torn_down_by_user: true },
      });

    if (!teardown) {
      throw new NotFoundException(
        `No teardown exists for cutter build ${build.build_number}`,
      );
    }

    return teardown;
  }

  async getBuildByNumber(buildNumber: string) {
    const build = await this.dataSource
      .getRepository(CutterBuildOrmEntity)
      .findOne({
        where: { build_number: buildNumber.trim().toUpperCase() },
        relations: {
          cutter_body: true,
          summary: { model: true },
          part_type: true,
          status: true,
          cutter_builder_machine: true,
        },
      });

    if (!build) {
      throw new NotFoundException(`Cutter build ${buildNumber} not found`);
    }
    return build;
  }

  async getCutterCard(buildNumber: string) {
    const build = await this.getBuildByNumber(buildNumber);
    const bladeCount = await this.dataSource
      .getRepository(CutterBuildBladeOrmEntity)
      .count({
        where: { cutter_build_id: build.id },
      });

    const trayHistory = await this.dataSource
      .getRepository(CutterBuildTrayOrmEntity)
      .findOne({
        where: { cutter_build_id: build.id },
        relations: { tray: true },
        order: { assigned_at: 'DESC' },
      });

    const builtBy = build.built_by_user_id
      ? await this.dataSource.getRepository(UserOrmEntity).findOne({
          where: { id: build.built_by_user_id },
        })
      : null;
    const builtByName =
      [builtBy?.firstName, builtBy?.lastName].filter(Boolean).join(' ').trim() ||
      builtBy?.email ||
      '';

    const latestRun = await this.dataSource
      .getRepository(CutterMachineRunOrmEntity)
      .findOne({
        where: { cutter_build_id: build.id },
        order: { installed_at: 'DESC' },
      });

    const cutterBodySerial = currentCutterIdentifier(build.cutter_body);
    const prn = buildCutterCardIpl({
      buildId: build.build_number,
      buildDate: cutterCardBuildDate(build.built_at),
      name: builtByName,
      bodyNumber: cutterBodySerial,
      machine: latestRun?.machine_number ?? '',
      coated: build.coated,
      honed: build.honed,
    });
    const artifactStem = build.build_number.replace(/[^A-Za-z0-9._-]/g, '_');

    return {
      cutter_build_id: build.id,
      build_number: build.build_number,
      build_increment: build.build_increment,
      cutter_body_serial_number: cutterBodySerial,
      summary_id: build.summary.id,
      summary_number: build.summary.number,
      summary_model: build.summary.model?.model_number?.toString() ?? '',
      part_type_id: build.part_type.id,
      part_type_code: build.part_type.code,
      blade_count: bladeCount,
      source_tray_serial_number: trayHistory?.tray.serial_number ?? '',
      honed: build.honed,
      coated: build.coated,
      ib_ro: build.ib_ro,
      ob_ro: build.ob_ro,
      comments: build.comments,
      built_at: build.built_at,
      built_by_user_id: build.built_by_user_id,
      built_by_name: builtByName,
      cutter_builder_machine_id: build.cutter_builder_machine_id,
      cutter_builder_machine_number: build.cutter_builder_machine?.machine_number ?? null,
      machine_number: latestRun?.machine_number ?? '',
      status_code: build.status.code,
      prn_file_name: artifactStem + '.prn',
      png_file_name: artifactStem + '.png',
      prn_base64: prn.toString('base64'),
    };
  }

  private async nextBuildNumber(
    manager: EntityManager,
    cutterBodyId: Uuid,
    cutterBodySerial: string,
    partTypeCode: string,
    summaryNumber: string,
  ): Promise<{ buildNumber: string; buildIncrement: number }> {
    // The physical cutter body row is already pessimistically locked by
    // createBuild(), so calculating MAX+1 here is race-safe for that body.
    const previous = await manager.getRepository(CutterBuildOrmEntity).findOne({
      withDeleted: true,
      where: { cutter_body_id: cutterBodyId },
      order: { build_increment: 'DESC' },
    });

    const buildIncrement = (previous?.build_increment ?? 0) + 1;
    const partLetter = this.partTypeLetter(partTypeCode);
    const bodySegment = this.buildNumberSegment(cutterBodySerial, 'cutter body');
    const summarySegment = this.buildNumberSegment(summaryNumber, 'summary');

    return {
      buildIncrement,
      buildNumber: `${partLetter}${summarySegment}-${bodySegment}-${String(buildIncrement).padStart(3, '0')}`,
    };
  }

  private partTypeLetter(code: string): 'R' | 'P' {
    switch (code.trim().toUpperCase()) {
      case 'RING':
        return 'R';
      case 'PINION':
        return 'P';
      default:
        throw new UnprocessableEntityException(
          `Unsupported cutter Part Type ${code}; expected RING or PINION`,
        );
    }
  }

  private buildNumberSegment(value: string, label: string): string {
    const segment = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!segment) {
      throw new UnprocessableEntityException(
        `Cannot generate cutter build number: ${label} is empty`,
      );
    }
    return segment;
  }
}
