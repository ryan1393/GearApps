import { CollectorTokensService } from '@meshforge/api/feature-gear';
import {
  COLLECTOR_TOKEN_PREFIX,
  CollectorToken,
  CollectorTokenResolver,
  CollectorTokenUser,
  CreatedCollectorToken,
  DockerCollectorConnection,
} from '@meshforge/shared/domain';
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EntityManager } from 'typeorm';
import { PostgresLapperCatalog } from './catalog';

export const COLLECTOR_TOKENS_SQL = `
CREATE TABLE IF NOT EXISTS lapper.collector_tokens (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 token_hash char(64) NOT NULL UNIQUE,
 hint text NOT NULL,
 created_by uuid NOT NULL REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_used_at timestamptz,
 revoked_at timestamptz
);
`;

/** One token per purpose may be active; 'docker' marks the token handed to the Docker collector. */
export const COLLECTOR_TOKEN_PURPOSE_SQL = `
ALTER TABLE lapper.collector_tokens ADD COLUMN IF NOT EXISTS purpose text CHECK (purpose IN ('docker'));
CREATE UNIQUE INDEX IF NOT EXISTS collector_tokens_one_active_purpose
  ON lapper.collector_tokens(purpose) WHERE purpose IS NOT NULL AND revoked_at IS NULL;
`;

const DOCKER_TOKEN_NAME = 'Docker collector';

/**
 * Where the API hands the Docker collector its token: a file on a volume only the API and the
 * lapper-read container mount (compose sets LAPPER_READ_TOKEN_FILE). Empty outside Docker.
 */
export const dockerCollectorTokenFile = (env: NodeJS.ProcessEnv = process.env): string =>
  (env['LAPPER_READ_TOKEN_FILE'] ?? '').trim();

/** Usage is recorded at most this often per token, so busy collectors don't write on every call. */
const LAST_USED_RESOLUTION_MS = 60_000;

type TokenRow = {
  id: string;
  name: string;
  hint: string;
  created_at: Date;
  created_by: string;
  created_by_email: string | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
  purpose: 'docker' | null;
};

export const hashCollectorToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class PostgresCollectorTokens
  extends CollectorTokensService
  implements CollectorTokenResolver
{
  private readonly lastTouched = new Map<string, number>();

  /** Read once at start-up from LAPPER_READ_TOKEN_FILE (set by compose). */
  private readonly tokenFile = dockerCollectorTokenFile();

  constructor(private readonly catalog: PostgresLapperCatalog) {
    super();
  }

  private query<T>(sql: string, params: unknown[] = [], manager?: EntityManager): Promise<T[]> {
    return (manager ?? this.catalog.db).query(sql, params) as Promise<T[]>;
  }

  async list(): Promise<CollectorToken[]> {
    const rows = await this.query<TokenRow>(
      `SELECT t.id,t.name,t.hint,t.created_at,t.created_by,u.email AS created_by_email,t.last_used_at,t.revoked_at,t.purpose
         FROM lapper.collector_tokens t LEFT JOIN public.users u ON u.id=t.created_by
        ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC`,
    );
    return rows.map(toToken);
  }

  async create(name: string, createdBy: string): Promise<CreatedCollectorToken> {
    const { id, token } = await this.insert(name, createdBy, null);
    const [row] = (await this.list()).filter((t) => t.id === id);
    return { ...row, token };
  }

  async revoke(id: string): Promise<void> {
    const rows = await this.query<{ id: string; purpose: string | null }>(
      `UPDATE lapper.collector_tokens SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1 RETURNING id,purpose`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Collector token not found');
    // A revoked Docker token is also removed from the collector's volume.
    if (rows[0].purpose === 'docker' && this.tokenFile) await rm(this.tokenFile, { force: true });
  }

  async dockerConnection(): Promise<DockerCollectorConnection> {
    const token = (await this.list()).find((t) => t.purpose === 'docker' && !t.revoked_at) ?? null;
    return { available: Boolean(this.tokenFile), token };
  }

  /**
   * Issues a new Docker collector token, writes it where the collector reads it and revokes the
   * previous one, in one transaction: the old token keeps working until the new file is in place.
   * The collector picks the new token up on its next rejected call, without a restart.
   */
  async connectDocker(createdBy: string): Promise<DockerCollectorConnection> {
    const file = this.tokenFile;
    if (!file) {
      throw new ServiceUnavailableException(
        'This API is not running in the Docker stack, so it cannot hand a token to the Docker collector. ' +
          'Create a token instead and set MESHFORGE_API_TOKEN for the collector.',
      );
    }
    await this.catalog.db.transaction(async (manager) => {
      await this.query(
        `UPDATE lapper.collector_tokens SET revoked_at=clock_timestamp() WHERE purpose='docker' AND revoked_at IS NULL`,
        [],
        manager,
      );
      const { token } = await this.insert(DOCKER_TOKEN_NAME, createdBy, 'docker', manager);
      await writeTokenFile(file, token);
    });
    return this.dockerConnection();
  }

  private async insert(
    name: string,
    createdBy: string,
    purpose: 'docker' | null,
    manager?: EntityManager,
  ): Promise<{ id: string; token: string }> {
    const token = COLLECTOR_TOKEN_PREFIX + randomBytes(30).toString('base64url');
    const id = randomUUID();
    await this.query(
      `INSERT INTO lapper.collector_tokens(id,name,token_hash,hint,created_by,purpose) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, name, hashCollectorToken(token), token.slice(-4), createdBy, purpose],
      manager,
    );
    return { id, token };
  }

  async resolve(token: string): Promise<CollectorTokenUser | null> {
    if (!token.startsWith(COLLECTOR_TOKEN_PREFIX) || token.length > 200) return null;
    const [row] = await this.query<{ id: string; created_by: string; name: string }>(
      `SELECT id,created_by,name FROM lapper.collector_tokens WHERE token_hash=$1 AND revoked_at IS NULL`,
      [hashCollectorToken(token)],
    );
    if (!row) return null;
    const now = Date.now();
    if (now - (this.lastTouched.get(row.id) ?? 0) > LAST_USED_RESOLUTION_MS) {
      this.lastTouched.set(row.id, now);
      await this.query(
        `UPDATE lapper.collector_tokens SET last_used_at=clock_timestamp() WHERE id=$1`,
        [row.id],
      );
    }
    // Records a collector creates (e.g. a pending gearset) are attributed to the admin who issued
    // the token; the token itself never has admin rights.
    return {
      id: row.created_by,
      email: `collector-token:${row.name}`,
      role: 'user',
      departmentId: null,
      departmentCode: null,
      departmentDescription: null,
      collectorTokenId: row.id,
    };
  }
}

function toToken(row: TokenRow): CollectorToken {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    id: row.id,
    name: row.name,
    hint: row.hint,
    created_at: new Date(row.created_at).toISOString(),
    created_by_email: row.created_by_email,
    last_used_at: iso(row.last_used_at),
    revoked_at: iso(row.revoked_at),
    purpose: row.purpose ?? null,
  };
}

/** Atomic replace, readable by the collector's unprivileged user (the volume is shared by two containers only). */
async function writeTokenFile(file: string, token: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o755 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, token + '\n', { mode: 0o644 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
