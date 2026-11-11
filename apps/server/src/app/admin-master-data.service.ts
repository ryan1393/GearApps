import {
  DepartmentOrmEntity,
  CutterMachineRunOrmEntity,
  MachineOrmEntity,
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

  async createModel(dto: CreateAdminModelDto, userId: Uuid) {
    const modelType = dto.model_type?.trim() || null;
    if (dto.model_number == null && !modelType) {
      throw new UnprocessableEntityException(
        'Model number or model type is required',
      );
    }

    const repo = this.dataSource.getRepository(ModelOrmEntity);
    const existing = await repo.findOne({
      where: {
        model_number: dto.model_number ?? IsNull(),
        model_type: modelType ?? IsNull(),
      },
    });
    if (existing) {
      throw new ConflictException(
        `Model ${dto.model_number ?? ''} ${modelType ?? ''}`.trim() +
          ' already exists',
      );
    }

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

  async updateModel(id: Uuid, dto: UpdateAdminModelDto, userId: Uuid) {
    const repo = this.dataSource.getRepository(ModelOrmEntity);
    const model = await repo.findOne({ where: { id } });
    if (!model) throw new NotFoundException('Model was not found');
    if (dto.model_number !== undefined) model.model_number = dto.model_number;
    if (dto.model_type !== undefined)
      model.model_type = dto.model_type?.trim() || null;
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
