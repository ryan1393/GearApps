import { ConflictException } from '@nestjs/common';
import {
  CutterMachineRunOrmEntity,
  MachineOrmEntity,
  TrayOrmEntity,
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
  function setup(running: boolean, grinding = false) {
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
            : entity === TrayOrmEntity ? { count: jest.fn().mockResolvedValue(grinding ? 1 : 0) } : {},
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

  it('protects a grinder with an active tray pass', async () => {
    const { service, repo } = setup(false, true);
    await expect(service.disableMachine('machine', 'admin')).rejects.toThrow('Complete the active grinding pass');
    expect(repo.save).not.toHaveBeenCalled();
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

describe('AdminMasterDataService duplicate models', () => {
  function setup(existing: Array<{ id: string; model_number: number | null; model_type: string | null }>) {
    const saved: unknown[] = [];
    const repo = {
      find: jest.fn(async ({ where }: { where: { model_number: unknown } }) =>
        existing.filter((model) => (typeof where.model_number === 'number' ? model.model_number === where.model_number : model.model_number === null))),
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => existing.find((model) => model.id === where.id) ?? null),
      create: (value: unknown) => value,
      save: jest.fn(async (value: unknown) => { saved.push(value); return value; }),
    };
    const dataSource = { getRepository: () => repo } as unknown as DataSource;
    return { service: new AdminMasterDataService(dataSource), saved };
  }
  const user = 'user-id' as never;

  it('treats the same number and type as one model whatever the case or spacing', async () => {
    const { service, saved } = setup([{ id: 'a', model_number: 174, model_type: '2G' }, { id: 'b', model_number: 999, model_type: null }]);
    await expect(service.createModel({ model_number: 174, model_type: ' 2g ' } as never, user)).rejects.toThrow(ConflictException);
    await expect(service.createModel({ model_number: 999 } as never, user)).rejects.toThrow('Model 999 already exists');
    expect(saved).toHaveLength(0);
    await service.createModel({ model_number: 174, model_type: '3G' } as never, user);
    expect(saved).toHaveLength(1);
  });

  it('does not let an edit turn one model into a copy of another', async () => {
    const { service, saved } = setup([{ id: 'a', model_number: 174, model_type: '2G' }, { id: 'b', model_number: 174, model_type: '3G' }]);
    await expect(service.updateModel('b' as never, { model_type: '2g' } as never, user)).rejects.toThrow(ConflictException);
    await service.updateModel('b' as never, { model_type: '3G' } as never, user); // unchanged is not a duplicate of itself
    expect(saved).toHaveLength(1);
  });
});

