/**
 * The server settings shown in Admin > Server Settings.
 *
 * Every key of the validation schema is listed here once. A setting an administrator saves on
 * that page is kept in the database and laid over the server environment (.env / Docker) the
 * next time the API starts, so the environment file stays the starting point and the fallback.
 *
 * Settings the API needs before it can read the database, the secrets that sign logins, and
 * settings that name files on the server are listed but locked: they stay in the environment.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import { validationSchema } from './schema';

export type EnvironmentSettingType = 'text' | 'number' | 'boolean' | 'select' | 'multiline';

export interface EnvironmentSettingDefinition {
  key: string;
  label: string;
  help?: string;
  type: EnvironmentSettingType;
  options?: readonly string[];
  /** The value is never sent to the browser and is encrypted in the database. */
  secret?: boolean;
  /** Why the setting can only be changed in the server environment. Absent when it is editable. */
  locked?: string;
}

export interface EnvironmentSettingGroup {
  id: string;
  title: string;
  description: string;
  settings: readonly EnvironmentSettingDefinition[];
}

const STARTUP = 'The API needs this before it can read saved settings. Change it in the server environment (.env).';
const SIGNING = 'This secret signs every login and protects saved passwords. Change it in the server environment (.env).';
const SERVER_FILE = 'This names a file or folder on the server. Change it in the server environment (.env).';
const API_PATH = 'Every client and collector calls the API at this path. Change it in the server environment (.env).';

const text = (key: string, label: string, help?: string, extra: Partial<EnvironmentSettingDefinition> = {}): EnvironmentSettingDefinition =>
  ({ key, label, help, type: 'text', ...extra });
const number = (key: string, label: string, help?: string, extra: Partial<EnvironmentSettingDefinition> = {}): EnvironmentSettingDefinition =>
  ({ key, label, help, type: 'number', ...extra });
const flag = (key: string, label: string, help?: string, extra: Partial<EnvironmentSettingDefinition> = {}): EnvironmentSettingDefinition =>
  ({ key, label, help, type: 'boolean', ...extra });
const choice = (key: string, label: string, options: readonly string[], help?: string, extra: Partial<EnvironmentSettingDefinition> = {}): EnvironmentSettingDefinition =>
  ({ key, label, help, type: 'select', options, ...extra });
const secret = (key: string, label: string, help?: string, extra: Partial<EnvironmentSettingDefinition> = {}): EnvironmentSettingDefinition =>
  ({ key, label, help, type: 'text', secret: true, ...extra });

