import { ConflictException } from '@nestjs/common';
import {
  CutterMachineRunOrmEntity,
  MachineOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import { DataSource } from 'typeorm';
import { AdminMasterDataService } from './admin-master-data.service';

describe('AdminMasterDataService running-machine protection', () => {
  const machine = {
    id: 'machine',
    machine_number: 'M1',
    department_id: '48',
    machine_type: 'PRODUCTION',
    enabled: true,
    active: true,
  };
  function setup(running: boolean) {
    const repo = {
      findOne: jest.fn().mockResolvedValue({ ...machine }),
      findOneOrFail: jest.fn().mockResolvedValue(machine),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const runs = { count: jest.fn().mockResolvedValue(running ? 1 : 0) };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === MachineOrmEntity
          ? repo
          : entity === CutterMachineRunOrmEntity
            ? runs
            : {},
    };
    const dataSource = {
      transaction: (fn: (m: unknown) => unknown) => fn(manager),
    } as unknown as DataSource;
    return { service: new AdminMasterDataService(dataSource), repo, runs };
  }

  it.each([
    { enabled: false },
    { active: false },
    { machine_number: 'M2' },
    { department_id: '45' },
    { machine_type: 'CUTTER_BUILDER' as const },
  ])('rejects a live machine configuration change: %j', async (change) => {
    const { service, repo } = setup(true);
    await expect(
      service.updateMachine('machine', change, 'admin'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 'machine' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('allows editing descriptive information during a run', async () => {
    const { service, repo, runs } = setup(true);
    await service.updateMachine(
      'machine',
      { description: 'Updated description', cell: 5 },
      'admin',
    );
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Updated description', cell: 5 }),
    );
    expect(runs.count).not.toHaveBeenCalled();
  });

  it('allows disabling an idle machine', async () => {
    const { service, repo } = setup(false);
    await service.disableMachine('machine', 'admin');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        active: false,
        updatedBy: 'admin',
      }),
    );
  });
});
