import { ConflictException } from '@nestjs/common';
import {
  BladeHistoryOrmEntity,
  BladeOrmEntity,
  BladeTrayOrmEntity,
  ContainerTrayOrmEntity,
  CutterBuildBladeOrmEntity,
  CutterBuildTrayOrmEntity,
  TrayOrmEntity,
  TrayStageOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import { BladeHistoryEvent, BladeStatus } from '@meshforge/manufacturing/shared/util-types';

import { ServerFeatBladeTrayService } from './server-feat-blade-tray.service';

const commit = jest.fn();
jest.mock('@meshforge/manufacturing/server/data-access', () => ({
  ...jest.requireActual('@meshforge/manufacturing/server/data-access'),
  beginWorkflowJournal: jest.fn(async () => ({ commit })),
}));

const STAGES: Record<string, { id: string; code: string; name: string }> = Object.fromEntries(
  ['EMPTY', 'WAITING_FOR_GRINDING', 'GRINDING', 'READY_FOR_COATING', 'READY_FOR_CUTTER', 'PACKED_FOR_COATER', 'AT_COATER']
    .map((code) => [code, { id: `stage-${code}`, code, name: code.replace(/_/g, ' ').toLowerCase() }]),
);

interface Options {
  stage?: string;
  activeBlades?: number;
  container?: number;
  trayBuild?: number;
  bladeBuild?: number;
}

function setup({ stage = 'WAITING_FOR_GRINDING', activeBlades = 2, container = 0, trayBuild = 0, bladeBuild = 0 }: Options = {}) {
  const tray = { id: 'tray', serial_number: 'T0001', blade_count: activeBlades, current_stage_id: STAGES[stage].id, summary_id: 'summary' };
  const assignment = { id: 'assignment', tray_id: 'tray', blade_id: 'blade', enabled: true };
  const blade = { id: 'blade', status: BladeStatus.WAITING_FOR_GRINDING, service_cycle: 3 };
  let remaining = activeBlades;
  const saved: Record<string, unknown[]> = { assignment: [], history: [], tray: [] };
  const repos = new Map<unknown, object>([
    [BladeTrayOrmEntity, {
      findOne: jest.fn(async () => ({ ...assignment })),
      save: jest.fn(async (row: { enabled: boolean }) => { saved['assignment'].push(row); if (!row.enabled) remaining--; return row; }),
      count: jest.fn(async () => remaining),
    }],
    [TrayOrmEntity, { findOne: jest.fn(async () => ({ ...tray })), save: jest.fn(async (row: unknown) => { saved['tray'].push(row); return row; }) }],
    [BladeOrmEntity, { findOne: jest.fn(async () => ({ ...blade })) }],
    [ContainerTrayOrmEntity, { count: jest.fn(async () => container) }],
    [CutterBuildTrayOrmEntity, { count: jest.fn(async () => trayBuild) }],
    [CutterBuildBladeOrmEntity, { count: jest.fn(async () => bladeBuild) }],
    [TrayStageOrmEntity, { findOne: jest.fn(async ({ where }: { where: { id?: string; code?: string } }) =>
      Object.values(STAGES).find((row) => row.id === where.id || row.code === where.code) ?? null) }],
    [BladeHistoryOrmEntity, {
      create: (row: unknown) => row,
      save: jest.fn(async (row: unknown) => { saved['history'].push(row); return row; }),
    }],
  ]);
  const manager = {
    getRepository: (entity: unknown) => repos.get(entity) ?? { update: jest.fn() },
  };
  const service = new ServerFeatBladeTrayService({
    manager: { transaction: (work: (m: unknown) => unknown) => work(manager) },
  } as never);
  return { service, saved };
}

describe('administrator blade removal from a tray', () => {
  beforeEach(() => commit.mockReset());

  it.each(['WAITING_FOR_GRINDING', 'READY_FOR_COATING'])('takes a blade out of a %s tray with history', async (stage) => {
    const { service, saved } = setup({ stage });
    await service.deleteBladeTray('assignment', 'admin');
    expect(saved['assignment']).toEqual([expect.objectContaining({ enabled: false, updatedBy: 'admin' })]);
    expect(saved['history']).toEqual([expect.objectContaining({
      blade_id: 'blade', event_type: BladeHistoryEvent.REMOVED_FROM_TRAY, tray_id: 'tray', service_cycle: 3,
    })]);
    expect(saved['tray']).toEqual([expect.objectContaining({ blade_count: 1, current_stage_id: `stage-${stage}` })]);
    expect(commit).toHaveBeenCalled();
  });

  it('resets a tray left empty', async () => {
    const { service, saved } = setup({ activeBlades: 1 });
    await service.deleteBladeTray('assignment', 'admin');
    expect(saved['tray']).toEqual([expect.objectContaining({ blade_count: 0, current_stage_id: 'stage-EMPTY', summary_id: null })]);
  });

  it.each(['GRINDING', 'READY_FOR_CUTTER', 'PACKED_FOR_COATER', 'AT_COATER'])('refuses a tray in %s', async (stage) => {
    const { service, saved } = setup({ stage });
    await expect(service.deleteBladeTray('assignment', 'admin')).rejects.toBeInstanceOf(ConflictException);
    expect(saved['assignment']).toEqual([]);
    expect(saved['history']).toEqual([]);
  });

  it.each([
    [{ container: 1 }, 'Coater container'],
    [{ trayBuild: 1 }, 'cutter build'],
    [{ bladeBuild: 1 }, 'cutter build'],
  ])('refuses a blade or tray in use: %j', async (options, message) => {
    const { service, saved } = setup(options);
    await expect(service.deleteBladeTray('assignment', 'admin')).rejects.toThrow(message);
    expect(saved['assignment']).toEqual([]);
  });
});