export const ENVIRONMENT_SETTING_GROUPS: readonly EnvironmentSettingGroup[] = [
  {
    id: 'server',
    title: 'API server',
    description: 'How the API is reached and what it publishes.',
    settings: [
      choice('ENVIRONMENT', 'Environment', ['development', 'production', 'local', 'test', 'docker'], undefined, { locked: STARTUP }),
      text('SERVER_HOST', 'Listen address', undefined, { locked: STARTUP }),
      number('SERVER_PORT', 'Listen port', undefined, { locked: STARTUP }),
      text('API_PREFIX', 'API path prefix', undefined, { locked: API_PATH }),
      text('API_VERSION', 'API version', undefined, { locked: API_PATH }),
      text('CORS_ORIGINS', 'Allowed web origins', 'Comma separated, or * for any.'),
      text('PUBLIC_API_BASE_URL', 'Public API address', 'The address users reach the API at, for example http://server:3333.'),
      text('PUBLIC_WEB_BASE_URL', 'Public web address', 'Used in the links of password emails. Scheme, host and port only.'),
      flag('ENABLE_SWAGGER', 'API documentation page', 'Serves the Swagger page.'),
      flag('GENERATE_SWAGGER_JSON', 'Write Swagger file at startup'),
      text('SWAGGER_JSON_FILE', 'Swagger file', undefined, { locked: SERVER_FILE }),
      secret('SENTRY_DSN', 'Sentry DSN', 'Leave blank to turn error reporting off.'),
    ],
  },
  {
    id: 'sign-in',
    title: 'Sign-in',
    description: 'Login sessions and Google sign-in.',
    settings: [
      text('JWT_ACCESS_EXPIRATION_TIME', 'Access token lifetime', 'For example 3600s or 1h.'),
      text('JWT_REFRESH_EXPIRATION_TIME', 'Refresh token lifetime', 'For example 86400s or 1d.'),
      secret('JWT_ACCESS_SECRET', 'Access token secret', undefined, { locked: SIGNING }),
      secret('JWT_REFRESH_SECRET', 'Refresh token secret', undefined, { locked: SIGNING }),
      flag('SOCIAL_GOOGLE_ENABLED', 'Google sign-in'),
      text('SOCIAL_GOOGLE_CLIENT_ID', 'Google client ID'),
      secret('SOCIAL_GOOGLE_CLIENT_SECRET', 'Google client secret'),
    ],
  },
  {
    id: 'database',
    title: 'Database',
    description: 'The MeshForge database connection.',
    settings: [
      choice('DATABASE_TYPE', 'Database type', ['postgres', 'better-sqlite3'], undefined, { locked: STARTUP }),
      text('DATABASE_HOST', 'Host', undefined, { locked: STARTUP }),
      number('DATABASE_PORT', 'Port', undefined, { locked: STARTUP }),
      text('DATABASE_NAME', 'Database name', undefined, { locked: STARTUP }),
      text('DATABASE_USERNAME', 'User', undefined, { locked: STARTUP }),
      secret('DATABASE_PASSWORD', 'Password', undefined, { locked: STARTUP }),
      text('DATABASE_PATH', 'SQLite file', undefined, { locked: STARTUP }),
      flag('DATABASE_SYNCHRONIZE', 'Create schema from entities', undefined, { locked: 'Only for building an empty database. Change it in the server environment (.env).' }),
      flag('DATABASE_LOGGING_ENABLED', 'Log every query', 'Verbose. Use only while investigating a problem.'),
      secret('SEED_ADMIN_PASSWORD', 'First admin password', undefined, { locked: 'Used once, when an empty database is set up. Change it in the server environment (.env).' }),
      secret('SEED_USER_PASSWORD', 'First user password', undefined, { locked: 'Used once, when an empty database is set up. Change it in the server environment (.env).' }),
    ],
  },
  {
    id: 'email',
    title: 'Email',
    description: 'The mail server used for password emails.',
    settings: [
      flag('EMAIL_ENABLED', 'Send email'),
      text('EMAIL_HOST', 'Mail server'),
      number('EMAIL_PORT', 'Port'),
      text('EMAIL_USER', 'User'),
      secret('EMAIL_PASSWORD', 'Password'),
      text('EMAIL_DEFAULT_NAME', 'From name'),
      text('EMAIL_DEFAULT_EMAIL', 'From address'),
      flag('EMAIL_SECURE', 'Connect with TLS'),
      flag('EMAIL_REQUIRE_TLS', 'Require STARTTLS'),
      flag('EMAIL_IGNORE_TLS', 'Never use STARTTLS'),
      flag('EMAIL_DEBUG', 'Log mail conversations'),
      text('EMAIL_TEMPLATE_DIR', 'Template folder', undefined, { locked: SERVER_FILE }),
      text('EMAIL_PARTIALS_DIR', 'Template partials folder', undefined, { locked: SERVER_FILE }),
    ],
  },
  {
    id: 'label-printer',
    title: 'Fallback tag printer',
    description: 'Used only until a default tag printer is chosen in Label Printers.',
    settings: [
      text('GEAR_LABEL_PRINTER_HOST', 'Printer address', 'Leave blank to download the tag file instead.'),
      number('GEAR_LABEL_PRINTER_PORT', 'Port'),
      choice('GEAR_LABEL_PRINTER_LANGUAGE', 'Printer language', ['IPL', 'ZPL']),
      number('GEAR_LABEL_PRINTER_TIMEOUT_MS', 'Timeout (ms)', '250 to 60000.'),
    ],
  },
  {
    id: 'greenshed',
    title: 'Greenshed quality checks',
    description: 'How often a running machine must be checked.',
    settings: [
      number(
        'GREENSHED_CHECK_INTERVAL',
        'Pieces between quality checks',
        '1 to 10000. Running machines use the new interval from their last check once the API restarts.',
      ),
    ],
  },
  {
    id: 'lapping',
    title: 'Lapping and scanners',
    description: 'Lapper time zone, the scanner connections and Argonaut.',
    settings: [
      text('LAPPER_TIME_ZONE', 'Lapper time zone', 'An IANA zone, for example America/Indianapolis.'),
      text('SCANNER_DEFAULT_HOST', 'Default scanner address'),
      flag('SCANNER_ALLOW_INSECURE_TLS', 'Accept scanner self-signed certificates'),
      number('SCANNER_TIMEOUT_MS', 'Scanner timeout (ms)'),
      text('SCANNER_FTP_HOST', 'Scanner FTP server'),
      text('SCANNER_FTP_USER', 'Scanner FTP user'),
      secret('SCANNER_FTP_PASSWORD', 'Scanner FTP password'),
      text('SCANNER_FTP_ROOT', 'Scanner FTP folder'),
      text('SCANNER_FTP_IMAGE_FILE', 'Scanner image file name'),
      text(
        'LAPPER_READ_TOKEN_FILE',
        'Docker collector token file',
        'Set by Docker Compose. Lapper > Collector Tokens > Connect Docker collector writes the collector\'s token here.',
        { locked: SERVER_FILE },
      ),
      // Lapper Read reads these from the API (GET /api/v1/lapper-read/argonaut) on each machine check.
      text('LAPPER_READ_ARGONAUT_URL', 'Argonaut address', 'trigger-transaction URL used when a machine has none in Admin > Lapping machines. Lapper Read uses it while LAPPER_READ_ARGONAUT_ENABLED is true.'),
      text('LAPPER_READ_ARGONAUT_LOCATION_ID', 'Argonaut location ID', 'Used when the machine and the address have none.'),
      text('LAPPER_READ_ARGONAUT_USERNAME', 'Argonaut user', 'Basic sign-in sent with every Argonaut transaction. User and password both empty sign in as the original C# Lapper Read did (user / pw).'),
      secret('LAPPER_READ_ARGONAUT_PASSWORD', 'Argonaut password'),
      number('LAPPER_READ_ARGONAUT_TRANSACTION_TYPE_ID', 'Argonaut transaction type', 'Track and Trace transaction type, normally 100.'),
      text('LAPPER_READ_STATUS_URL', 'Lapper Read status address', 'Where the API asks the collector for live macro values (Cycle Test Lab > Read values from machine). In Docker: http://lapper-read:8080.'),
      flag('LAPPER_READ_ARGONAUT_VERIFY_TLS', 'Verify the Argonaut certificate', 'Off accepts a self-signed certificate, as the original C# Lapper Read did.'),
    ],
  },
  {
    id: 'dsf',
    title: 'DSF production counts',
    description: 'Read-only counts from Digital Shop Floor, with optional plant-wide history stored in MeshForge. Nothing is written to DSF.',
    settings: [
      flag('DSF_COUNT_ENABLED', 'Read DSF counts', 'Shows a DSF Count column on Running Machines.'),
      flag('DSF_HISTORY_ENABLED', 'Keep plant count history', 'Records all DSF sources, including grinders and named departments, in MeshForge. Read DSF counts must also be enabled.'),
      number('DSF_HISTORY_LOOKBACK_DAYS', 'Recent history to reconcile (days)', '1 to 31; default 7. Initial history and recent corrections are read in bounded windows. Saved records are retained indefinitely.'),
      flag('DSF_CUTTER_WRITE_ENABLED', 'Credit DSF production to cutters', 'Only applies while DSF counts are read.'),
      number('DSF_COUNT_INTERVAL_SECONDS', 'Read every (seconds)', '30 to 3600.'),
      text('DSF_COUNT_MACHINES', 'Reference-mapped machines', 'Machine numbers, comma separated. Machines mapped in DSF Mappings need not be listed.'),
      text('DSF_DEPARTMENT_NAMES', 'Named DSF departments', 'DSF departments not named like "Dept. 132", as NAME=MeshForge department, comma separated. Empty means CUTTER GRIND=45 (the CutGrind grinders).'),
      text('DSF_DB_HOST', 'DSF database host'),
      number('DSF_DB_PORT', 'DSF database port'),
      text('DSF_DB_NAME', 'DSF database name'),
      text('DSF_DB_USER', 'DSF database user'),
      secret('DSF_DB_PASSWORD', 'DSF database password'),
      text('DSF_DB_PASSWORD_FILE', 'DSF password file', undefined, { locked: SERVER_FILE }),
      choice('DSF_DB_SSL_MODE', 'DSF connection security', ['verify-full', 'disable']),
      text('DSF_DB_SSL_CA_FILE', 'DSF certificate authority file', undefined, { locked: SERVER_FILE }),
      { key: 'DSF_DB_SSL_CA_PEM', label: 'DSF certificate authority (PEM)', type: 'multiline' },
      text('DSF_PRIVILEGED_READER_ACK', 'Privileged reader acknowledgement', undefined, {
        locked: 'A deliberate safety acknowledgement; see DSF_COUNTS.md. Change it in the server environment (.env).',
      }),
    ],
  },
];

