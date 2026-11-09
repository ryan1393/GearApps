/**
 * Read-only schema drift check.
 *
 * Compares the TypeORM entity definitions in this release with a live database
 * and prints the SQL TypeORM *would* run to make them match. Nothing is executed.
 *
 *   npm run db:check-drift               (reads DATABASE_* from the environment / .env)
 *
 * Exit code 0 = no drift, 2 = drift found, 1 = could not connect / error.
 *
 * Statements that DROP something are flagged: on this database they usually mean a
 * column or index added by the startup schema routines that the entities don't
 * declare. Those are expected and must never be applied with DATABASE_SYNCHRONIZE.
 */
import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

function loadDotEnv(): void {
  const file = join(process.cwd(), '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

async function main(): Promise<number> {
  loadDotEnv();
  const env = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing ${k}`);
    return v;
  };
  const source = new DataSource({
    type: 'postgres',
    host: env('DATABASE_HOST'),
    port: Number(env('DATABASE_PORT')),
    username: env('DATABASE_USERNAME'),
    password: env('DATABASE_PASSWORD'),
    database: env('DATABASE_NAME'),
    entities: [join(process.cwd(), 'libs/server/data-access/src/lib/database/entities/**/*.orm-entity.ts')],
    synchronize: false,
    logging: false,
  });
  await source.initialize();
  try {
    const log = await source.driver.createSchemaBuilder().log();
    const statements = log.upQueries.map((q) => q.query.replace(/\s+/g, ' ').trim());
    if (!statements.length) {
      console.log('[PASS] Database schema matches the entity definitions (no drift).');
      return 0;
    }
    const drops = statements.filter((s) => /\bDROP\b/i.test(s));
    const adds = statements.filter((s) => !/\bDROP\b/i.test(s));
    console.log(`[DRIFT] ${statements.length} difference(s): ${adds.length} add/alter, ${drops.length} drop.`);
    for (const s of adds) console.log('  + ' + s);
    for (const s of drops) console.log('  - ' + s);
    return 2;
  } finally {
    await source.destroy();
  }
}

main().then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    console.error('[FAIL] Schema drift check could not run:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
