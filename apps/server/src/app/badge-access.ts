import { createHash, randomUUID } from 'node:crypto';
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
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
import { Request, Response } from 'express';
import {
  assertWithinLimit,
  Auth,
  RateLimiter,
  ReqUserId,
  SkipAuth,
} from '@meshforge/manufacturing/server/util-common';
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

/** Rejected badge sign-ins allowed per client address, and on the whole server, per minute. */
export const BADGE_FAILURES_PER_ADDRESS = 10;
export const BADGE_FAILURES_PER_SERVER = 100;
const BADGE_GLOBAL_KEY = 'all';

@Injectable()
export class BadgeAccessService {
  // Only rejected attempts count, and a successful sign-in clears nothing: one valid badge
  // must not reset the counter for someone trying other UIDs. The server-wide limit stops
  // enumeration spread over many (or spoofed) addresses.
  private readonly failuresPerAddress = new RateLimiter({ limit: BADGE_FAILURES_PER_ADDRESS, windowMs: 60_000 });
  private readonly failuresOnServer = new RateLimiter({ limit: BADGE_FAILURES_PER_SERVER, windowMs: 60_000 });
  constructor(
    @InjectDataSource() private readonly source: DataSource,
    private readonly users: ServerFeatUserService,
    private readonly auth: ServerFeatAuthService,
    private readonly access: AccessManagementService,
  ) {}
  async login(dto: BadgeUidDto, ip: string, response?: Response | null) {
    assertWithinLimit(
      this.failuresPerAddress.peek(ip),
      (wait) => `Too many badge attempts. Wait ${wait}, then try again.`,
      response,
    );
    assertWithinLimit(
      this.failuresOnServer.peek(BADGE_GLOBAL_KEY),
      (wait) => `Too many badge attempts on this server. Wait ${wait}, then try again, or use your password.`,
      response,
    );
    let user: Awaited<ReturnType<BadgeAccessService['resolve']>>;
    try {
      user = await this.resolve(dto);
    } catch (error) {
      if (error instanceof HttpException) {
        this.failuresPerAddress.hit(ip);
        this.failuresOnServer.hit(BADGE_GLOBAL_KEY);
      }
      throw error;
    }
    return this.auth.getTokens(user);
  }
  /** The active, non-administrator account the badge belongs to. */
  private async resolve(dto: BadgeUidDto) {
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
    return this.source.transaction(async (manager) => {
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
      // A badge is something you have, not something you know: it is not enough for an
      // administrator account.
      if (account.role === RoleType.ADMIN)
        throw new ForbiddenException('Administrators sign in with email and password.');
      return account;
    });
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
    return this.service.login(dto, req.ip ?? req.socket?.remoteAddress ?? 'unknown', req.res);
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
