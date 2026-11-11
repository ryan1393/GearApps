/**
 * Entities with no custom queries: a service + controller each, built from the
 * generic CRUD base. Anything that needs bespoke endpoints lives in its own file.
 */
import { LapperWritePolicy, CrudService, crudController } from '@meshforge/api/core';
import {
  CreateDepartmentDto,
  CreatePartDto,
  CreateSummaryDto,
  DepartmentDto,
  PartDto,
  SummaryDto,
  UpdateDepartmentDto,
  UpdatePartDto,
  UpdateSummaryDto,
} from '@meshforge/api/data-access';
import { Department, Part, Summary } from '@meshforge/shared/domain';
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
