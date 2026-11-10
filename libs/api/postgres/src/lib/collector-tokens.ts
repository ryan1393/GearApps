import { CollectorTokensService } from '@gearapps/api/feature-gear';
import {
  COLLECTOR_TOKEN_PREFIX,
  CollectorToken,
  CollectorTokenResolver,
  CollectorTokenUser,
  CreatedCollectorToken,
} from '@gearapps/shared/domain';
import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
};

export const hashCollectorToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class PostgresCollectorTokens
  extends CollectorTokensService
  implements CollectorTokenResolver
{
  private readonly lastTouched = new Map<string, number>();

  constructor(private readonly catalog: PostgresLapperCatalog) {
    super();
  }

  private query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.catalog.db.query(sql, params) as Promise<T[]>;
  }

  async list(): Promise<CollectorToken[]> {
    const rows = await this.query<TokenRow>(
      `SELECT t.id,t.name,t.hint,t.created_at,t.created_by,u.email AS created_by_email,t.last_used_at,t.revoked_at
         FROM lapper.collector_tokens t LEFT JOIN public.users u ON u.id=t.created_by
        ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC`,
    );
    return rows.map(toToken);
  }

  async create(name: string, createdBy: string): Promise<CreatedCollectorToken> {
    const token = COLLECTOR_TOKEN_PREFIX + randomBytes(30).toString('base64url');
    const id = randomUUID();
    await this.query(
      `INSERT INTO lapper.collector_tokens(id,name,token_hash,hint,created_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, name, hashCollectorToken(token), token.slice(-4), createdBy],
    );
    const [row] = (await this.list()).filter((t) => t.id === id);
    return { ...row, token };
  }

  async revoke(id: string): Promise<void> {
    const rows = await this.query<{ id: string }>(
      `UPDATE lapper.collector_tokens SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1 RETURNING id`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Collector token not found');
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
  };
}
