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
  origin: string[];
  credentials: boolean;
}

/**
 * CORS options from the CORS_ORIGINS setting. Cross-origin access stays off (null) unless the
 * setting lists exact origins, such as http://server:4200,http://server:4201. `*` and empty
 * also leave it off: the web clients call the API on their own origin through nginx, and the
 * API sends bearer tokens, not cookies, so no browser client needs another origin.
 */
export function parseCorsOrigins(value: string | undefined | null): ApiCorsOptions | null {
  const origins = String(value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin && origin !== '*');
  return origins.length ? { origin: origins, credentials: false } : null;
}
