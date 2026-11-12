import { randomUUID } from 'node:crypto';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntitySchema, Repository } from 'typeorm';

import { DepartmentOrmEntity, UserOrmEntity } from '@meshforge/manufacturing/server/data-access';
import { ServerUtilMailerService } from '@meshforge/manufacturing/server/util-mailer';
import { RoleType } from '@meshforge/manufacturing/shared/util-types';

import { ServerFeatUserService } from './server-feat-user.service';

// Minimal SQLite schemas over the production entity classes; no external database.
const userSchema = new EntitySchema<UserOrmEntity>({
  name: UserOrmEntity.name,
  target: UserOrmEntity,
  tableName: 'users',
  columns: {
    id: { type: String, primary: true },
    email: { type: String, nullable: true },
    departmentId: { type: String, nullable: true },
    active: { type: Boolean, default: true },
    role: { type: String, default: 'user' },
    authVersion: { type: Number, default: 0 },
  },
});
const departmentSchema = new EntitySchema<DepartmentOrmEntity>({
  name: DepartmentOrmEntity.name,
  target: DepartmentOrmEntity,
  tableName: 'departments',
  columns: {
    id: { type: String, primary: true },
    code: { type: String },
    description: { type: String },
    enabled: { type: Boolean, default: true },
  },
});

describe('administrator safeguards', () => {
  let db: DataSource;
  let repo: Repository<UserOrmEntity>;
  let departments: Repository<DepartmentOrmEntity>;
  let users: ServerFeatUserService;
  let first: UserOrmEntity;
  let second: UserOrmEntity;
  let operator: UserOrmEntity;

  const save = (role: RoleType, email: string) =>
    repo.save(repo.create({ id: randomUUID(), email, role, active: true, authVersion: 0 }));

  beforeEach(async () => {
    db = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [userSchema, departmentSchema],
      synchronize: true,
      logging: false,
    });
    await db.initialize();
    repo = db.getRepository(UserOrmEntity);
    departments = db.getRepository(DepartmentOrmEntity);
    users = new ServerFeatUserService(
      repo,
      departments,
      { sendMail: jest.fn() } as unknown as ServerUtilMailerService,
      new ConfigService(),
    );
    first = await save(RoleType.ADMIN, 'first@example.test');
    second = await save(RoleType.ADMIN, 'second@example.test');
    operator = await save(RoleType.USER, 'operator@example.test');
  });
  afterEach(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('refuses deleting your own account', async () => {
    await expect(users.deleteUser(first.id, first.id)).rejects.toThrow(
      'You cannot delete your own account. Ask another administrator.',
    );
    await expect(users.deleteUser(operator.id, operator.id)).rejects.toBeInstanceOf(ConflictException);
    expect(await repo.count()).toBe(3);
  });

  it('refuses deleting the last active administrator', async () => {
    await users.deleteUser(first.id, operator.id);
    await users.updateUserAsAdmin(second.id, first.id, { active: false });
    await expect(users.deleteUser(first.id, second.id)).rejects.toThrow('last active administrator');
    expect(await repo.findOneBy({ id: second.id })).not.toBeNull();
  });

  it('deletes another administrator while one remains', async () => {
    await users.deleteUser(first.id, second.id);
    expect(await repo.findOneBy({ id: second.id })).toBeNull();
  });

  it('refuses demoting or disabling yourself and the last administrator', async () => {
    await expect(users.updateUserAsAdmin(first.id, first.id, { role: RoleType.USER })).rejects.toThrow(
      'your own administrator account',
    );
    await users.updateUserAsAdmin(first.id, second.id, { role: RoleType.USER });
    expect((await repo.findOneByOrFail({ id: second.id })).role).toBe(RoleType.USER);
    await expect(users.updateUserAsAdmin(second.id, first.id, { active: false })).rejects.toThrow(
      'last active administrator',
    );
  });

  it('leaves one administrator when two demote each other', async () => {
    await users.updateUserAsAdmin(first.id, second.id, { role: RoleType.USER });
    await expect(users.updateUserAsAdmin(second.id, first.id, { role: RoleType.USER })).rejects.toThrow(
      'last active administrator',
    );
    expect(await repo.countBy({ role: RoleType.ADMIN, active: true })).toBe(1);
  });

  // Concurrent requests are serialized by these row locks: the second transaction waits, then
  // re-reads the administrators and sees only one left.
  it('locks the active administrators on PostgreSQL', async () => {
    const setLock = jest.fn();
    const builder = {
      select: () => builder,
      where: () => builder,
      orderBy: () => builder,
      setLock: (mode: string) => (setLock(mode), builder),
      getRawMany: async () => [{ id: first.id }, { id: second.id }],
    };
    const manager = {
      connection: { options: { type: 'postgres' } },
      getRepository: () => ({
        createQueryBuilder: () => builder,
        findOne: async () => second,
        remove: jest.fn(),
      }),
    };
    Object.defineProperty(repo, 'manager', {
      value: { transaction: (work: (m: unknown) => Promise<unknown>) => work(manager) },
    });
    await users.deleteUser(first.id, second.id);
    expect(setLock).toHaveBeenCalledWith('pessimistic_write');
  });

  it('accepts only an enabled department on update', async () => {
    const enabled = await departments.save(
      departments.create({ id: randomUUID(), code: '45', description: 'Cutter Grind', enabled: true }),
    );
    const disabled = await departments.save(
      departments.create({ id: randomUUID(), code: '99', description: 'Closed', enabled: false }),
    );
    await expect(
      users.updateUserAsAdmin(first.id, operator.id, { departmentId: disabled.id }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      users.updateUserAsAdmin(first.id, operator.id, { departmentId: randomUUID() }),
    ).rejects.toThrow('User department was not found or is disabled');
    await users.updateUserAsAdmin(first.id, operator.id, { departmentId: enabled.id });
    expect((await repo.findOneByOrFail({ id: operator.id })).departmentId).toBe(enabled.id);
  });
});
