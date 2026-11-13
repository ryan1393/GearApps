import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnv } from './env.mjs';

/** Return a required environment variable without ever echoing its value. */
export function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/** Validate a TCP port once for all Truck Log database tools. */
export function databasePort() {
  const port = Number(requiredEnvironment('TRUCK_LOG_DATABASE_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('TRUCK_LOG_DATABASE_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

/**
 * Create the canonical PostgreSQL client used by maintenance/migration tools.
 *
 * This function centralizes environment loading, port validation and SSL
 * behavior so migration scripts cannot silently drift from one another.
 */
export function createTruckLogDatabaseClient({ connectionTimeoutMillis = 15_000 } = {}) {
  loadEnv();
  const { Client } = pg;
  return new Client({
    connectionTimeoutMillis,
    host: requiredEnvironment('TRUCK_LOG_DATABASE_HOST'),
    port: databasePort(),
    user: requiredEnvironment('TRUCK_LOG_DATABASE_USERNAME'),
    password: requiredEnvironment('TRUCK_LOG_DATABASE_PASSWORD'),
    database: requiredEnvironment('TRUCK_LOG_DATABASE_NAME'),
    ssl: String(process.env.TRUCK_LOG_DATABASE_SSL ?? 'false').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false,
  });
}

/** Require an argument-free command. */
export function assertNoArguments(args = process.argv.slice(2)) {
  if (args.length) throw new Error(`Unknown argument(s): ${args.join(', ')}`);
}

/** Accept exactly the common optional --preflight flag. */
export function preflightRequested(args = process.argv.slice(2)) {
  const allowed = new Set(['--preflight']);
  const unknown = args.filter((argument) => !allowed.has(argument));
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(', ')}`);
  return args.includes('--preflight');
}

/**
 * Execute an additive migration inside one transaction and verify the resulting
 * schema before commit. Preflight runs the exact same path and then rolls back.
 *
 * Callers keep feature-specific schema assertions and SQL validation local;
 * transaction, timeout, advisory-lock and rollback behavior stays centralized.
 */
export async function runVerifiedMigration({
  migrationPath,
  missingMigrationMessage,
  advisoryKey,
  statementTimeoutSeconds = 120,
  preflightOnly = false,
  assertBaseSchema,
  beforeMigration,
  verifySchema,
  validateSql,
  committedMessage,
  preflightMessage,
}) {
  const absoluteMigrationPath = path.resolve(migrationPath);
  if (!fs.existsSync(absoluteMigrationPath)) {
    throw new Error(missingMigrationMessage || `Missing migration: ${absoluteMigrationPath}`);
  }
  const migrationSql = fs.readFileSync(absoluteMigrationPath, 'utf8');
  if (validateSql) validateSql(migrationSql);

  if (!Number.isInteger(statementTimeoutSeconds) || statementTimeoutSeconds < 1) {
    throw new Error('statementTimeoutSeconds must be a positive integer.');
  }

  const client = createTruckLogDatabaseClient();
  let transactionOpen = false;
  await client.connect();
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query(`SET LOCAL statement_timeout = '${statementTimeoutSeconds}s'`);
    await client.query('SET LOCAL search_path = public, pg_catalog');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('truck-log'), hashtext($1))",
      [advisoryKey],
    );

    if (assertBaseSchema) await assertBaseSchema(client);
    if (beforeMigration) await beforeMigration(client);
    await client.query(migrationSql);
    const summary = verifySchema ? await verifySchema(client) : undefined;

    if (preflightOnly) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      console.log(preflightMessage || '[PASS] Migration preflight verified and rolled back.', summary);
    } else {
      await client.query('COMMIT');
      transactionOpen = false;
      console.log(committedMessage || '[PASS] Migration committed and verified.', summary);
    }
    return summary;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original migration or verification failure.
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Run a schema verification with the canonical Truck Log database connection.
 * A read-only transaction is available for verifiers that intentionally test
 * transaction-local behavior; otherwise the verifier receives a normal client.
 */
export async function runSchemaVerification({
  verifySchema,
  successMessage,
  readOnlyTransaction = false,
}) {
  const client = createTruckLogDatabaseClient();
  let transactionOpen = false;
  await client.connect();
  try {
    if (readOnlyTransaction) {
      await client.query('BEGIN TRANSACTION READ ONLY');
      transactionOpen = true;
    }
    const summary = await verifySchema(client);
    if (transactionOpen) {
      await client.query('ROLLBACK');
      transactionOpen = false;
    }
    console.log(successMessage, summary);
    return summary;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original schema-verification failure.
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}
