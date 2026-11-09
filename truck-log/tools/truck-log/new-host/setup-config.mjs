/**
 * Pure new-host configuration helpers used by setup contract tests.
 *
 * The production installers are SETUP-TRUCK-LOG.cmd and SETUP-TRUCK-LOG.sh.
 * Keep host mutation in those platform-native entry points; this module stays
 * side-effect free so environment preparation can be tested without Docker.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../VERSION'), 'utf8').trim();

export const VOLUMES = Object.freeze([
  'truck-log-postgres-data',
  'truck-log-documents',
  'truck-log-rxo-import',
  'truck-log-rxo-data',
  'truck-log-rxo-state',
  'truck-log-rxo-credentials',
  'truck-log-rxo-expedite-data',
  'truck-log-rxo-expedite-state',
]);

export function parseEnv(text) {
  const map = new Map();
  for (const line of String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) throw new Error('Unrecognized .env line; preserve and review it before setup.');
    if (map.has(match[1])) throw new Error(`Duplicate .env key ${match[1]}.`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map.set(match[1], value);
  }
  return map;
}

export function prepareEnv(existing, template, origin, random = () => {
  throw new Error('A cryptographically secure random generator must be supplied by the installer.');
}) {
  const before = parseEnv(existing);
  const desired = parseEnv(template);
  for (const [key, value] of before) desired.set(key, value);

  desired.set('TRUCK_LOG_DATABASE_HOST', 'truck-log-postgres');
  desired.set('TRUCK_LOG_DATABASE_PORT', '5432');
  desired.set('TRUCK_LOG_DATABASE_SYNCHRONIZE', 'false');
  desired.set('TRUCK_LOG_RELEASE', RELEASE);

  const existingClaimSecret = desired.get('TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET') || '';
  if (existingClaimSecret && !/^[0-9a-fA-F]{64}$/.test(existingClaimSecret)) {
    throw new Error('Existing claim-token secret is invalid; it was not replaced.');
  }
  if (!before.has('TRUCK_LOG_DATABASE_PASSWORD')) {
    const candidate = desired.get('TRUCK_LOG_DATABASE_PASSWORD') || '';
    if (!candidate || /^(CHANGE_ME|api)$/i.test(candidate)) desired.set('TRUCK_LOG_DATABASE_PASSWORD', random());
  }
  if (!existingClaimSecret) desired.set('TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET', random());
  if (!/^[0-9a-fA-F]{64}$/.test(desired.get('TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET') || '')) {
    throw new Error('Generated claim-token secret is invalid.');
  }
  if (!before.has('TRUCK_LOG_PUBLIC_ORIGIN')) desired.set('TRUCK_LOG_PUBLIC_ORIGIN', origin);
  if (!before.has('TRUCK_LOG_CORS_ORIGINS')) {
    desired.set('TRUCK_LOG_CORS_ORIGINS', origin === 'http://localhost:4300' ? origin : `http://localhost:4300,${origin}`);
  }
  for (const key of ['TRUCK_LOG_DATABASE_USERNAME', 'TRUCK_LOG_DATABASE_PASSWORD', 'TRUCK_LOG_DATABASE_NAME']) {
    if (!desired.get(key)) throw new Error(`Missing ${key}.`);
  }

  const eol = String(existing).includes('\r\n') ? '\r\n' : '\n';
  let output = String(existing ?? '').replace(/^\uFEFF/, '');
  for (const [key, value] of desired) {
    if (before.has(key) && before.get(key) === value) continue;
    if (/[\r\n]/.test(value)) throw new Error(`Invalid multiline ${key}.`);
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(output)) output = output.replace(pattern, line);
    else output += (output && !output.endsWith('\n') ? eol : '') + line + eol;
  }
  return output;
}