export const ENVIRONMENT_SETTINGS: readonly EnvironmentSettingDefinition[] = ENVIRONMENT_SETTING_GROUPS.flatMap((group) => group.settings);
const DEFINITIONS = new Map(ENVIRONMENT_SETTINGS.map((setting) => [setting.key, setting]));

export function environmentSetting(key: string): EnvironmentSettingDefinition | undefined {
  return DEFINITIONS.get(key);
}

export type EnvironmentValues = Record<string, string | undefined>;

export const ENVIRONMENT_SETTINGS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS public.gear_environment_settings (
  key text PRIMARY KEY CHECK (key ~ '^[A-Z][A-Z0-9_]*$'),
  value text NOT NULL,
  encrypted boolean NOT NULL DEFAULT false,
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
)`;

/** Checks a whole environment the way the API does at startup. Returns the problems, in plain words. */
export function environmentProblems(values: EnvironmentValues): string[] {
  const { error } = validationSchema.validate(values, { allowUnknown: true, abortEarly: false });
  // Joi quotes the rejected value in some messages; it is left out so a secret never reaches a log.
  return error ? error.details.map((detail) => detail.message.replace(/ with value ".*" fails/s, ' fails').replace(/"/g, '')) : [];
}

/** The environment with the schema defaults filled in, as text. Falls back to the raw values if it is not valid. */
export function environmentWithDefaults(values: EnvironmentValues): EnvironmentValues {
  const { error, value } = validationSchema.validate(values, { allowUnknown: true, abortEarly: false });
  if (error) return { ...values };
  const result: EnvironmentValues = {};
  for (const { key } of ENVIRONMENT_SETTINGS) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined && item !== null) result[key] = String(item);
  }
  return result;
}

// Saved secrets are encrypted with a key derived from the access-token secret, which never
// leaves the server environment. A database copy alone does not reveal them.
const cipherKey = (signingSecret: string) => scryptSync(signingSecret, 'gear-environment-settings', 32);

export function encryptEnvironmentValue(value: string, signingSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cipherKey(signingSecret), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

/** Null when the value cannot be read, for example after the access-token secret was changed. */
export function decryptEnvironmentValue(stored: string, signingSecret: string): string | null {
  const [version, iv, tag, body] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || body === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', cipherKey(signingSecret), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export interface StoredEnvironmentSetting {
  key: string;
  value: string;
  encrypted: boolean;
}

export interface EnvironmentOverlay {
  /** Saved values that are editable settings and could be read. */
  values: Record<string, string>;
  /** Saved keys that were skipped: no longer a setting, locked, or an unreadable secret. */
  skipped: string[];
}

/** Turns saved rows into the values to lay over the environment. Locked and unknown keys are never applied. */
export function readEnvironmentOverlay(rows: readonly StoredEnvironmentSetting[], signingSecret: string | undefined): EnvironmentOverlay {
  const overlay: EnvironmentOverlay = { values: {}, skipped: [] };
  for (const row of rows) {
    const definition = DEFINITIONS.get(row.key);
    const value = !definition || definition.locked ? null
      : !row.encrypted ? row.value
        : signingSecret ? decryptEnvironmentValue(row.value, signingSecret) : null;
    if (value === null) overlay.skipped.push(row.key);
    else overlay.values[row.key] = value;
  }
  return overlay;
}

export interface EnvironmentStartupState {
  /** The server environment (.env / Docker) before saved settings were applied. */
  baseline: EnvironmentValues;
  /** The saved settings this API process started with. */
  applied: Record<string, string>;
}

let startupState: EnvironmentStartupState | null = null;

/** Recorded once by the API entry point, before the application module is loaded. */
export function recordEnvironmentStartupState(state: EnvironmentStartupState): void {
  startupState = state;
}

export function environmentStartupState(): EnvironmentStartupState {
  return startupState ?? { baseline: { ...process.env }, applied: {} };
}
