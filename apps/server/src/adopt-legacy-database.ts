import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

const logger = new Logger('DatabaseName');

/** The database name used before the rename to MeshForge. */
export const LEGACY_DATABASE_NAME = 'GearApps';
export const DATABASE_NAME = 'MeshForge';

function readEnvironmentFile(path: string): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

type Query = (sql: string, parameters?: unknown[]) => Promise<unknown>;

/** Runs `work` against the server's maintenance database, with the API's own credentials. */
async function withMaintenanceDatabase(
  environment: NodeJS.ProcessEnv,
  work: (query: Query) => Promise<void>,
): Promise<void> {
  const database = new DataSource({
    type: 'postgres',
    host: environment['DATABASE_HOST'],
    port: Number(environment['DATABASE_PORT']),
    username: environment['DATABASE_USERNAME'],
    password: environment['DATABASE_PASSWORD'],
    database: 'postgres',
    synchronize: false,
    logging: false,
    connectTimeoutMS: 5000,
  });
  await database.initialize();
  try {
    await work((sql, parameters) => database.query(sql, parameters));
  } finally {
    await database.destroy();
  }
}

/**
 * A database created before the rename is called `GearApps`. When the API is configured for
 * `MeshForge`, that database does not exist yet and `GearApps` does, the old one is renamed in
 * place. Nothing else is touched, and the API still starts if the rename cannot be done: the
 * normal connection error then names the missing database.
 */
export async function adoptLegacyDatabaseName(
  processEnvironment: NodeJS.ProcessEnv = process.env,
  connect: typeof withMaintenanceDatabase = withMaintenanceDatabase,
  environmentFile = '.env',
): Promise<void> {
  // The same precedence the configuration module uses: real environment variables win over the file.
  const environment: NodeJS.ProcessEnv = { ...readEnvironmentFile(environmentFile), ...processEnvironment };
  if ((environment['DATABASE_TYPE'] ?? 'postgres') !== 'postgres') return;
  if (!environment['DATABASE_HOST'] || environment['DATABASE_NAME'] !== DATABASE_NAME) return;
  try {
    await connect(environment, async (query) => {
      const rows = (await query('SELECT datname FROM pg_database WHERE datname = ANY($1)', [
        [DATABASE_NAME, LEGACY_DATABASE_NAME],
      ])) as Array<{ datname: string }>;
      const names = rows.map((row) => row.datname);
      if (names.includes(DATABASE_NAME) || !names.includes(LEGACY_DATABASE_NAME)) return;
      await query(`ALTER DATABASE "${LEGACY_DATABASE_NAME}" RENAME TO "${DATABASE_NAME}"`);
      logger.log(`Renamed the database ${LEGACY_DATABASE_NAME} to ${DATABASE_NAME}.`);
    });
  } catch (error) {
    logger.warn(
      `Could not check for a ${LEGACY_DATABASE_NAME} database to rename. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
