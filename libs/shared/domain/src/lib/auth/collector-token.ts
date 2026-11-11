import { AuthenticatedUser } from './auth';

/**
 * Collector tokens let a machine collector (Lapper Read) call the API without a person's
 * password. They never expire, can be revoked in Lapper, and only reach the endpoints
 * a collector needs (see `collectorTokenAllows`).
 */
export const COLLECTOR_TOKEN_PREFIX = 'glr_';

/** Nest injection token for the service that turns a raw collector token into a request user. */
export const COLLECTOR_TOKEN_RESOLVER = 'MESHFORGE_COLLECTOR_TOKEN_RESOLVER';

export type CollectorTokenUser = AuthenticatedUser & { collectorTokenId: string };

export interface CollectorTokenResolver {
  /** The request user for a valid, unrevoked token; null otherwise. */
  resolve(token: string): Promise<CollectorTokenUser | null>;
}

export interface CollectorToken {
  id: string;
  name: string;
  /** Last characters of the token, to tell tokens apart. The token itself is never stored. */
  hint: string;
  created_at: string;
  created_by_email: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  /** 'docker': the token the API handed to the Docker Lapper Read collector. */
  purpose: 'docker' | null;
}

/** The Docker Lapper Read collector's connection, as Lapper > Collector Tokens shows it. */
export interface DockerCollectorConnection {
  /** False when this API has no shared token file (it is not running in the Docker stack). */
  available: boolean;
  /** The active token the collector is using, if it is connected. */
  token: CollectorToken | null;
}

/** Returned once, when a token is created. */
export interface CreatedCollectorToken extends CollectorToken {
  token: string;
}

const ID = '[^/]+';
const ALLOWED: Record<string, RegExp[]> = {
  GET: [
    /^\/machine$/,
    new RegExp(`^/machine/ip/${ID}$`),
    /^\/scanner-detail$/,
    new RegExp(`^/scanner-detail/ip/${ID}$`),
    /^\/macro$/,
    new RegExp(`^/macro-log/summary/${ID}/${ID}$`),
    new RegExp(`^/macro-log/${ID}/${ID}$`),
    new RegExp(`^/machine-fanuc-variable/by-machine/${ID}$`),
    new RegExp(`^/gearset/number/${ID}$`),
  ],
  POST: [/^\/machine-cycle$/, /^\/macro-log$/, /^\/machine-fanuc-variable$/, /^\/gearset$/],
  PATCH: [
    new RegExp(`^/machine-fanuc-variable/${ID}$`),
    new RegExp(`^/scanner-detail/${ID}/serial-numbers$`),
    new RegExp(`^/scanner-detail/serial-number/${ID}$`),
  ],
};

/**
 * Whether a collector token may call `method url`. `url` is the request URL as received,
 * e.g. `/api/v1/machine-cycle?x=1`. Writes are further limited by the Lapper write policy
 * (a collector may only create pending gearsets, never edit setup data).
 */
export function collectorTokenAllows(method: string, url: string): boolean {
  const path = url.split('?')[0].replace(/\/+$/, '');
  const match = /^\/api\/v1(\/.*)$/.exec(path);
  if (!match || match[1].includes('..')) return false;
  return (ALLOWED[method.toUpperCase()] ?? []).some((pattern) => pattern.test(match[1]));
}
