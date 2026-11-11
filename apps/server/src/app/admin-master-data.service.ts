import {
  DepartmentOrmEntity,
  CutterMachineRunOrmEntity,
  MachineOrmEntity,
  TrayOrmEntity,
  ModelOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import { Uuid } from '@meshforge/manufacturing/shared/util-types';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import {
  CreateAdminMachineDto,
  CreateAdminModelDto,
  UpdateAdminMachineDto,
  UpdateAdminModelDto,
} from './admin-master-data.dto';

@Injectable()
export class AdminMasterDataService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  listDepartments() {
    return this.dataSource.getRepository(DepartmentOrmEntity).find({
      where: { enabled: true },
      order: { code: 'ASC' },
    });
  }

  listModels() {
    return this.dataSource.getRepository(ModelOrmEntity).find({
      order: { model_number: 'ASC', model_type: 'ASC' },
    });
  }

  /**
   * Counts for the go-live checklist: what has been set up, and what inventory is recorded.
   * Read-only. Optional parts of the system that are not installed count as zero.
   */
  async launchStatus() {
    const count = async (sql: string): Promise<number> => {
      try {
        const [row] = await this.dataSource.query(sql);
        return Number(row?.count ?? 0);
      } catch {
        return 0;
      }
    };
    const [users, grinders, builders, productionMachines, trays, containers, cutterBodies, tagPrinters] = await Promise.all([
      count(`SELECT count(*) FROM users WHERE active AND "deletedAt" IS NULL`),
      count(`SELECT count(*) FROM machines WHERE enabled AND machine_type='GRINDER'`),
      count(`SELECT count(*) FROM machines WHERE enabled AND machine_type='CUTTER_BUILDER'`),
      count(`SELECT count(*) FROM machines WHERE enabled AND machine_type='PRODUCTION'`),
      count('SELECT count(*) FROM trays WHERE enabled'),
      count('SELECT count(*) FROM containers WHERE enabled'),
      count('SELECT count(*) FROM cutter_bodies WHERE enabled'),
      count(`SELECT count(*) FROM gear_label_printers WHERE enabled AND is_default AND label_type='ASSET_TAG'`),
    ]);
    const shelves: Array<{ kind: string; count: string }> = await this.dataSource.query(`SELECT CASE
        WHEN serial_number ~ '^CGR[RP]-[0-9]{3}$' THEN 'rough'
        WHEN serial_number ~ '^CGF[RP]-[0-9]{3}$' THEN 'finished'
        WHEN serial_number ~ '^CGD[RP]-' THEN 'dull'
        WHEN serial_number ~ '^GS[RP]-' THEN 'greenshed'
        ELSE 'other' END AS kind, count(*) AS count
      FROM locations WHERE enabled GROUP BY 1`);
    const stages: Array<{ code: string; name: string; trays: string; blades: string }> = await this.dataSource.query(
      `SELECT s.code, s.name, count(t.id) AS trays, COALESCE(sum(t.blade_count), 0) AS blades
         FROM tray_stages s LEFT JOIN trays t ON t.current_stage_id=s.id AND t.enabled
        GROUP BY s.code, s.name, s.sort_order ORDER BY s.sort_order, s.code`);
    const [cuttersBuilt, cuttersRunning, rpaForm, rpaSettings, rpaMappings] = await Promise.all([
      count(`SELECT count(*) FROM cutter_builds b JOIN cutter_build_statuses s ON s.id=b.status_id WHERE s.code NOT IN ('PULLED','CLOSED')`),
      count(`SELECT count(*) FROM cutter_machine_runs WHERE enabled`),
      count('SELECT (SELECT count(*) FROM dana_rpa_template_v1) + (SELECT count(*) FROM dana_rpa_requests_v1) AS count'),
      count('SELECT count(*) FROM dana_rpa_settings_v1'),
      count('SELECT count(*) FROM dana_rpa_part_map_v1'),
    ]);
    const shelf = (kind: string) => Number(shelves.find((row) => row.kind === kind)?.count ?? 0);
    return {
      setup: {
        users, grinders, cutter_builder_machines: builders, production_machines: productionMachines,
        trays, containers, cutter_bodies: cutterBodies, default_tag_printer: tagPrinters > 0,
        shelves: { dull: shelf('dull'), rough: shelf('rough'), finished: shelf('finished'), greenshed: shelf('greenshed'), other: shelf('other') },
        coater_rpa_ready: rpaForm > 0 && rpaSettings > 0 && rpaMappings > 0,
      },
      inventory: {
        stages: stages.map((row) => ({ code: row.code, name: row.name, trays: Number(row.trays), blades: Number(row.blades) })),
        cutters_built: cuttersBuilt, cutters_running: cuttersRunning,
      },
    };
  }

  async createModel(dto: CreateAdminModelDto, userId: Uuid) {
    const modelType = dto.model_type?.trim() || null;
    if (dto.model_number == null && !modelType) {
      throw new UnprocessableEntityException(
        'Model number or model type is required',
      );
    }

    const repo = this.dataSource.getRepository(ModelOrmEntity);
    await this.assertModelIsNew(dto.model_number ?? null, modelType);

    return repo.save(
      repo.create({
        model_number: dto.model_number ?? null,
        model_type: modelType,
        active: dto.active ?? true,
        enabled: true,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
  }

  listMachines() {
    return this.dataSource.getRepository(MachineOrmEntity).find({
      relations: { department: true },
      order: { machine_number: 'ASC' },
    });
  }

  async createMachine(dto: CreateAdminMachineDto, userId: Uuid) {
    const machineNumber = dto.machine_number.trim().toUpperCase();
    if (!machineNumber) {
      throw new UnprocessableEntityException('Machine number is required');
    }

    const department = await this.dataSource
      .getRepository(DepartmentOrmEntity)
      .findOne({
        where: { id: dto.department_id, enabled: true },
      });
    if (!department) {
      throw new NotFoundException('Department was not found or is disabled');
    }

    const repo = this.dataSource.getRepository(MachineOrmEntity);
    const existing = await repo.findOne({
      where: { machine_number: machineNumber },
    });
    if (existing) {
      throw new ConflictException(`Machine ${machineNumber} already exists`);
    }

    return repo.save(
      repo.create({
        machine_number: machineNumber,
        department_id: department.id,
        cell: dto.cell ?? null,
        description: dto.description?.trim() || null,
        machine_type: dto.machine_type ?? 'PRODUCTION',
        active: dto.active ?? true,
        enabled: true,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
  }

  /** One model per number and type; "2G", "2g" and " 2G " are the same type. */
  private async assertModelIsNew(number: number | null, type: string | null, exceptId?: string): Promise<void> {
    const wanted = (type ?? '').trim().toUpperCase();
    const sameNumber = await this.dataSource.getRepository(ModelOrmEntity).find({
      where: { model_number: number ?? IsNull() },
    });
    if (sameNumber.some((model) => model.id !== exceptId && (model.model_type ?? '').trim().toUpperCase() === wanted)) {
      throw new ConflictException(`Model ${number ?? ''} ${type ?? ''}`.trim() + ' already exists');
    }
  }

  async updateModel(id: Uuid, dto: UpdateAdminModelDto, userId: Uuid) {
    const repo = this.dataSource.getRepository(ModelOrmEntity);
    const model = await repo.findOne({ where: { id } });
    if (!model) throw new NotFoundException('Model was not found');
    if (dto.model_number !== undefined) model.model_number = dto.model_number;
    if (dto.model_type !== undefined)
      model.model_type = dto.model_type?.trim() || null;
    if (dto.model_number !== undefined || dto.model_type !== undefined)
      await this.assertModelIsNew(model.model_number ?? null, model.model_type ?? null, id);
    if (dto.active !== undefined) model.active = dto.active;
    if (dto.enabled !== undefined) {
      model.enabled = dto.enabled;
      if (!dto.enabled) model.active = false;
      else if (dto.active === undefined) model.active = true;
    }
    model.updatedBy = userId;
    return repo.save(model);
  }

  async updateMachine(id: Uuid, dto: UpdateAdminMachineDto, userId: Uuid) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MachineOrmEntity);
      // Setup locks this row too; hold it across the running-state check and edit.
      const machine = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!machine) throw new NotFoundException('Machine was not found');
      const changesRunningConfiguration =
        (dto.machine_number !== undefined &&
          dto.machine_number.trim().toUpperCase() !== machine.machine_number) ||
        (dto.department_id !== undefined &&
          dto.department_id !== machine.department_id) ||
        (dto.machine_type !== undefined &&
          dto.machine_type !== machine.machine_type) ||
        dto.active === false ||
        dto.enabled === false;
      if (
        changesRunningConfiguration &&
        (await manager
          .getRepository(CutterMachineRunOrmEntity)
          .count({ where: { machine_id: id, enabled: true } }))
      ) {
        throw new ConflictException(
          'Pull the running cutter before changing or disabling this machine',
        );
      }
      if (changesRunningConfiguration && await manager.getRepository(TrayOrmEntity).count({ where: { current_grinding_machine_id: id, enabled: true } })) {
        throw new ConflictException('Complete the active grinding pass before changing or disabling this grinder');
      }
      if (dto.machine_number !== undefined) {
        const machineNumber = dto.machine_number.trim().toUpperCase();
        if (!machineNumber)
          throw new UnprocessableEntityException('Machine number is required');
        const duplicate = await repo.findOne({
          where: { machine_number: machineNumber },
        });
        if (duplicate && duplicate.id !== id)
          throw new ConflictException(
            `Machine ${machineNumber} already exists`,
          );
        machine.machine_number = machineNumber;
      }
      if (dto.department_id !== undefined) {
        const department = await manager
          .getRepository(DepartmentOrmEntity)
          .findOne({ where: { id: dto.department_id, enabled: true } });
        if (!department)
          throw new NotFoundException(
            'Department was not found or is disabled',
          );
        machine.department_id = department.id;
        machine.department = department;
      }
      if (dto.cell !== undefined) machine.cell = dto.cell;
      if (dto.description !== undefined)
        machine.description = dto.description?.trim() || null;
      if (dto.machine_type !== undefined)
        machine.machine_type = dto.machine_type;
      if (dto.active !== undefined) machine.active = dto.active;
      if (dto.enabled !== undefined) {
        machine.enabled = dto.enabled;
        if (!dto.enabled) machine.active = false;
        else if (dto.active === undefined) machine.active = true;
      }
      machine.updatedBy = userId;
      await repo.save(machine);
      return repo.findOneOrFail({
        where: { id },
        relations: { department: true },
      });
    });
  }

  async disableModel(id: Uuid, userId: Uuid) {
    const repo = this.dataSource.getRepository(ModelOrmEntity);
    const model = await repo.findOne({ where: { id, enabled: true } });
    if (!model) {
      throw new NotFoundException('Model was not found or is already disabled');
    }
    model.enabled = false;
    model.active = false;
    model.updatedBy = userId;
    return repo.save(model);
  }

  async disableMachine(id: Uuid, userId: Uuid) {
    return this.updateMachine(id, { enabled: false, active: false }, userId);
  }
}
