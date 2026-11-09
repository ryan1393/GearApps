import { RequestUser } from '@gearapps/api/core';
import { AccessTokenPayload, User } from '@gearapps/shared/domain';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Row, text } from './catalog';

type SharedUser = User & { role: string; authVersion: number };

@Injectable()
export class PostgresUsersService {
  constructor(private readonly db: DataSource) {}
  registrationEnabled(): boolean {
    return false;
  }

  private query() {
    return this.db
      .createQueryBuilder()
      .select('u.id', 'id')
      .addSelect('COALESCE(u.email,u.username,u."employeeNumber")', 'email')
      .addSelect('u.password', 'password')
      .addSelect('u."firstName"', 'fname')
      .addSelect('u."lastName"', 'lname')
      .addSelect('u.role', 'role')
      .addSelect('u."authVersion"', 'auth_version')
      .from('public.users', 'u')
      .where('u.active=true AND u."deletedAt" IS NULL');
  }
  private project(row: Row): SharedUser {
    return {
      id: text(row.id),
      email: text(row.email),
      password: text(row.password),
      fname: text(row.fname),
      lname: text(row.lname),
      role: text(row.role),
      authVersion: Number(row.auth_version),
    };
  }
  async findByEmail(identifier: string): Promise<User | null> {
    const rows = await this.query()
      .andWhere(
        `(lower(btrim(COALESCE(u.email,'')))=:login OR lower(btrim(COALESCE(u.username,'')))=:login OR lower(btrim(COALESCE(u."employeeNumber",'')))=:login)`,
        { login: identifier.trim().toLowerCase() },
      )
      .limit(2)
      .getRawMany<Row>();
    return rows.length === 1 ? this.project(rows[0]) : null;
  }
  async findOne(id: string): Promise<User> {
    const row = await this.query().andWhere('u.id=:id', { id }).getRawOne<Row>();
    if (!row) throw new NotFoundException('User not found');
    return this.project(row);
  }
  async verifyPassword(user: User, password: string): Promise<boolean> {
    if (!user.password || Buffer.byteLength(password, 'utf8') > 72) return false;
    try {
      return await bcrypt.compare(password, user.password);
    } catch {
      return false;
    }
  }
  async validateToken(payload: AccessTokenPayload): Promise<RequestUser> {
    if (payload.token_use !== 'lapper-access')
      throw new UnauthorizedException('Use a Lapper access token');
    try {
      const user = (await this.findOne(payload.sub)) as SharedUser;
      if (payload.auth_version !== user.authVersion)
        throw new UnauthorizedException('Account access was revoked');
      return {
        userId: user.id,
        email: user.email,
        fname: user.fname,
        lname: user.lname,
        role: user.role,
      };
    } catch {
      throw new UnauthorizedException('Account is unavailable');
    }
  }
  async create(): Promise<User> {
    throw new ForbiddenException('Accounts are managed in GearApps');
  }
  async update(): Promise<User> {
    throw new ForbiddenException('Manage your account in GearApps');
  }
  async remove(): Promise<void> {
    throw new ForbiddenException('Accounts are managed in GearApps');
  }
}
