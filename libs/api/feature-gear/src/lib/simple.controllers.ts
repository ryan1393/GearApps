/**
 * Entities with no custom queries: a service + controller each, built from the
 * generic CRUD base. Anything that needs bespoke endpoints lives in its own file.
 */
import { BaseCrudService, crudController } from '@gearapps/api/core';
import {
  CreateDepartmentDto,
  CreateGearsetMarriageDto,
  CreatePartDto,
  CreateSummaryDto,
  CreateTypeOfCheckDto,
  DepartmentDto,
  DepartmentEntity,
  GearsetMarriageDto,
  GearsetMarriageEntity,
  PartDto,
  PartEntity,
  SummaryDto,
  SummaryEntity,
  TypeOfCheckDto,
  TypeOfCheckEntity,
  UpdateDepartmentDto,
  UpdateGearsetMarriageDto,
  UpdatePartDto,
  UpdateSummaryDto,
  UpdateTypeOfCheckDto,
} from '@gearapps/api/data-access';
import { Department, GearsetMarriage, Part, Summary, TypeOfCheck } from '@gearapps/shared/domain';
import { Controller, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Repository } from 'typeorm';

// ---------- Departments ----------
@Injectable()
export class DepartmentsService extends BaseCrudService<Department> {
  protected override readonly order = { number: 'ASC' as const };
  constructor(@InjectRepository(DepartmentEntity) repo: Repository<Department>) {
    super(repo, 'Department');
  }
}

@Controller({ path: 'department', version: '1' })
@ApiTags('Gear · Departments')
@ApiBearerAuth()
export class DepartmentsController extends crudController<Department>({
  entity: DepartmentDto,
  create: CreateDepartmentDto,
  update: UpdateDepartmentDto,
  name: 'department',
}) {
  constructor(override readonly service: DepartmentsService) {
    super();
  }
}

// ---------- Type of checks ----------
@Injectable()
export class TypeOfChecksService extends BaseCrudService<TypeOfCheck> {
  protected override readonly order = { name: 'ASC' as const };
  constructor(@InjectRepository(TypeOfCheckEntity) repo: Repository<TypeOfCheck>) {
    super(repo, 'Type of check');
  }
}

@Controller({ path: 'toc', version: '1' })
@ApiTags('Gear · Type of checks')
@ApiBearerAuth()
export class TypeOfChecksController extends crudController<TypeOfCheck>({
  entity: TypeOfCheckDto,
  create: CreateTypeOfCheckDto,
  update: UpdateTypeOfCheckDto,
  name: 'type of check',
}) {
  constructor(override readonly service: TypeOfChecksService) {
    super();
  }
}

// ---------- Summaries ----------
@Injectable()
export class SummariesService extends BaseCrudService<Summary> {
  protected override readonly relations = { user: true };
  protected override readonly order = { number: 'ASC' as const };
  constructor(@InjectRepository(SummaryEntity) repo: Repository<Summary>) {
    super(repo, 'Summary');
  }
}

@Controller({ path: 'part-summary', version: '1' })
@ApiTags('Gear · Part summaries')
@ApiBearerAuth()
export class SummariesController extends crudController<Summary>({
  entity: SummaryDto,
  create: CreateSummaryDto,
  update: UpdateSummaryDto,
  name: 'part summary',
}) {
  constructor(override readonly service: SummariesService) {
    super();
  }
}

// ---------- Parts ----------
@Injectable()
export class PartsService extends BaseCrudService<Part> {
  protected override readonly relations = { summary: true, user: true };
  protected override readonly order = { number: 'ASC' as const };
  constructor(@InjectRepository(PartEntity) repo: Repository<Part>) {
    super(repo, 'Part');
  }
}

@Controller({ path: 'part', version: '1' })
@ApiTags('Gear · Parts')
@ApiBearerAuth()
export class PartsController extends crudController<Part>({
  entity: PartDto,
  create: CreatePartDto,
  update: UpdatePartDto,
  name: 'part',
}) {
  constructor(override readonly service: PartsService) {
    super();
  }
}

// ---------- Gearset marriages ----------
@Injectable()
export class GearsetMarriagesService extends BaseCrudService<GearsetMarriage> {
  protected override readonly relations = { gearset: true, pinion: true, ring: true };
  constructor(@InjectRepository(GearsetMarriageEntity) repo: Repository<GearsetMarriage>) {
    super(repo, 'Gearset marriage');
  }
}

@Controller({ path: 'gearset-marriage', version: '1' })
@ApiTags('Gear · Gearset marriages')
@ApiBearerAuth()
export class GearsetMarriagesController extends crudController<GearsetMarriage>({
  entity: GearsetMarriageDto,
  create: CreateGearsetMarriageDto,
  update: UpdateGearsetMarriageDto,
  name: 'gearset marriage',
}) {
  constructor(override readonly service: GearsetMarriagesService) {
    super();
  }
}
