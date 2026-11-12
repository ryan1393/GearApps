import * as crypto from 'crypto';
import {
  EntityManager,
  FindOptionsWhere,
  IsNull,
  MoreThan,
  Raw,
  Repository,
} from 'typeorm';

import {
  CreateUserDto,
  DepartmentOrmEntity,
  PaginationOptionsDto,
  PaginationService,
  UserOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import {
  IResetPasswordEmailContext,
  IVerifyEmailContext,
  ServerUtilMailerService,
} from '@meshforge/manufacturing/server/util-mailer';
import {
  AuthProviderType,
  IForgotPasswordPayload,
  IPaginatedResponse,
  IResetPasswordPayload,
  IUser,
  IUserEntity,
  RoleType,
  Uuid,
} from '@meshforge/manufacturing/shared/util-types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class ServerFeatUserService extends PaginationService<UserOrmEntity> {
  private readonly logger = new Logger(ServerFeatUserService.name);

  private get publicApiBaseUrl(): string {
    const configured =
      this.configService.get<string>('PUBLIC_API_BASE_URL') ??
      'http://localhost:3333';
    return configured.replace(/\/+$/, '');
  }

  constructor(
    @InjectRepository(UserOrmEntity)
    private userRepo: Repository<UserOrmEntity>,
    @InjectRepository(DepartmentOrmEntity)
    private departmentRepo: Repository<DepartmentOrmEntity>,
    private emailService: ServerUtilMailerService,
    private configService: ConfigService,
  ) {
    super(UserOrmEntity.prototype, userRepo);
  }

  async findUser(
    find: FindOptionsWhere<UserOrmEntity>,
  ): Promise<UserOrmEntity | null> {
    return this.userRepo.findOne({
      where: find,
      relations: { department: true },
    });
  }

  async findByEmail(email: string): Promise<UserOrmEntity | null> {
    if (typeof email !== 'string' || !email.trim()) return null;
    const matches = await this.userRepo.find({
      where: {
        email: Raw((alias) => `LOWER(TRIM(${alias})) = :normalizedEmail`, {
          normalizedEmail: email.trim().toLowerCase(),
        }),
      },
      relations: { department: true },
      take: 2,
    });
    if (matches.length > 1)
      throw new UnauthorizedException(
        'Account email is ambiguous; contact an administrator',
      );
    return matches[0] ?? null;
  }

  async createUser(dto: CreateUserDto): Promise<UserOrmEntity> {
    if (dto.socialProvider === AuthProviderType.EMAIL && dto.socialId) {
      throw new BadRequestException(
        `User can not provide a social ID while registering with an email address!`,
      );
    }

    // assume that since a 3rd party is being for registration, their email is verified already
    const user = this.userRepo.create({
      ...dto,
      email: dto.email.trim().toLowerCase(),
      role: RoleType.USER,
      isEmailVerified: dto.socialProvider !== AuthProviderType.EMAIL,
    });
    await user.save();

    if (dto.socialProvider === AuthProviderType.EMAIL) {
      if (!user.email) {
        throw new BadRequestException(
          'An email address is required for email authentication',
        );
      }
      const email = user.email;
      const context: IVerifyEmailContext = {
        verificationLink: `${this.publicApiBaseUrl}/api/v1/auth/email/verify?code=${user.verificationHash}&email=${encodeURIComponent(email)}`,
        userEmailAddress: email,
        title: 'Verify Your Email',
        username: user.firstName ?? email,
      };
      await this.emailService.sendMail({
        templatePath: 'verify-email.hbs',
        context,
        to: email,
        subject: `Verify Your Email`,
      });
    }
    return user;
  }

  async createUserByAdmin(
    dto: {
      email: string;
      password: string;
      firstName?: string | null;
      lastName?: string | null;
      role: RoleType;
      departmentId: Uuid;
    },
    adminUserId: Uuid,
  ): Promise<UserOrmEntity> {
    const department = await this.departmentRepo.findOne({
      where: { id: dto.departmentId, enabled: true },
    });
    if (!department) {
      throw new UnprocessableEntityException(
        'User department was not found or is disabled',
      );
    }

    const existing = await this.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException(`User ${dto.email} already exists`);
    }

    const user = this.userRepo.create({
      email: dto.email.trim().toLowerCase(),
      password: dto.password,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      avatar: null,
      role: dto.role,
      departmentId: department.id,
      active: true,
      socialProvider: AuthProviderType.EMAIL,
      socialId: null,
      isEmailVerified: true,
      emailVerifiedOn: new Date(),
      verificationHash: null,
      createdBy: adminUserId,
      updatedBy: adminUserId,
    });

    await user.save();

    // The entity subscriber creates a verification hash for all local-auth
    // inserts. Admin-created accounts are intentionally already verified.
    if (user.verificationHash) {
      user.verificationHash = null;
      await user.save();
    }

    return user;
  }

  async getUser(userId: Uuid) {
    return await this.userRepo.findOneOrFail({
      where: { id: userId },
      relations: { department: true },
    });
  }

  async getUsers(
    paginationOptions?: PaginationOptionsDto,
  ): Promise<IPaginatedResponse<IUser>> {
    return this.paginate<IUser>(paginationOptions, (entity) => entity.toJSON());
  }

  async getUserByEmail(email: string): Promise<UserOrmEntity> {
    const user = await this.findByEmail(email);
    if (!user) throw new NotFoundException('User could not be found!');
    return user;
  }

  async updateUser(
    userId: Uuid,
    data: Partial<IUserEntity>,
    repo: Repository<UserOrmEntity> = this.userRepo,
  ) {
    const normalized = { ...data };
    if (typeof normalized.email === 'string') {
      normalized.email = normalized.email.trim().toLowerCase();
      const existing = await this.findByEmail(normalized.email);
      if (existing && existing.id !== userId)
        throw new ConflictException('User email already exists');
    }
    await repo.save({ id: userId, ...normalized });
    return repo.findOneOrFail({ where: { id: userId } });
  }

  /**
   * Admin edit of a user. An administrator cannot disable or demote their own account, and the
   * last active administrator cannot be disabled or demoted by anyone: either would leave the
   * system with no way to manage users short of editing the database. The check and the change
   * run in one transaction holding the active administrators' rows, so two administrators
   * demoting each other at the same time cannot leave none.
   */
  async updateUserAsAdmin(
    actorId: Uuid,
    userId: Uuid,
    data: Partial<IUserEntity>,
  ) {
    if (data.departmentId) await this.assertEnabledDepartment(data.departmentId);
    const deactivating = data.active === false;
    const demoting = data.role !== undefined && data.role !== RoleType.ADMIN;
    if (!deactivating && !demoting) return this.updateUser(userId, data);
    return this.userRepo.manager.transaction(async (manager) => {
      await this.assertAdministratorsRemain(manager, actorId, userId, 'update');
      return this.updateUser(userId, data, manager.getRepository(UserOrmEntity));
    });
  }

  private async assertEnabledDepartment(departmentId: string): Promise<void> {
    const department = await this.departmentRepo.findOne({
      where: { id: departmentId, enabled: true },
    });
    if (!department) {
      throw new UnprocessableEntityException(
        'User department was not found or is disabled',
      );
    }
  }

  /**
   * Locks the active administrators (PostgreSQL row locks, held to the end of the transaction)
   * and refuses removing yourself or the last one. SQLite, used by tests, serializes writes.
   */
  private async assertAdministratorsRemain(
    manager: EntityManager,
    actorId: Uuid,
    userId: Uuid,
    change: 'update' | 'delete',
  ): Promise<void> {
    if (change === 'delete' && userId === actorId) {
      throw new ConflictException(
        'You cannot delete your own account. Ask another administrator.',
      );
    }
    const query = manager
      .getRepository(UserOrmEntity)
      .createQueryBuilder('user')
      .select('user.id', 'id')
      .where('user.role = :role AND user.active = :active', {
        role: RoleType.ADMIN,
        active: true,
      })
      .orderBy('user.id');
    if (manager.connection.options.type === 'postgres') query.setLock('pessimistic_write');
    const admins = (await query.getRawMany<{ id: Uuid }>()).map((row) => row.id);
    if (!admins.includes(userId)) return;
    if (userId === actorId) {
      throw new ConflictException(
        'You cannot disable or demote your own administrator account. Ask another administrator.',
      );
    }
    if (admins.length <= 1) {
      throw new ConflictException(
        'This is the last active administrator. Make another user an administrator first.',
      );
    }
  }

  /** Atomic compare-and-swap allows only one winner when refreshes race. */
  async replaceRefreshToken(
    user: UserOrmEntity,
    replacement: string,
    expected?: string,
  ): Promise<boolean> {
    const where: FindOptionsWhere<UserOrmEntity> = {
      id: user.id,
      active: true,
      authVersion: user.authVersion,
      password: user.password == null ? IsNull() : user.password,
      ...(expected === undefined ? {} : { refreshToken: expected }),
    };
    const result = await this.userRepo.update(where, {
      refreshToken: replacement,
    });
    return result.affected === 1;
  }

  async forgotPassword(dto: IForgotPasswordPayload) {
    const user = await this.findByEmail(dto.email);
    // Do not disclose whether an active local-login account exists.
    if (
      !user?.active ||
      !user.email ||
      !user.password ||
      user.socialProvider !== AuthProviderType.EMAIL
    )
      return;
    const code = crypto.randomBytes(32).toString('hex');
    await this.userRepo.update(user.id, {
      passwordResetTokenHash: crypto
        .createHash('sha256')
        .update(code)
        .digest('hex'),
      passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const webOrigin = (
      this.configService.get<string>('PUBLIC_WEB_BASE_URL') ??
      'http://localhost:4200'
    ).replace(/\/+$/, '');
    const context: IResetPasswordEmailContext = {
      passwordResetLink: `${webOrigin}/reset-password?code=${code}`,
      title: 'Reset Your Password',
      username: user.firstName ?? user.email,
    };
    try {
      await this.emailService.sendMail({
        templatePath: 'reset-password.hbs',
        context,
        to: user.email,
        subject: 'Reset Your Password',
      });
    } catch {
      // Transport errors can include recipient addresses, reset URLs and secrets.
      this.logger.error('Password recovery email delivery failed');
    }
  }

  async resetPassword(dto: IResetPasswordPayload & { code: string }) {
    const invalid = () =>
      new UnprocessableEntityException(
        'Password reset code is invalid or expired',
      );
    if (typeof dto.code !== 'string' || !/^[a-f0-9]{64}$/.test(dto.code))
      throw invalid();
    const user = await this.findByEmail(dto.email);
    if (
      !user?.active ||
      !user.email ||
      user.socialProvider !== AuthProviderType.EMAIL
    )
      throw invalid();
    // Preserve legacy email casing by consuming the code against the resolved ID.
    const result = await this.userRepo.update(
      {
        id: user.id,
        email: user.email,
        active: true,
        authVersion: user.authVersion,
        socialProvider: AuthProviderType.EMAIL,
        passwordResetTokenHash: crypto
          .createHash('sha256')
          .update(dto.code)
          .digest('hex'),
        passwordResetExpiresAt: MoreThan(new Date()),
      },
      {
        password: dto.password,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        refreshToken: null,
        authVersion: () => '"authVersion" + 1',
      },
    );
    if (result.affected !== 1) throw invalid();
  }

  /** Deletes a user. Never your own account, and never the last active administrator. */
  async deleteUser(actorId: Uuid, userId: Uuid): Promise<void> {
    await this.userRepo.manager.transaction(async (manager) => {
      await this.assertAdministratorsRemain(manager, actorId, userId, 'delete');
      const repo = manager.getRepository(UserOrmEntity);
      const user = await repo.findOne({ where: { id: userId } });
      if (!user) {
        this.logger.log(
          `Request received to delete user ${userId} - but user does not exist!`,
        );
        throw new UnprocessableEntityException(`Error deleting user`);
      }
      await repo.remove(user);
    });
  }
}
