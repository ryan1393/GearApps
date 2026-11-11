import { NestFactory } from '@nestjs/core';
import {
  SeedModule,
  UserDatabaseSeedService,
} from '@meshforge/manufacturing/server/data-access';
import { DataSource } from 'typeorm';
import { withValidatedEmptyBootstrap } from '@meshforge/manufacturing/server/util-common';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

async function inspectPublicTables(): Promise<string[]> {
  const probe = new DataSource({
    type: 'postgres',
    host: required('DATABASE_HOST'),
    port: Number(required('DATABASE_PORT')),
    username: required('DATABASE_USERNAME'),
    password: required('DATABASE_PASSWORD'),
    database: required('DATABASE_NAME'),
    synchronize: false,
    logging: false,
  });

  await probe.initialize();
  try {
    const rows = (await probe.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    )) as Array<{ table_name: string }>;
    return rows.map((row) => row.table_name);
  } finally {
    await probe.destroy();
  }
}

async function bootstrap(): Promise<void> {
  if (process.env['DANA_FRESH_DB_BOOTSTRAP'] !== 'YES') {
    throw new Error('DANA_FRESH_DB_BOOTSTRAP=YES is required for the one-shot bootstrap service.');
  }

  const tables = await inspectPublicTables();
  const tableSet = new Set(tables);
  const expectedExisting = ['users', 'departments', 'trays', 'cutter_builds'];

  if (tables.length > 0) {
    const missing = expectedExisting.filter((name) => !tableSet.has(name));
    if (missing.length) {
      throw new Error(
        `Database is not empty but is missing expected Gear tables: ${missing.join(', ')}. Refusing automatic synchronize against a partial schema.`,
      );
    }
    process.env['DATABASE_SYNCHRONIZE'] = 'false';
    console.log(`[PASS] Existing Gear schema detected (${tables.length} public tables); synchronize remains disabled.`);
  } else {
    const adminPassword = required('SEED_ADMIN_PASSWORD');
    const userPassword = required('SEED_USER_PASSWORD');
    if (adminPassword.length < 12 || userPassword.length < 12) {
      throw new Error('SEED_ADMIN_PASSWORD and SEED_USER_PASSWORD must each be at least 12 characters for a fresh database.');
    }
    process.env['DATABASE_SYNCHRONIZE'] = 'true';
    console.log('[INFO] Empty Gear database detected; enabling TypeORM synchronize for this one-shot bootstrap only.');
  }

  const createContext=()=>NestFactory.createApplicationContext(SeedModule, {
    logger: ['log', 'warn', 'error'],
  });
  const app=tables.length===0 ? await withValidatedEmptyBootstrap(createContext):await createContext();

  try {
    await app.get(UserDatabaseSeedService).seed();
  } finally {
    await app.close();
  }

  const verifiedTables = new Set(await inspectPublicTables());
  const missingAfterBootstrap = expectedExisting.filter((name) => !verifiedTables.has(name));
  if (missingAfterBootstrap.length) {
    throw new Error(
      `Gear schema verification failed after bootstrap; missing: ${missingAfterBootstrap.join(', ')}`,
    );
  }

  console.log(`[PASS] Gear database bootstrap completed and verified (${verifiedTables.size} public tables). Runtime API will start with DATABASE_SYNCHRONIZE=false.`);
}

void bootstrap().catch((error: unknown) => {
  console.error('[FAIL] Gear database bootstrap failed:', error);
  process.exitCode = 1;
});
