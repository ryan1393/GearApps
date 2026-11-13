import { canonicalJsonSha256 } from '@truck-log/server/data-access';

export { canonicalJson, safeDigestEqual } from '@truck-log/server/data-access';

export function requestDigest(value: unknown): string {
  return canonicalJsonSha256(value);
}

export function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
}

export function boundedAuditActor(value: string | null | undefined): string | null {
  const cleaned = cleanOptional(value);
  return cleaned ? cleaned.slice(0, 120) : null;
}
