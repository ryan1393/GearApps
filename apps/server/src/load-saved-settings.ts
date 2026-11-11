import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import {
  environmentProblems,
  EnvironmentValues,
  readEnvironmentOverlay,
  recordEnvironmentStartupState,
  StoredEnvironmentSetting,
} from '@meshforge/manufacturing/server/util-common';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

const logger = new Logger('SavedSettings');

function readEnvironmentFile(path: string): EnvironmentValues {
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

async function readSavedRows(environment: EnvironmentValues): Promise<StoredEnvironmentSetting[]> {
  const database = new DataSource({
    type: 'postgres',
    host: environment['DATABASE_HOST'],
    port: Number(environment['DATABASE_PORT']),
    username: environment['DATABASE_USERNAME'],
    password: environment['DATABASE_PASSWORD'],
    database: environment['DATABASE_NAME'],
    synchronize: false,
    logging: false,
    connectTimeoutMS: 5000,
  });
  await database.initialize();
  try {
    const [table] = (await database.query(`SELECT to_regclass('public.gear_environment_settings') AS name`)) as Array<{ name: string | null }>;
    if (!table?.name) return [];
    return (await database.query('SELECT key, value, encrypted FROM public.gear_environment_settings')) as StoredEnvironmentSetting[];
  } finally {
    await database.destroy();
  }
}

/**
 * Lays the settings saved in Admin > Server Settings over the server environment. Runs before
 * the application module is loaded, because that is when the environment is validated and read.
 *
 * The API always starts: if the saved settings cannot be read, or would make the environment
 * invalid, they are left out and the environment file alone is used.
 */
export async function applySavedEnvironmentSettings(
  environment: NodeJS.ProcessEnv = process.env,
  readRows: (environment: EnvironmentValues) => Promise<StoredEnvironmentSetting[]> = readSavedRows,
  environmentFile = '.env',
): Promise<void> {
  // The same precedence the configuration module uses: real environment variables win over the file.
  const baseline: EnvironmentValues = { ...readEnvironmentFile(environmentFile), ...environment };
  let applied: Record<string, string> = {};
  if ((baseline['DATABASE_TYPE'] ?? 'postgres') === 'postgres' && baseline['DATABASE_HOST']) {
    try {
      const overlay = readEnvironmentOverlay(await readRows(baseline), baseline['JWT_ACCESS_SECRET']);
      if (overlay.skipped.length) logger.warn(`Saved settings not applied (locked, removed or unreadable): ${overlay.skipped.join(', ')}`);
      const problems = environmentProblems({ ...baseline, ...overlay.values });
      if (problems.length) {
        logger.error(`Saved settings were not applied because the result would not be valid: ${problems.join('; ')}`);
      } else {
        applied = overlay.values;
        Object.assign(environment, applied);
        const keys = Object.keys(applied);
        if (keys.length) logger.log(`Applied ${keys.length} saved setting(s): ${keys.join(', ')}`);
      }
    } catch (error) {
      logger.warn(`Saved settings could not be read; using the server environment only. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  recordEnvironmentStartupState({ baseline, applied });
}
