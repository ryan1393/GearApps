// Read/write verification for a disposable TEST database only.
// Run with injected DATABASE_* settings (or node --env-file=.env) and explicit
// GEAR_APPS_ALLOW_TEST_ACCOUNTS=YES. Changes are restored even if assertions fail.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { assertTestAccountsAllowed } from './test-data/test-account-guard.mjs';
const env = process.env;
assertTestAccountsAllowed(env, 'test-bootstrap-redeployment');
for (const key of ['DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_USERNAME', 'DATABASE_PASSWORD', 'DATABASE_NAME']) assert.ok(env[key], `Missing injected ${key}`);
const client = new pg.Client({ host: env.DATABASE_HOST, port: Number(env.DATABASE_PORT), user: env.DATABASE_USERNAME, password: env.DATABASE_PASSWORD, database: env.DATABASE_NAME });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let employee, machine, roll;
await client.connect();
try {
  employee = (await client.query('SELECT id,active,"updatedAt" FROM users WHERE "employeeNumber" IS NOT NULL AND email IS NULL ORDER BY "employeeNumber" LIMIT 1')).rows[0];
  machine = (await client.query('SELECT m.id,m.enabled,m."updatedAt" FROM machines m WHERE NOT EXISTS(SELECT 1 FROM cutter_machine_runs r WHERE r.machine_id=m.id AND r.enabled) ORDER BY m.machine_number LIMIT 1')).rows[0];
  roll = (await client.query('SELECT id,minimum_quantity,"updatedAt" FROM roll_masters ORDER BY id LIMIT 1')).rows[0];
  assert.ok(employee && machine && roll, 'Load base data and provide an idle imported machine before testing');
  await client.query('UPDATE users SET active=false WHERE id=$1', [employee.id]);
  await client.query('UPDATE machines SET enabled=false WHERE id=$1', [machine.id]);
  const changedMinimum = Number(roll.minimum_quantity) + 101;
  await client.query('UPDATE roll_masters SET minimum_quantity=$2 WHERE id=$1', [roll.id, changedMinimum]);
  const result = spawnSync(process.execPath, [path.join(root, 'tools/base-data/import-base-data.mjs'), '--bootstrap-only'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `Automatic bootstrap failed: ${result.stderr ?? ''}`);
  assert.match(result.stdout, /automatic base-data import skipped/);
  assert.equal((await client.query('SELECT active FROM users WHERE id=$1', [employee.id])).rows[0].active, false);
  assert.equal((await client.query('SELECT enabled FROM machines WHERE id=$1', [machine.id])).rows[0].enabled, false);
  assert.equal((await client.query('SELECT minimum_quantity FROM roll_masters WHERE id=$1', [roll.id])).rows[0].minimum_quantity, changedMinimum);
  console.log('[PASS] Real automatic redeployment preserves employee, machine, and roll-master edits.');
} finally {
  try {
    if (employee) await client.query('UPDATE users SET active=$2,"updatedAt"=$3 WHERE id=$1', [employee.id, employee.active, employee.updatedAt]);
    if (machine) await client.query('UPDATE machines SET enabled=$2,"updatedAt"=$3 WHERE id=$1', [machine.id, machine.enabled, machine.updatedAt]);
    if (roll) await client.query('UPDATE roll_masters SET minimum_quantity=$2,"updatedAt"=$3 WHERE id=$1', [roll.id, roll.minimum_quantity, roll.updatedAt]);
    console.log('[PASS] Original verification records restored.');
  } finally { await client.end(); }
}
