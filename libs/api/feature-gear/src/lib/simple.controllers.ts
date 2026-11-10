/**
 * Entities with no custom queries: a service + controller each, built from the
 * generic CRUD base. Anything that needs bespoke endpoints lives in its own file.
 */
import { LapperWritePolicy, CrudService, crudController } from '@gearapps/api/core';
import {
  CreateDepartmentDto,
  CreateGearsetMarriageDto,
  CreatePartDto,
  CreateSummaryDto,
  CreateTypeOfCheckDto,
  DepartmentDto,
  GearsetMarriageDto,
  PartDto,
  SummaryDto,
  TypeOfCheckDto,
  UpdateDepartmentDto,
  UpdateGearsetMarriageDto,
  UpdatePartDto,
  UpdateSummaryDto,
  UpdateTypeOfCheckDto,
} from '@gearapps/api/data-access';
import { Department, GearsetMarriage, Part, Summary, TypeOfCheck } from '@gearapps/shared/domain';
import { UseInterceptors, Controller, Injectable } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
// ---------- Departments ----------
@Injectable()
export abstract class DepartmentsService extends CrudService<Department> {}
@UseInterceptors(LapperWritePolicy)
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
export abstract class TypeOfChecksService extends CrudService<TypeOfCheck> {}
@UseInterceptors(LapperWritePolicy)
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
export abstract class SummariesService extends CrudService<Summary> {}
@UseInterceptors(LapperWritePolicy)
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
export abstract class PartsService extends CrudService<Part> {}
@UseInterceptors(LapperWritePolicy)
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
export abstract class GearsetMarriagesService extends CrudService<GearsetMarriage> {}
@UseInterceptors(LapperWritePolicy)
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
