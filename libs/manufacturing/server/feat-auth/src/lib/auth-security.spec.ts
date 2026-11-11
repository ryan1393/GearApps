import { createHash, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { instanceToPlain } from 'class-transformer';
import { DataSource, EntitySchema, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  DepartmentOrmEntity,
  UserOrmEntity,
  UserOrmEntitySubscriber,
} from '@meshforge/manufacturing/server/data-access';
import { ServerFeatUserService } from '@meshforge/manufacturing/server/feat-user';
import { ServerUtilMailerService } from '@meshforge/manufacturing/server/util-mailer';
import {
  AuthProviderType,
  IJwtPayload,
  RoleType,
} from '@meshforge/manufacturing/shared/util-types';
import { canEditGearApp } from '@meshforge/manufacturing/shared/util-constants';
import { ServerFeatAuthService } from './server-feat-auth.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { GoogleAuthService } from './google-auth/google-auth.service';

// Minimal SQLite schemas use the production entity classes, real repositories,
// and real subscriber. No production bootstrap or external database is started.
const userSchema = new EntitySchema<UserOrmEntity>({
  name: UserOrmEntity.name,
  target: UserOrmEntity,
  tableName: 'users',
  columns: {
    id: { type: String, primary: true },
    email: { type: String, nullable: true },
    departmentId: { type: String, nullable: true },
    active: { type: Boolean, default: true },
    password: { type: String, nullable: true },
    role: { type: String, default: 'user' },
    refreshToken: { type: String, nullable: true },
    authVersion: { type: Number, default: 0 },
    passwordResetTokenHash: { type: String, nullable: true },
    passwordResetExpiresAt: { type: Date, nullable: true },
    socialProvider: { type: String, default: 'email' },
    socialId: { type: String, nullable: true },
    isEmailVerified: { type: Boolean, default: true },
    verificationHash: { type: String, nullable: true },
    firstName: { type: String, nullable: true },
    lastName: { type: String, nullable: true },
    avatar: { type: String, nullable: true },
    emailVerifiedOn: { type: Date, nullable: true },
  },
  relations: {
    department: {
      type: 'many-to-one',
      target: DepartmentOrmEntity.name,
      joinColumn: { name: 'departmentId' },
      nullable: true,
    },
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
    active: { type: Boolean, default: true },
    enabled: { type: Boolean, default: true },
  },
});
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');

describe('authentication security regressions', () => {
  let db: DataSource;
  let repo: Repository<UserOrmEntity>;
  let users: ServerFeatUserService;
  let auth: ServerFeatAuthService;
  let config: ConfigService;
  let jwt: JwtService;
  let subscriber: UserOrmEntitySubscriber;
  const sendMail = jest.fn();
  let user: UserOrmEntity;
  const password = 'Previous-Password1!';
  const settings: Record<string, string> = {
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
    JWT_ACCESS_EXPIRATION_TIME: '3600s',
    JWT_REFRESH_EXPIRATION_TIME: '86400s',
    PUBLIC_WEB_BASE_URL: 'https://gear.example.test/',
    'google.clientId': 'test-google-client-id',
    'google.clientSecret': 'test-google-client-secret',
  };
  const decode = (token: string, refresh = false) =>
    jwt.verify<IJwtPayload & { authVersion: number; tokenUse: string }>(token, {
      secret: settings[refresh ? 'JWT_REFRESH_SECRET' : 'JWT_ACCESS_SECRET'],
    });

  beforeEach(async () => {
    db = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [userSchema, departmentSchema],
      synchronize: true,
      logging: false,
    });
    await db.initialize();
    UserOrmEntity.useDataSource(db);
    DepartmentOrmEntity.useDataSource(db);
    subscriber = new UserOrmEntitySubscriber(db);
    repo = db.getRepository(UserOrmEntity);
    const departments = db.getRepository(DepartmentOrmEntity);
    const department = await departments.save(
      departments.create({
        id: randomUUID(),
        code: '45',
        description: 'Cutter Grind',
        active: true,
        enabled: true,
      }),
    );
    sendMail.mockReset().mockResolvedValue(undefined);
    config = new ConfigService();
    // Do not let ConfigModule's validated defaults override this test fixture.
    jest
      .spyOn(config, 'get')
      .mockImplementation((key) => settings[String(key)]);
    users = new ServerFeatUserService(
      repo,
      departments,
      { sendMail } as unknown as ServerUtilMailerService,
      config,
    );
    jwt = new JwtService();
    auth = new ServerFeatAuthService(jwt, users, config);
    user = await repo.save(
      repo.create({
        id: randomUUID(),
        email: 'operator@example.test',
        password,
        role: RoleType.USER,
        departmentId: department.id,
        active: true,
        authVersion: 0,
        isEmailVerified: true,
        socialProvider: AuthProviderType.EMAIL,
      }),
    );
    user = await users.getUser(user.id);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (db?.isInitialized) await db.destroy();
  });

  it('loads departments from the actual authentication query for operator edits', async () => {
    const identity = await new JwtAccessStrategy(config, users).validate(
      decode((await auth.getTokens(user)).accessToken),
    );
    expect(identity.departmentCode).toBe('45');
    expect(
      canEditGearApp('BLADE_TRACKING', identity.role, identity.departmentCode),
    ).toBe(true);
    expect(
      canEditGearApp('GREENSHED', identity.role, identity.departmentCode),
    ).toBe(false);
  });
  it('matches legacy mixed-case email using an exact bound comparison', async () => {
    await repo.update(user.id, { email: ' Operator@Example.Test ' });
    expect(
      (await auth.validateUser({ email: 'OPERATOR@example.test', password }))
        .id,
    ).toBe(user.id);
    expect(await users.findByEmail('operator%')).toBeNull();
  });
  it('rejects ambiguous preexisting case collisions', async () => {
    await repo.save(
      repo.create({
        id: randomUUID(),
        email: 'Operator@Example.Test',
        password,
        authVersion: 0,
      }),
    );
    await expect(
      users.findByEmail('operator@example.test'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects inactive users at login and on existing access tokens', async () => {
    const tokens = await auth.getTokens(user);
    await repo.update(user.id, { active: false });
    await expect(
      auth.validateUser({ email: user.email!, password }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      new JwtAccessStrategy(config, users).validate(decode(tokens.accessToken)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('hashes all refresh-token bytes, with unique tokens even within one second', async () => {
    const first = await auth.getTokens(user);
    const second = await auth.getTokens(user);
    expect(first.refreshToken).not.toBe(second.refreshToken);
    expect(first.refreshToken.slice(0, 72)).toBe(
      second.refreshToken.slice(0, 72),
    );
    expect((await users.getUser(user.id)).refreshToken).toBe(
      digest(second.refreshToken),
    );
    await expect(
      auth.refreshTokens(user.id, first.refreshToken),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('atomically permits one concurrent rotation and rejects replay', async () => {
    const original = await auth.getTokens(user);
    const results = await Promise.allSettled([
      auth.refreshTokens(user.id, original.refreshToken),
      auth.refreshTokens(user.id, original.refreshToken),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    await expect(
      auth.refreshTokens(user.id, original.refreshToken),
    ).rejects.toThrow();
  });
  it('does not establish a session from credentials changed since login started', async () => {
    await repo.update(user.id, { password: 'Changed-Password2!' });
    await expect(auth.getTokens(user)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it('rejects access/refresh token confusion and legacy sessions', async () => {
    const tokens = await auth.getTokens(user);
    const access = new JwtAccessStrategy(config, users);
    const refresh = new JwtRefreshStrategy(config, users);
    await expect(
      access.validate(decode(tokens.refreshToken, true)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      refresh.validate(
        { get: () => 'Bearer ' + tokens.accessToken } as never,
        decode(tokens.accessToken),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      access.validate({ sub: user.id } as IJwtPayload),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('does not serialize credentials or recovery state', async () => {
    await auth.getTokens(user);
    await users.forgotPassword({ email: user.email! });
    const plain = instanceToPlain(await users.getUser(user.id));
    for (const field of [
      'password',
      'refreshToken',
      'authVersion',
      'passwordResetTokenHash',
      'passwordResetExpiresAt',
      'verificationHash',
    ])
      expect(plain).not.toHaveProperty(field);
  });

  async function requestRecovery(): Promise<string> {
    await users.forgotPassword({ email: user.email! });
    const mail = sendMail.mock.calls.at(-1)?.[0] as {
      context: { passwordResetLink: string };
    };
    const code = new URL(mail.context.passwordResetLink).searchParams.get(
      'code',
    )!;
    expect(mail.context.passwordResetLink).toBe(
      `https://gear.example.test/reset-password?code=${code}`,
    );
    return code;
  }
  it('creates expiring hashed recovery codes separate from email verification', async () => {
    const code = await requestRecovery();
    const pending = await users.getUser(user.id);
    expect(code).toMatch(/^[a-f0-9]{64}$/);
    expect(pending.passwordResetTokenHash).toBe(digest(code));
    expect(pending.passwordResetExpiresAt!.getTime()).toBeGreaterThan(
      Date.now() + 29 * 60_000,
    );
    expect(pending.passwordResetExpiresAt!.getTime()).toBeLessThanOrEqual(
      Date.now() + 30 * 60_000,
    );
    expect(pending.verificationHash).toBe(user.verificationHash);
  });
  it('expires recovery codes', async () => {
    const code = await requestRecovery();
    await repo.update(user.id, {
      passwordResetExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      users.resetPassword({
        email: user.email!,
        password: 'New-Password2!',
        code,
      }),
    ).rejects.toThrow('invalid or expired');
    expect(
      await bcrypt.compare(password, (await users.getUser(user.id)).password!),
    ).toBe(true);
  });
  it('resets a legacy mixed-case account, hashes password and immediately revokes all tokens', async () => {
    const tokens = await auth.getTokens(user);
    await repo.update(user.id, { email: ' Operator@Example.Test ' });
    const code = await requestRecovery();
    await users.resetPassword({
      email: 'OPERATOR@example.test',
      password: 'New-Password2!',
      code,
    });
    const reset = await users.getUser(user.id);
    expect(await bcrypt.compare('New-Password2!', reset.password!)).toBe(true);
    expect(reset.refreshToken).toBeNull();
    expect(reset.passwordResetTokenHash).toBeNull();
    expect(reset.authVersion).toBe(1);
    await expect(
      new JwtAccessStrategy(config, users).validate(decode(tokens.accessToken)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      new JwtRefreshStrategy(config, users).validate(
        { get: () => 'Bearer ' + tokens.refreshToken } as never,
        decode(tokens.refreshToken, true),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('consumes a recovery code exactly once under concurrent submissions', async () => {
    const code = await requestRecovery();
    const dto = { email: user.email!, password: 'New-Password2!', code };
    const results = await Promise.allSettled([
      users.resetPassword(dto),
      users.resetPassword(dto),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    await expect(users.resetPassword(dto)).rejects.toThrow(
      'invalid or expired',
    );
  });
  it('does not accept email-verification codes or missing reset codes', async () => {
    for (const code of [user.verificationHash!, '', undefined])
      await expect(
        users.resetPassword({
          email: user.email!,
          password: 'New-Password2!',
          code: code as string,
        }),
      ).rejects.toThrow('invalid or expired');
  });
  it('gives generic recovery responses for missing accounts and redacts SMTP failures', async () => {
    expect(
      await users.forgotPassword({ email: 'missing@example.test' }),
    ).toBeUndefined();
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    sendMail.mockRejectedValue(
      new Error(
        'SMTP failed: recipient operator@example.test reset-password?code=SECRET',
      ),
    );
    expect(await users.forgotPassword({ email: user.email! })).toBeUndefined();
    expect(logger).toHaveBeenCalledWith(
      'Password recovery email delivery failed',
    );
    expect(logger.mock.calls.flat().join(' ')).not.toMatch(
      /SECRET|operator@example/,
    );
  });
  it('requires a preapproved Google account bound to the same identity', async () => {
    await expect(
      auth.validateSocialUser(AuthProviderType.GOOGLE, {
        email: 'stranger@example.test',
        id: 'google-id',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      auth.validateSocialUser(AuthProviderType.GOOGLE, {
        email: user.email!,
        id: 'google-id',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await repo.update(user.id, {
      socialProvider: AuthProviderType.GOOGLE,
      socialId: 'google-id',
    });
    expect(
      await auth.validateSocialUser(AuthProviderType.GOOGLE, {
        email: user.email!,
        id: 'google-id',
      }),
    ).toHaveProperty('accessToken');
    await expect(
      auth.validateSocialUser(AuthProviderType.GOOGLE, {
        email: user.email!,
        id: 'different-id',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('requires a verified Google email claim', async () => {
    const google = new GoogleAuthService(config);
    Object.defineProperty(google, 'google', {
      value: {
        verifyIdToken: async () => ({
          getPayload: () => ({
            sub: 'google-id',
            email: 'google@example.test',
            email_verified: false,
          }),
        }),
      },
    });
    await expect(
      google.getProfileByToken({ idToken: 'opaque-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('enforces bcrypt maximum UTF-8 password bytes on direct updates', async () => {
    await expect(
      repo.update(user.id, { password: '界'.repeat(25) }),
    ).rejects.toThrow('72 UTF-8 bytes');
    // Repository.update has no databaseEntity; it must still hash a valid password.
    await repo.update(user.id, { password: 'Valid-Password3!' });
    expect(
      await bcrypt.compare(
        'Valid-Password3!',
        (await users.getUser(user.id)).password!,
      ),
    ).toBe(true);
    expect(subscriber.listenTo()).toBe(UserOrmEntity);
  });
});
