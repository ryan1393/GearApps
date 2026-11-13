import { BadRequestException } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { ROLES_REQUEST_KEY, SKIP_AUTH_KEY } from '@meshforge/manufacturing/server/util-common';
import { RoleType } from '@meshforge/manufacturing/shared/util-types';
import { DsfHistoryController, parseDsfHistoryReportQuery, parseDsfHistorySourcesQuery } from './dsf-history.controller';
import type { DsfHistoryService } from './dsf-history.service';

const base = { from: '2026-11-01', to: '2026-11-12' };

describe('DSF history HTTP query validation', () => {
  it('uses bounded civil dates and explicit defaults without assuming 24-hour local days', () => {
    expect(parseDsfHistoryReportQuery(base)).toEqual({ ...base, group: 'day', include_inactive: false });
    // These ranges contain the Indianapolis spring/fall transitions; their civil date range is valid.
    expect(parseDsfHistoryReportQuery({ from: '2026-03-08', to: '2026-03-08', group: 'hour' }).group).toBe('hour');
    expect(parseDsfHistoryReportQuery({ from: '2026-11-01', to: '2026-11-01', group: 'shift' }).group).toBe('shift');
    expect(parseDsfHistoryReportQuery({ from: '2024-02-29', to: '2024-02-29' }).from).toBe('2024-02-29');
    expect(parseDsfHistoryReportQuery({ from: '2026-01-01', to: '2026-01-31' }).to).toBe('2026-01-31');
  });

  it.each([
    {},
    { ...base, from: '2026-02-30' },
    { ...base, from: '2023-02-29' },
    { ...base, from: '0000-01-01' },
    { ...base, from: '2026-11-13' },
    { from: '2026-01-01', to: '2026-02-01' },
    { ...base, from: ['2026-11-01', '2026-11-02'] },
    { ...base, from: '2026-11-01T00:00:00Z' },
    { ...base, group: 'year' },
    { ...base, source_key: "'; DROP TABLE counts; --" },
    { ...base, source_key: '' },
    { ...base, department_id: 'Dept. 181' },
    { ...base, department_id: ['00000000-0000-4000-8000-000000000001'] },
    { ...base, include_inactive: 'yes' },
    { ...base, include_inactive: ['true', 'false'] },
    { ...base, sql: 'SELECT 1' },
  ])('rejects malformed or unbounded report input %#', query => {
    expect(() => parseDsfHistoryReportQuery(query)).toThrow(BadRequestException);
  });

  it('normalizes known identifiers and preserves explicit inactive selection', () => {
    expect(parseDsfHistoryReportQuery({
      ...base,
      source_key: 'AB'.repeat(32),
      department_id: 'ABCDEF01-2345-6789-ABCD-123456789ABC',
      include_inactive: 'true',
    })).toMatchObject({
      source_key: 'ab'.repeat(32),
      department_id: 'abcdef01-2345-6789-abcd-123456789abc',
      include_inactive: true,
    });
  });

  it('validates the source catalog filter independently', () => {
    expect(parseDsfHistorySourcesQuery({})).toBe(false);
    expect(parseDsfHistorySourcesQuery({ include_inactive: 'true' })).toBe(true);
    expect(parseDsfHistorySourcesQuery({ include_inactive: 'false' })).toBe(false);
    expect(() => parseDsfHistorySourcesQuery({ include_inactive: '1' })).toThrow(BadRequestException);
    expect(() => parseDsfHistorySourcesQuery({ from: '2026-11-01' })).toThrow(BadRequestException);
  });

  it('validates before calling the local store service', () => {
    const history = { status: jest.fn(), sources: jest.fn(), report: jest.fn() };
    const controller = new DsfHistoryController(history as unknown as DsfHistoryService);
    controller.getStatus();
    controller.getSources({ include_inactive: 'true' });
    controller.getReport(base);
    expect(history.status).toHaveBeenCalledTimes(1);
    expect(history.sources).toHaveBeenCalledWith(true);
    expect(history.report).toHaveBeenCalledWith({ ...base, group: 'day', include_inactive: false });
    expect(() => controller.getReport({ ...base, from: 'bad' })).toThrow(BadRequestException);
    expect(history.report).toHaveBeenCalledTimes(1);
  });

  it('protects all history reads with the existing roles and disables response caching', () => {
    for (const method of ['getStatus', 'getSources', 'getReport'] as const) {
      const handler = DsfHistoryController.prototype[method];
      expect(Reflect.getMetadata(ROLES_REQUEST_KEY, handler)).toEqual([RoleType.ADMIN, RoleType.USER]);
      expect(Reflect.getMetadata(SKIP_AUTH_KEY, handler)).not.toBe(true);
      expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    }
  });
});
