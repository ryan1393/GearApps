import { DataSource } from 'typeorm';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import {
  BladeHistoryOrmEntity, BladeOrmEntity, BladeTrayOrmEntity, ContainerOrmEntity,
  CutterBuildBladeOrmEntity, CutterBuildOrmEntity,
  CutterBodyOrmEntity, CutterBladeRequirementOrmEntity,
  CutterPartTypeOrmEntity, CutterMachineRunOrmEntity, LocationOrmEntity,
  MachineOrmEntity, PartSummaryOrmEntity, TrayOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import { BladeStatus } from '@meshforge/manufacturing/shared/util-types';
import { ServerFeatBladeTrayService } from '@meshforge/manufacturing/server/feat-blade-tray';
import { ServerFeatTrayService } from '@meshforge/manufacturing/server/feat-tray';
import { ServerFeatContainerService } from '@meshforge/manufacturing/server/feat-container';
import { ServerFeatLocationService } from '@meshforge/manufacturing/server/feat-location';
import { ServerFeatCutterBuildService } from '@meshforge/manufacturing/server/feat-cutter-build';
import { ServerFeatGreenshedService } from '@meshforge/manufacturing/server/feat-greenshed';
import { ServerFeatBladeService } from './server-feat-blade.service';

function repository(value: object | null = null) {
  return {
    findOne: jest.fn().mockResolvedValue(value),
    findOneOrFail: jest.fn().mockResolvedValue(value),
    count: jest.fn().mockResolvedValue(0),
    save: jest.fn().mockImplementation(async (row) => row),
    softRemove: jest.fn(),
    create: jest.fn().mockImplementation((row) => row),
  };
}
function environment(entries: Array<[unknown, ReturnType<typeof repository>]>) {
  const fallback = repository();
  const byType = new Map(entries);
  const manager = {
    getRepository: (entity: unknown) => byType.get(entity) ?? fallback,
    query: jest.fn().mockResolvedValue([]),
  };
  const transaction = jest.fn().mockImplementation(async (...args) => args[args.length - 1](manager));
  for (const repo of byType.values()) Object.assign(repo, { manager: { ...manager, transaction } });
  return { manager, source: { transaction } as unknown as DataSource };
}

describe('Manufacturing inventory integrity', () => {
  it('rejects generic assignment PATCH without modifying a repository', async () => {
    const repo = repository();
    const service = new ServerFeatBladeTrayService(repo as never);
    await expect(service.updateBladeTray('assignment', { enabled: false }, 'operator')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it.each(['edit', 'delete'])('rejects %s of a blade assigned to a tray', async (operation) => {
    const blade = repository({ id: 'blade', status: BladeStatus.NEW });
    const assignment = repository(); assignment.count.mockResolvedValue(1);
    environment([[BladeOrmEntity, blade], [BladeTrayOrmEntity, assignment]]);
    const service = new ServerFeatBladeService(blade as never, repository() as never);
    const result = operation === 'edit' ? service.updateBlade('blade', { status: BladeStatus.SCRAPPED }, 'operator') : service.deleteBlade('blade', 'operator');
    await expect(result).rejects.toBeInstanceOf(ConflictException);
    expect(blade.save).not.toHaveBeenCalled();
    expect(blade.softRemove).not.toHaveBeenCalled();
  });

  it('rejects deleting an installed blade even without an active tray assignment', async () => {
    const blade = repository({ id: 'blade', status: BladeStatus.NEW });
    const build = repository(); build.count.mockResolvedValue(1);
    environment([[BladeOrmEntity, blade], [CutterBuildBladeOrmEntity, build]]);
    const service = new ServerFeatBladeService(blade as never, repository() as never);
    await expect(service.deleteBlade('blade', 'operator')).rejects.toBeInstanceOf(ConflictException);
    expect(blade.softRemove).not.toHaveBeenCalled();
  });

  it.each([
    [BladeStatus.NEW, BladeStatus.SCRAPPED],
    [BladeStatus.SCRAPPED, BladeStatus.AVAILABLE],
    [BladeStatus.NEW, BladeStatus.READY_FOR_COATING],
  ])('never changes a blade status through the generic edit: %s to %s', async (from, to) => {
    const blade = repository({ id: 'blade', status: from, service_cycle: 0 });
    const history = repository();
    environment([[BladeOrmEntity, blade], [BladeHistoryOrmEntity, history]]);
    const service = new ServerFeatBladeService(blade as never, history as never);
    await expect(service.updateBlade('blade', { status: to }, 'admin')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(blade.save).not.toHaveBeenCalled();
    expect(history.save).not.toHaveBeenCalled();
  });

  it('edits other fields of a loose blade and keeps its status', async () => {
    const blade = repository({ id: 'blade', status: BladeStatus.NEW, service_cycle: 0 });
    environment([[BladeOrmEntity, blade]]);
    const service = new ServerFeatBladeService(blade as never, repository() as never);
    await service.updateBlade('blade', { service_cycle: 1, status: BladeStatus.NEW }, 'admin');
    expect(blade.save).toHaveBeenCalledWith(expect.objectContaining({ service_cycle: 1, status: BladeStatus.NEW, updatedBy: 'admin' }));
  });

  it('rejects editing a blade packed in a coater set', async () => {
    const blade = repository({ id: 'blade', status: BladeStatus.READY_FOR_COATING });
    const { manager } = environment([[BladeOrmEntity, blade]]);
    manager.query.mockResolvedValue([{ id: 'set-blade' }]);
    const service = new ServerFeatBladeService(blade as never, repository() as never);
    await expect(service.updateBlade('blade', { service_cycle: 2 }, 'admin')).rejects.toBeInstanceOf(ConflictException);
    expect(blade.save).not.toHaveBeenCalled();
  });

  it.each([{ enabled: false }, { serial_number: 'T0002' }])('rejects an occupied tray mutation: %j', async (data) => {
    const tray = repository({ id: 'tray', serial_number: 'T0001', blade_count: 1, enabled: true });
    environment([[TrayOrmEntity, tray]]);
    const service = new ServerFeatTrayService(tray as never, repository() as never, repository() as never, repository() as never, repository() as never);
    await expect(service.updateTray('tray', data, 'operator')).rejects.toBeInstanceOf(ConflictException);
    expect(tray.save).not.toHaveBeenCalled();
  });

  it('rejects disabling a container reserved by a shipment even when empty', async () => {
    const container = repository({ id: 'container', serial_number: 'C0001', enabled: true });
    const { manager } = environment([[ContainerOrmEntity, container]]);
    manager.query.mockResolvedValue([{ id: 'reservation' }]);
    const service = new ServerFeatContainerService(container as never);
    await expect(service.deleteContainer('container', 'operator')).rejects.toBeInstanceOf(ConflictException);
    expect(container.save).not.toHaveBeenCalled();
  });

  it('allows disabling an empty unreserved container', async () => {
    const container = repository({ id: 'container', serial_number: 'C0001', enabled: true });
    environment([[ContainerOrmEntity, container]]);
    await new ServerFeatContainerService(container as never).deleteContainer('container', 'operator');
    expect(container.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, updatedBy: 'operator' }));
  });

  it('rejects disabling a shelf containing an empty cutter body', async () => {
    const location = repository({ id: 'location', serial_number: 'INTERNAL-1', number: '1', department: null, location_type: 'INTERNAL', enabled: true });
    const { manager } = environment([[LocationOrmEntity, location]]);
    manager.query.mockResolvedValue([{ id: 'body-placement' }]);
    await expect(new ServerFeatLocationService(location as never, repository() as never).deleteLocation('location', 'operator')).rejects.toBeInstanceOf(ConflictException);
    expect(location.save).not.toHaveBeenCalled();
  });

  it('allows retiring an empty legacy shelf without revalidating its obsolete routing', async () => {
    const location = repository({ id: 'location', serial_number: 'CGDR-OLD-SUMMARY', number: 'OLD-SUMMARY', department: 'CUTTERGRIND', location_type: 'SHELF', enabled: true });
    environment([[LocationOrmEntity, location]]);
    await new ServerFeatLocationService(location as never, repository() as never).deleteLocation('location', 'operator');
    expect(location.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it.each([
    // Capacity comes only from the Dana S/N; an MF-only body is unresolved even if its MF serial looks like one.
    { serial: 'CGRT064AAA', dana: 'CGRT064AAA', count: 19, family: 'RING', part: 'RING', reason: '064 Standard' },
    { serial: 'CGRT076AAA', dana: 'CGRT076AAA', count: 13, family: 'PINION', part: 'RING', reason: 'blade family PINION' },
    { serial: 'CGRT1058AA', dana: 'CGRT1058AA', count: 19, family: 'RING', part: 'RING', reason: '105 Special' },
    { serial: 'CGRT105AAA', dana: null, count: 19, family: 'RING', part: 'RING', reason: 'No Dana S/N' },
  ])('rejects incompatible body/tray capacity or family before saving: %j', async ({ serial, dana, count, family, part, reason }) => {
    const body = repository();
    const query = { leftJoinAndSelect: jest.fn().mockReturnThis(), setLock: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([{ id: 'body', dana_serial_number: dana, mf_serial_number: dana ? 'MF-1' : serial, definition: { blade_family_name: family } }]) };
    Object.assign(body, { createQueryBuilder: () => query });
    const build = repository();
    const { source } = environment([
      [CutterBodyOrmEntity, body], [CutterBuildOrmEntity, build],
      [MachineOrmEntity, repository({ id: 'machine', department: { code: '45', active: true, enabled: true } })],
      [TrayOrmEntity, repository({ id: 'tray', summary_id: 'summary', part_type_id: 'part-type' })],
      [PartSummaryOrmEntity, repository({ id: 'summary' })],
      [CutterPartTypeOrmEntity, repository({ id: 'part-type', code: part })],
      [CutterBladeRequirementOrmEntity, repository({ required_blade_count: count })],
    ]);
    await expect(new ServerFeatCutterBuildService(source).createBuild({ cutter_body_identifier: serial, tray_serial_number: 'T1', cutter_builder_machine_id: 'machine' }, 'operator')).rejects.toThrow(reason);
    expect(build.save).not.toHaveBeenCalled();
    expect(query.setLock).toHaveBeenCalledWith('pessimistic_write', undefined, ['body']);
  });

  it('rejects a pull submitted for an obsolete machine/run context', async () => {
    const build = repository({ id: 'build', status: { code: 'RUNNING' } });
    const run = repository({ id: 'new-run', machine_number: 'M1' });
    const { source } = environment([[CutterBuildOrmEntity, build], [CutterMachineRunOrmEntity, run]]);
    await expect(new ServerFeatGreenshedService(source).pullCutter({ build_number: 'BUILD', reason_code: 'DULL', expected_machine_number: 'M2', expected_machine_run_id: 'old-run' }, 'operator')).rejects.toThrow('machine run changed');
  });
});
