import { randomBytes } from 'node:crypto';

import { Repository } from 'typeorm';

import {
  AuthProviderType,
  ICreateUser,
  RoleType,
} from '@meshforge/manufacturing/shared/util-types';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { UserOrmEntity } from '../entities/user.orm-entity';

const createRandomPassword = (): string =>
  `${randomBytes(24).toString('base64url')}1!`;

const createRandomToken = (): string =>
  randomBytes(10).toString('hex');

@Injectable()
export class UserDatabaseSeedService {
  private logger = new Logger(UserDatabaseSeedService.name);

  constructor(
    @InjectRepository(UserOrmEntity)
    private repo: Repository<UserOrmEntity>,
  ) {}

  /**
   * Add a basic admin user and base user.
   *
   * This production seed path intentionally uses only Node runtime
   * dependencies. Test-only random-data libraries must not be imported here
   * because the Docker runtime image installs production dependencies only.
   */
  async seed() {
    const adminExists =
      (await this.repo.count({ where: { role: RoleType.ADMIN } })) > 0;

    if (!adminExists) {
      this.logger.log(`No admin user found, creating admin!`);
      const admin: ICreateUser = {
        firstName: 'Johnny',
        lastName: 'Admin',
        email: 'admin@example.com',
        password: process.env['SEED_ADMIN_PASSWORD'] ?? createRandomPassword(),
        role: RoleType.ADMIN,
        socialProvider: AuthProviderType.EMAIL,
        avatar: null,
        socialId: null,
      };

      await this.repo.save(this.repo.create(admin));
      this.logger.log(`Admin user created`);
    }

    const userExists =
      (await this.repo.count({ where: { role: RoleType.USER } })) > 0;

    if (!userExists) {
      this.logger.log(`No regular user found, creating user!`);
      const user: ICreateUser = {
        firstName: 'Johnny',
        lastName: 'User',
        email: 'user@example.com',
        password: process.env['SEED_USER_PASSWORD'] ?? createRandomPassword(),
        role: RoleType.USER,
        socialProvider: AuthProviderType.EMAIL,
        avatar: null,
        socialId: null,
      };

      await this.repo.save(this.repo.create(user));
      this.logger.log(`User created`);
    }
  }

  /**
   * Development/test helper retained without a production dependency on falso.
   */
  async populateRandomUsers(count: number) {
    const users: ICreateUser[] = Array.from({ length: count }, (_, index) => {
      const token = createRandomToken();

      return {
        firstName: 'Test',
        lastName: `User ${index + 1}`,
        email: `test-${token}@example.invalid`,
        password: createRandomPassword(),
        role: RoleType.USER,
        socialProvider: AuthProviderType.EMAIL,
        socialId: null,
        avatar: null,
      };
    });

    await this.repo.save(users.map((user) => this.repo.create(user)));
    this.logger.log(`Created ${count} random users`);
  }
}
