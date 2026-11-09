import { registerAs } from '@nestjs/config';

export type DatabaseType = 'mssql' | 'postgres' | 'better-sqlite3';

export const appConfig = registerAs('app', () => ({
  host: process.env['HOST'] ?? '0.0.0.0',
  port: parseInt(process.env['PORT'] ?? '3333', 10),
  environment: process.env['ENVIRONMENT'] ?? 'development',
  /** Comma-separated list of allowed CORS origins. Empty = same-origin only (behind nginx proxy). */
  corsOrigins: (process.env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  swaggerEnabled: (process.env['SWAGGER_ENABLED'] ?? 'true') === 'true',
}));

export const dbConfig = registerAs('db', () => ({
  type: (process.env['DATABASE_TYPE'] ?? 'better-sqlite3') as DatabaseType,
  host: process.env['DATABASE_HOST'],
  port: process.env['DATABASE_PORT'] ? parseInt(process.env['DATABASE_PORT'], 10) : undefined,
  username: process.env['DATABASE_USERNAME'],
  password: process.env['DATABASE_PASSWORD'],
  name: process.env['DATABASE_NAME'],
  /** SQLite file path (dev only). */
  path: process.env['DATABASE_PATH'] ?? 'tmp/gearapps.sqlite',
  synchronize: (process.env['DATABASE_SYNCHRONIZE'] ?? 'false') === 'true',
  logging: (process.env['DATABASE_LOGGING_ENABLED'] ?? 'false') === 'true',
  /** MSSQL named instance, e.g. SQLEXPRESS. */
  instanceName: process.env['DATABASE_INSTANCE'],
  /** Postgres: require TLS to the server (managed DBs usually do). */
  ssl: (process.env['DATABASE_SSL'] ?? 'false') === 'true',
  /** Postgres schema (defaults to public). */
  schema: process.env['DATABASE_SCHEMA'],
}));

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env['JWT_SECRET'] as string,
  expiresIn: process.env['JWT_ACCESS_TOKEN_EXPIRES_IN'] ?? '10h',
}));

/** Scanner HTTP API + FTP image drop used by the lapping-cell live view. */
export const scannerConfig = registerAs('scanner', () => ({
  /** Default scanner host used when a scanner record has no IP. */
  defaultHost: process.env['SCANNER_DEFAULT_HOST'] ?? '',
  /** Accept self-signed certs from scanners on the plant network. */
  allowInsecureTls: (process.env['SCANNER_ALLOW_INSECURE_TLS'] ?? 'true') === 'true',
  timeoutMs: parseInt(process.env['SCANNER_TIMEOUT_MS'] ?? '4000', 10),
  ftp: {
    host: process.env['SCANNER_FTP_HOST'] ?? '',
    user: process.env['SCANNER_FTP_USER'] ?? '',
    password: process.env['SCANNER_FTP_PASSWORD'] ?? '',
    /** Root folder on the FTP server; images live at `<root>/<scanner-ip>/scanner-current.jpg`. */
    root: process.env['SCANNER_FTP_ROOT'] ?? '181-lapper-scanners',
    imageFile: process.env['SCANNER_FTP_IMAGE_FILE'] ?? 'scanner-current.jpg',
  },
}));

export const configLoaders = [appConfig, dbConfig, jwtConfig, scannerConfig];
