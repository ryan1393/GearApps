/**
 * HTTP settings the API entry point applies to Express: which proxies are trusted for the
 * client address, and which browser origins may call the API.
 */

export const DEFAULT_TRUST_PROXY = 'loopback, uniquelocal';

const TRUST_PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);
const ADDRESS = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

/**
 * Express "trust proxy" value from the TRUST_PROXY setting: true/false, a hop count, or a comma
 * separated list of the names loopback, linklocal, uniquelocal and IP addresses or CIDR ranges.
 * Returns null when the text is not one of those forms.
 */
export function parseTrustProxy(value: string | undefined | null): boolean | number | string[] | null {
  const text = (value ?? DEFAULT_TRUST_PROXY).trim();
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text) || text === '') return false;
  if (/^\d+$/.test(text)) return Number(text);
  const entries = text.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) return null;
  return entries.every((entry) => TRUST_PROXY_NAMES.has(entry.toLowerCase()) || ADDRESS.test(entry))
    ? entries.map((entry) => (TRUST_PROXY_NAMES.has(entry.toLowerCase()) ? entry.toLowerCase() : entry))
    : null;
}

export interface ApiCorsOptions {
  origin: '*' | string[];
  credentials: boolean;
}

/**
 * CORS options from the CORS_ORIGINS setting. `*` allows any origin without credentials; a
 * comma separated list allows exactly those origins. Empty turns cross-origin access off (null).
 */
export function parseCorsOrigins(value: string | undefined | null): ApiCorsOptions | null {
  const text = (value ?? '*').trim();
  if (!text) return null;
  const origins = text.split(',').map((origin) => origin.trim().replace(/\/+$/, '')).filter(Boolean);
  if (origins.includes('*')) return { origin: '*', credentials: false };
  return origins.length ? { origin: origins, credentials: true } : null;
}
