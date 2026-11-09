import { DataSource } from 'typeorm';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import {
  BladeHistoryOrmEntity, BladeOrmEntity, BladeTrayOrmEntity, ContainerOrmEntity,
  CutterBuildBladeOrmEntity, CutterBuildOrmEntity,
  CutterBodyOrmEntity, CutterBladeRequirementOrmEntity,
  CutterPartTypeOrmEntity, CutterMachineRunOrmEntity, LocationOrmEntity,
  MachineOrmEntity, PartSummaryOrmEntity, TrayOrmEntity,
} from '@gearapps/manufacturing/server/data-access';
import { BladeStatus } from '@gearapps/manufacturing/shared/util-types';
import { ServerFeatBladeTrayService } from '@gearapps/manufacturing/server/feat-blade-tray';
import { ServerFeatTrayService } from '@gearapps/manufacturing/server/feat-tray';
import { ServerFeatContainerService } from '@gearapps/manufacturing/server/feat-container';
import { ServerFeatLocationService } from '@gearapps/manufacturing/server/feat-location';
import { ServerFeatCutterBuildService } from '@gearapps/manufacturing/server/feat-cutter-build';
import { ServerFeatGreenshedService } from '@gearapps/manufacturing/server/feat-greenshed';
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

  it('allows an unassigned blade status change and records the prior status', async () => {
    const blade = repository({ id: 'blade', status: BladeStatus.NEW, service_cycle: 0 });
    const history = repository();
    environment([[BladeOrmEntity, blade], [BladeHistoryOrmEntity, history]]);
    const service = new ServerFeatBladeService(blade as never, history as never);
    await service.updateBlade('blade', { status: BladeStatus.SCRAPPED }, 'operator');
    expect(history.save).toHaveBeenCalledWith(expect.objectContaining({ from_status: BladeStatus.NEW, to_status: BladeStatus.SCRAPPED }));
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
    { serial: 'BODY064A', count: 19, family: 'RING', part: 'RING' },
    { serial: 'BODY076A', count: 13, family: 'PINION', part: 'RING' },
  ])('rejects incompatible body/tray capacity or family before saving: %j', async ({ serial, count, family, part }) => {
    const body = repository();
    const query = { leftJoinAndSelect: jest.fn().mockReturnThis(), setLock: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([{ id: 'body', mf_serial_number: serial, definition: { blade_family_name: family } }]) };
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
    await expect(new ServerFeatCutterBuildService(source).createBuild({ cutter_body_identifier: serial, tray_serial_number: 'T1', cutter_builder_machine_id: 'machine' }, 'operator')).rejects.toThrow('capacity or blade family');
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
