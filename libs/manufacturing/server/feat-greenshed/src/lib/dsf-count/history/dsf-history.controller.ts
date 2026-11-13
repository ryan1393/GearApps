import { Auth } from '@meshforge/manufacturing/server/util-common';
import { RoleType } from '@meshforge/manufacturing/shared/util-types';
import { BadRequestException, Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { HistoryReportQuery } from './dsf-history-model';
import { DsfHistoryService } from './dsf-history.service';

const REPORT_KEYS = new Set(['from', 'to', 'group', 'source_key', 'department_id', 'include_inactive']);
const SOURCE_KEYS = new Set(['include_inactive']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateKeys(query: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): void {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new BadRequestException('History query parameters must be a flat object.');
  }
  if (Object.keys(query).some(key => !allowed.has(key))) {
    throw new BadRequestException('Unsupported history query parameter.');
  }
}

function calendarDate(value: unknown, key: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) {
    throw new BadRequestException(`${key} must be a calendar date in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${key} must be a valid calendar date.`);
  }
  return value;
}

function inactiveFlag(value: unknown): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new BadRequestException('include_inactive must be true or false.');
}

/** Validate civil dates here; the store resolves Indianapolis midnight/DST in PostgreSQL. */
export function parseDsfHistoryReportQuery(query: Readonly<Record<string, unknown>>): HistoryReportQuery {
  validateKeys(query, REPORT_KEYS);
  const from = calendarDate(query['from'], 'from');
  const to = calendarDate(query['to'], 'to');
  const calendarDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (calendarDays < 1 || calendarDays > 31) {
    throw new BadRequestException('Choose an ordered date range of at most 31 calendar days.');
  }
  const group = query['group'] === undefined ? 'day' : query['group'];
  if (group !== 'day' && group !== 'hour' && group !== 'shift') {
    throw new BadRequestException('group must be day, hour or shift.');
  }
  const sourceKey = query['source_key'];
  if (sourceKey !== undefined && (typeof sourceKey !== 'string' || !/^[0-9a-f]{64}$/i.test(sourceKey))) {
    throw new BadRequestException('source_key must be a history source identifier.');
  }
  const departmentId = query['department_id'];
  if (departmentId !== undefined && (typeof departmentId !== 'string' || !UUID.test(departmentId))) {
    throw new BadRequestException('department_id must be a UUID.');
  }
  return {
    from,
    to,
    group,
    ...(sourceKey !== undefined ? { source_key: sourceKey.toLowerCase() } : {}),
    ...(departmentId !== undefined ? { department_id: departmentId.toLowerCase() } : {}),
    include_inactive: inactiveFlag(query['include_inactive']),
  };
}

export function parseDsfHistorySourcesQuery(query: Readonly<Record<string, unknown>>): boolean {
  validateKeys(query, SOURCE_KEYS);
  return inactiveFlag(query['include_inactive']);
}

@Controller({ path: 'dsf-counts/history', version: '1' })
@ApiTags('Plant count history')
export class DsfHistoryController {
  constructor(private readonly history: DsfHistoryService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getStatus() {
    return this.history.status();
  }

  @Get('sources')
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getSources(@Query() query: Record<string, unknown>) {
    return this.history.sources(parseDsfHistorySourcesQuery(query));
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getReport(@Query() query: Record<string, unknown>) {
    return this.history.report(parseDsfHistoryReportQuery(query));
  }
}
