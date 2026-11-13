import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Shared request-integrity helpers used by idempotent server endpoints.
 *
 * canonicalJson sorts object keys with localeCompare and drops undefined
 * properties so the same logical request always hashes to the same digest.
 * Changing the ordering changes every stored request_sha256, so keep it stable.
 * (The Print Agent claim-token HMAC deliberately uses its own code-point order.)
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 hex digest of canonicalJson(value). */
export function canonicalJsonSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

const LOWERCASE_SHA256_HEX = /^[0-9a-f]{64}$/;

/** Constant-time comparison of two lowercase SHA-256 hex digests; malformed input is never equal. */
export function safeDigestEqual(left: string, right: string): boolean {
  if (!LOWERCASE_SHA256_HEX.test(left) || !LOWERCASE_SHA256_HEX.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

/** TypeORM PostgreSQL UPDATE RETURNING is [rows, affectedCount].
 * Do not count that envelope as two updated rows. Require exactly one returned
 * row whose id equals the expected positive integer id; zero, multiple,
 * malformed or wrong-ID results fail. A plain returned-row array is supported
 * for compatible query adapters.
 */
export function exactlyOneRowUpdated(result: unknown, expectedId: number | string): boolean {
  const rowId = (value: unknown): string | null => {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    }
    if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
      && Number.isSafeInteger(Number(value))) return value;
    return null;
  };
  const expected = rowId(expectedId);
  if (expected === null || !Array.isArray(result)) return false;
  let rows: unknown[];
  if (result.length === 2 && Array.isArray(result[0])) {
    if (result[1] !== 1 || result[0].length !== 1) return false;
    rows = result[0];
  } else {
    rows = result;
  }
  if (rows.length !== 1 || rows[0] === null || typeof rows[0] !== 'object'
    || Array.isArray(rows[0])) return false;
  return rowId((rows[0] as { id?: unknown }).id) === expected;
}

/**
 * Rows returned by a raw `query()` call.
 *
 * TypeORM's PostgreSQL driver returns `[rows, affectedCount]` for UPDATE … RETURNING
 * and DELETE … RETURNING (including a WITH … UPDATE), but a plain row array for
 * SELECT and INSERT … RETURNING. Always pass UPDATE/DELETE results through this,
 * otherwise `.length` is 2 and `[0]` is the whole row array.
 */
export function returnedRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!Array.isArray(result)) throw new Error('Unexpected database result.');
  if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    if (!Number.isSafeInteger(result[1]) || result[1] < 0) throw new Error('Unexpected database row count.');
    return result[0] as T[];
  }
  return result as T[];
}
