import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import {
  TruckLogAccessCredential,
  TruckLogAccessScope,
  safeDigestEqual,
} from '@truck-log/server/data-access';
import {
  TRUCK_LOG_ACCESS_SCOPES,
  TruckLogAccessRequest,
} from './truck-log-access';

const TOKEN_PATTERN = /^tloa_([0-9a-f]{16})_([0-9a-f]{64})$/;
const DUMMY_DIGEST = '0'.repeat(64);

@Injectable()
export class TruckLogAccessGuard implements CanActivate {
  constructor(
    @InjectRepository(TruckLogAccessCredential)
    private readonly credentials: Repository<TruckLogAccessCredential>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TruckLogAccessRequest>();
    const authorization = request.headers.authorization;
    const bearer = typeof authorization === 'string'
      ? /^Bearer\s+(.+)$/i.exec(authorization)?.[1] ?? ''
      : '';
    const token = TOKEN_PATTERN.exec(bearer);
    if (!token) throw this.denied();

    const [, keyId, secret] = token;
    const credential = await this.credentials.findOne({ where: { keyId } });
    const suppliedHash = createHash('sha256').update(secret, 'utf8').digest('hex');
    const digestMatches = safeDigestEqual(
      suppliedHash,
      credential?.secretSha256 ?? DUMMY_DIGEST,
    );
    const now = new Date();
    if (
      !credential ||
      !credential.active ||
      credential.revokedAt !== null ||
      (credential.expiresAt !== null && credential.expiresAt <= now) ||
      !digestMatches
    ) {
      throw this.denied();
    }

    const requiredScopes = this.reflector.getAllAndOverride<TruckLogAccessScope[]>(
      TRUCK_LOG_ACCESS_SCOPES,
      [context.getHandler(), context.getClass()],
    ) ?? [];
    if (requiredScopes.some((scope) => !credential.scopes.includes(scope))) {
      throw new ForbiddenException('This Truck Log credential lacks the required scope.');
    }

    const touchResult = await this.credentials
      .createQueryBuilder()
      .update(TruckLogAccessCredential)
      .set({ lastUsedAt: now })
      .where('key_id = :keyId', { keyId })
      .andWhere('active = TRUE')
      .andWhere('revoked_at IS NULL')
      .andWhere('(expires_at IS NULL OR expires_at > :now)', { now })
      .execute();
    if (touchResult.affected !== 1) throw this.denied();

    request.truckLogPrincipal = {
      subjectId: credential.subjectId,
      displayName: credential.displayName,
      keyId: credential.keyId,
      scopes: credential.scopes,
    };
    return true;
  }

  private denied(): UnauthorizedException {
    return new UnauthorizedException('Valid Truck Log access credentials are required.');
  }
}
