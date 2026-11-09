import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { PrintAgentCredential, safeDigestEqual } from '@truck-log/server/data-access';
import {
  PRINT_AGENT_SCOPE,
  PrintAgentRequest,
} from './print-agent-auth';

const TOKEN_PATTERN = /^tlpa_([0-9a-f]{16})_([0-9a-f]{64})$/;

@Injectable()
export class PrintAgentAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(PrintAgentCredential)
    private readonly credentials: Repository<PrintAgentCredential>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PrintAgentRequest>();
    const authorization = request.headers.authorization;
    const token = typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';
    const match = TOKEN_PATTERN.exec(token);
    if (!match) throw this.denied();

    const [, keyId, secret] = match;
    const credential = await this.credentials.findOne({
      where: { keyId, active: true },
      relations: { agent: true },
    });
    const suppliedHash = createHash('sha256').update(secret, 'utf8').digest('hex');
    const digestMatches = safeDigestEqual(
      suppliedHash,
      credential?.secretSha256 ?? '0'.repeat(64),
    );
    if (
      !credential ||
      !credential.agent?.enabled ||
      !digestMatches
    ) {
      throw this.denied();
    }

    const requiredScope = this.reflector.getAllAndOverride<string>(PRINT_AGENT_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredScope && !credential.scopes.includes(requiredScope)) {
      throw this.denied();
    }

    request.printAgent = {
      agentId: credential.agentId,
      displayName: credential.agent.displayName,
      keyId: credential.keyId,
      scopes: credential.scopes,
    };
    return true;
  }

  private denied(): UnauthorizedException {
    return new UnauthorizedException('Valid Print Agent credentials are required.');
  }
}
