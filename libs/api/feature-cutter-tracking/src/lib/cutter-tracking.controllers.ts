import { BaseCrudService, crudController } from '@gearapps/api/core';
import {
  CheckCmmDto,
  CheckCmmEntity,
  CheckFrequencyDto,
  CheckFrequencyEntity,
  CreateCheckCmmDto,
  CreateCheckFrequencyDto,
  CreateCutterBuildDto,
  CreateCutterLogDto,
  CreatePullCutterReasonDto,
  CreateRetiredCutterDto,
  CutterBuildDto,
  CutterBuildEntity,
  DB_SUPPORTS_NON_PK_IDENTITY,
  CutterLogDto,
  CutterLogEntity,
  PullCutterReasonDto,
  PullCutterReasonEntity,
  RetiredCutterDto,
  RetiredCutterEntity,
  UpdateCheckCmmDto,
  UpdateCheckFrequencyDto,
  UpdateCutterBuildDto,
  UpdateCutterLogDto,
  UpdatePullCutterReasonDto,
  UpdateRetiredCutterDto,
} from '@gearapps/api/data-access';
import {
  CheckCmm,
  CheckFrequency,
  CutterBuild,
  CutterLog,
  PullCutterReason,
  RetiredCutter,
} from '@gearapps/shared/domain';
import { Controller, Get, Injectable, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';

// ---------- Logs ----------
@Injectable()
export class CutterLogsService extends BaseCrudService<CutterLog> {
  protected override readonly relations = { toc: true, machine: true, part: true, user: true };
  protected override readonly order = { timestamp: 'DESC' as const };
  constructor(@InjectRepository(CutterLogEntity) repo: Repository<CutterLog>) {
    super(repo, 'Cutter log');
  }
  findByBuild(buildId: string): Promise<CutterLog[]> {
    return this.findAll({ build_id: buildId });
  }
}

@Controller({ path: 'log', version: '1' })
@ApiTags('Cutter tracking · Logs')
@ApiBearerAuth()
export class CutterLogsController extends crudController<CutterLog>({
  entity: CutterLogDto,
  create: CreateCutterLogDto,
  update: UpdateCutterLogDto,
  name: 'cutter log',
}) {
  constructor(override readonly service: CutterLogsService) {
    super();
  }

  @Get('build/:buildId')
  @ApiOperation({ summary: 'All log entries for a cutter build id' })
  @ApiOkResponse({ type: CutterLogDto, isArray: true })
  findByBuild(@Param('buildId') buildId: string): Promise<CutterLog[]> {
    return this.service.findByBuild(buildId);
  }
}

// ---------- Pull cutter reasons ----------
@Injectable()
export class PullCutterReasonsService extends BaseCrudService<PullCutterReason> {
  protected override readonly order = { description: 'ASC' as const };
  constructor(@InjectRepository(PullCutterReasonEntity) repo: Repository<PullCutterReason>) {
    super(repo, 'Pull cutter reason');
  }
}

@Controller({ path: 'pcr', version: '1' })
@ApiTags('Cutter tracking · Pull cutter reasons')
@ApiBearerAuth()
export class PullCutterReasonsController extends crudController<PullCutterReason>({
  entity: PullCutterReasonDto,
  create: CreatePullCutterReasonDto,
  update: UpdatePullCutterReasonDto,
  name: 'pull cutter reason',
}) {
  constructor(override readonly service: PullCutterReasonsService) {
    super();
  }
}

// ---------- Cutter builds ----------
@Injectable()
export class CutterBuildsService extends BaseCrudService<CutterBuild> {
  protected override readonly relations = { log: true, summary: true };
  protected override readonly order = { number: 'DESC' as const };
  constructor(@InjectRepository(CutterBuildEntity) repo: Repository<CutterBuild>) {
    super(repo, 'Cutter build');
  }

  /** Build numbers are DB-generated on SQL Server; on SQLite we allocate MAX+1 ourselves. */
  override async create(data: DeepPartial<CutterBuild>): Promise<CutterBuild> {
    if (DB_SUPPORTS_NON_PK_IDENTITY) return super.create(data);
    return this.repo.manager.transaction(async (em) => {
      const { max } = (await em
        .createQueryBuilder(CutterBuildEntity, 'cb')
        .select('MAX(cb.number)', 'max')
        .getRawOne<{ max: number | null }>()) ?? { max: null };
      const saved = await em.save(
        CutterBuildEntity,
        em.create(CutterBuildEntity, { ...data, number: (max ?? 0) + 1 }),
      );
      return this.findOne(saved.id);
    });
  }
}

@Controller({ path: 'cutter-build', version: '1' })
@ApiTags('Cutter tracking · Builds')
@ApiBearerAuth()
export class CutterBuildsController extends crudController<CutterBuild>({
  entity: CutterBuildDto,
  create: CreateCutterBuildDto,
  update: UpdateCutterBuildDto,
  name: 'cutter build',
}) {
  constructor(override readonly service: CutterBuildsService) {
    super();
  }
}

// ---------- CMM checks ----------
@Injectable()
export class CheckCmmsService extends BaseCrudService<CheckCmm> {
  protected override readonly relations = { log: true };
  constructor(@InjectRepository(CheckCmmEntity) repo: Repository<CheckCmm>) {
    super(repo, 'CMM check');
  }
  findByLog(logId: string): Promise<CheckCmm[]> {
    return this.findAll({ log_id: logId });
  }
}

@Controller({ path: 'check-cmm', version: '1' })
@ApiTags('Cutter tracking · CMM checks')
@ApiBearerAuth()
export class CheckCmmsController extends crudController<CheckCmm>({
  entity: CheckCmmDto,
  create: CreateCheckCmmDto,
  update: UpdateCheckCmmDto,
  name: 'CMM check',
}) {
  constructor(override readonly service: CheckCmmsService) {
    super();
  }

  @Get('log/:logId')
  @ApiOperation({ summary: 'CMM checks recorded against a log entry' })
  @ApiOkResponse({ type: CheckCmmDto, isArray: true })
  findByLog(@Param('logId', ParseUUIDPipe) logId: string): Promise<CheckCmm[]> {
    return this.service.findByLog(logId);
  }
}

// ---------- Frequency checks ----------
@Injectable()
export class CheckFrequenciesService extends BaseCrudService<CheckFrequency> {
  protected override readonly relations = { log: true };
  constructor(@InjectRepository(CheckFrequencyEntity) repo: Repository<CheckFrequency>) {
    super(repo, 'Frequency check');
  }
  findByLog(logId: string): Promise<CheckFrequency[]> {
    return this.findAll({ log_id: logId });
  }
}

@Controller({ path: 'check-frequency', version: '1' })
@ApiTags('Cutter tracking · Frequency checks')
@ApiBearerAuth()
export class CheckFrequenciesController extends crudController<CheckFrequency>({
  entity: CheckFrequencyDto,
  create: CreateCheckFrequencyDto,
  update: UpdateCheckFrequencyDto,
  name: 'frequency check',
}) {
  constructor(override readonly service: CheckFrequenciesService) {
    super();
  }

  @Get('log/:logId')
  @ApiOperation({ summary: 'Frequency checks recorded against a log entry' })
  @ApiOkResponse({ type: CheckFrequencyDto, isArray: true })
  findByLog(@Param('logId', ParseUUIDPipe) logId: string): Promise<CheckFrequency[]> {
    return this.service.findByLog(logId);
  }
}

// ---------- Retired cutters ----------
@Injectable()
export class RetiredCuttersService extends BaseCrudService<RetiredCutter> {
  protected override readonly relations = { log: true, pcr: true };
  constructor(@InjectRepository(RetiredCutterEntity) repo: Repository<RetiredCutter>) {
    super(repo, 'Retired cutter');
  }
}

@Controller({ path: 'retired-cutter', version: '1' })
@ApiTags('Cutter tracking · Retired cutters')
@ApiBearerAuth()
export class RetiredCuttersController extends crudController<RetiredCutter>({
  entity: RetiredCutterDto,
  create: CreateRetiredCutterDto,
  update: UpdateRetiredCutterDto,
  name: 'retired cutter',
}) {
  constructor(override readonly service: RetiredCuttersService) {
    super();
  }
}
