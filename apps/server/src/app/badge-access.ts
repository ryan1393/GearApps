import { createHash, randomUUID } from 'node:crypto';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { Request } from 'express';
import { Auth, ReqUserId, SkipAuth } from '@meshforge/manufacturing/server/util-common';
import { RoleType, Uuid } from '@meshforge/manufacturing/shared/util-types';
import { ServerFeatAuthService } from '@meshforge/manufacturing/server/feat-auth';
import { ServerFeatUserService } from '@meshforge/manufacturing/server/feat-user';
import { AccessManagementService } from './access-management';

export class BadgeUidDto {
  @IsString() @MinLength(1) @MaxLength(128) @Matches(/^[!-~]+$/) uid!: string;
}
export function badgeHash(uid: string): string {
  return createHash('sha256').update(uid.toUpperCase()).digest('hex');
}

@Injectable()
export class BadgeAccessService {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(
    @InjectDataSource() private readonly source: DataSource,
    private readonly users: ServerFeatUserService,
    private readonly auth: ServerFeatAuthService,
    private readonly access: AccessManagementService,
  ) {}
  async login(dto: BadgeUidDto, ip: string) {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
    const entry = this.attempts.get(ip) ?? { count: 0, until: now + 60_000 };
    if (entry.count >= 10 || (!this.attempts.has(ip) && this.attempts.size >= 10_000))
      throw new UnauthorizedException('Too many badge attempts. Wait one minute, then try again.');
    entry.count++;
    this.attempts.set(ip, entry);
    const [badge] = await this.source.query(
      `SELECT user_id,revoked_at FROM meshforge_badges WHERE uid_hash=$1 ORDER BY revoked_at NULLS FIRST,created_at DESC LIMIT 1`,
      [badgeHash(dto.uid)],
    );
    if (!badge)
      throw new UnauthorizedException(
        'Badge not recognized. Use your password or ask an administrator to assign it.',
      );
    if (badge.revoked_at)
      throw new UnauthorizedException(
        'This badge has been revoked. Use your password or contact an administrator.',
      );
    const user = await this.source.transaction(async (manager) => {
      // Assignment/revocation lock this same account before changing its badge and authVersion.
      // Recheck the badge after acquiring the lock so a revoked UID cannot sign in using a
      // newer account version read after the first lookup. Issue tokens outside the lock:
      // getTokens' compare-and-swap rejects any revocation after this snapshot is released.
      await manager.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [badge.user_id]);
      const [current] = await manager.query(
        'SELECT revoked_at FROM meshforge_badges WHERE uid_hash=$1 AND user_id=$2 ORDER BY revoked_at NULLS FIRST,created_at DESC LIMIT 1',
        [badgeHash(dto.uid), badge.user_id],
      );
      if (!current || current.revoked_at)
        throw new UnauthorizedException(
          'This badge has been revoked. Use your password or contact an administrator.',
        );
      const account = await this.users.findUser({ id: badge.user_id });
      if (!account?.active || !account.email)
        throw new UnauthorizedException(
          'This badge account is inactive. Contact an administrator.',
        );
      return account;
    });
    const tokens = await this.auth.getTokens(user);
    this.attempts.delete(ip);
    return tokens;
  }
  list() {
    return this.source.query(
      `SELECT id,user_id,created_at FROM meshforge_badges WHERE revoked_at IS NULL ORDER BY created_at DESC`,
    );
  }
  async change(userId: Uuid, actor: Uuid, dto?: BadgeUidDto) {
    return this.source.transaction(async (manager) => {
      const [user] = await manager.query('SELECT id,active FROM users WHERE id=$1 FOR UPDATE', [
        userId,
      ]);
      if (!user) throw new ConflictException('User not found.');
      if (dto && !user.active)
        throw new ConflictException('Activate the account before assigning a badge.');
      if (dto) {
        // Serialize assignments of the same UID across different users.
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [badgeHash(dto.uid)]);
        const [existing] = await manager.query(
          'SELECT user_id FROM meshforge_badges WHERE uid_hash=$1 AND revoked_at IS NULL',
          [badgeHash(dto.uid)],
        );
        if (existing && existing.user_id !== userId)
          throw new ConflictException(
            'This badge is assigned to another account. Revoke it there first.',
          );
      }
      const previous = await manager.query(
        'UPDATE meshforge_badges SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL RETURNING id',
        [userId],
      );
      const id = randomUUID();
      if (dto)
        await manager.query('INSERT INTO meshforge_badges(id,user_id,uid_hash) VALUES($1,$2,$3)', [
          id,
          userId,
          badgeHash(dto.uid),
        ]);
      await manager.query(
        'UPDATE users SET "authVersion"="authVersion"+1,"refreshToken"=NULL WHERE id=$1',
        [userId],
      );
      await this.access.audit(manager, actor, dto ? 'badge.assign' : 'badge.revoke', userId, {
        revoked_badge_ids: previous.map((row: { id: string }) => row.id),
        assigned_badge_id: dto ? id : null,
      });
      return { saved: true };
    });
  }
}

@Controller({ path: 'auth/badge', version: '1' })
export class BadgeLoginController {
  constructor(private readonly service: BadgeAccessService) {}
  @Post('login')
  @SkipAuth()
  @HttpCode(200)
  login(@Body() dto: BadgeUidDto, @Req() req: Request) {
    return this.service.login(dto, req.ip ?? 'unknown');
  }
}
@Controller({ path: 'admin/access/badges', version: '1' })
export class BadgeManagementController {
  constructor(private readonly service: BadgeAccessService) {}
  @Get() @Auth([RoleType.ADMIN]) list() {
    return this.service.list();
  }
  @Post(':userId/assign') @Auth([RoleType.ADMIN]) assign(
    @Param('userId', ParseUUIDPipe) user: Uuid,
    @Body() dto: BadgeUidDto,
    @ReqUserId() actor: Uuid,
  ) {
    return this.service.change(user, actor, dto);
  }
  @Post(':userId/revoke') @Auth([RoleType.ADMIN]) revoke(
    @Param('userId', ParseUUIDPipe) user: Uuid,
    @ReqUserId() actor: Uuid,
  ) {
    return this.service.change(user, actor);
  }
}
