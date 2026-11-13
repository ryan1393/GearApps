// RXO worker safety contracts (no Docker, browser or network):
//   cross-process locks with stale-lock recovery, batch retention, atomic
//   latest/ publication, content-based credential versions, SMTP SENDING retry,
//   and the compose liveness/hardening settings of the RXO services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireLock, inspectLock, LockBusyError, withTimeout, processStartTime } from '../../libs/truck-log/rxo-shared/process-lock.mjs';
import { pruneBatchDirectories } from '../../libs/truck-log/rxo-shared/batch-retention.mjs';
import { currentCredentialVersion, credentialsChangedSinceHold, requestAuthRetry, notificationPending, AUTH_VERSION } from '../../libs/truck-log/rxo-shared/rxo-auth.mjs';
import { publishLatestExports, recoverLatestPublication, verifyLatestExports } from '../../apps/rxo-integration/src/lib/rxo-export-publication.mjs';
import { acquireExportLock, batchId, writeJson } from '../../apps/rxo-integration/src/lib/rxo-export-runtime.mjs';
import { saveCredentials } from '../../apps/rxo-expedite/src/lib/credentials.mjs';

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-rxo-safety-'));
const quiet = () => {};
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('[PASS] ' + name); }
const dir = name => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; };
const iso = msAgo => new Date(Date.now() - msAgo).toISOString();
const holderFile = (file, patch) => fs.writeFileSync(file, JSON.stringify({ contractVersion: 1, token: 'other-' + Math.random(), purpose: 'fixture',
  pid: 999999, host: os.hostname(), procStart: '1', startedAt: iso(0), refreshedAt: iso(0), ...patch }));
const opts = { staleAfterMs: 60_000, maxHoldMs: 600_000, log: quiet };

try {
  await test('lock: second acquirer is refused while the first holds it; release frees it', () => {
    const file = path.join(dir('lock1'), '.x.lock');
    const a = acquireLock(file, { ...opts, code: 'X_BUSY' });
    assert.throws(() => acquireLock(file, { ...opts, code: 'X_BUSY' }), e => e instanceof LockBusyError && e.code === 'X_BUSY');
    a.release();
    acquireLock(file, opts).release();
    assert.equal(fs.existsSync(file), false);
  });
  await test('lock: holder in this container whose pid is gone is broken immediately', () => {
    const file = path.join(dir('lock2'), '.x.lock');
    holderFile(file, {});
    assert.equal(inspectLock(file, opts).reason, 'OWNER_NOT_RUNNING');
    const lock = acquireLock(file, opts); assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid, process.pid); lock.release();
  });
  await test('lock: a reused pid (same pid, different start time) is not mistaken for the holder', () => {
    if (!processStartTime(process.pid)) return; // /proc only
    const file = path.join(dir('lock3'), '.x.lock');
    holderFile(file, { pid: process.pid, procStart: 'not-' + processStartTime(process.pid) });
    assert.equal(inspectLock(file, opts).stale, true);
  });
  await test('lock: holder in another container is trusted while it refreshes, broken once it stops', () => {
    const file = path.join(dir('lock4'), '.x.lock');
    holderFile(file, { host: 'another-container' });
    assert.throws(() => acquireLock(file, opts), LockBusyError);
    holderFile(file, { host: 'another-container', refreshedAt: iso(61_000) });
    assert.equal(inspectLock(file, opts).reason, 'OWNER_STOPPED_REFRESHING');
    acquireLock(file, opts).release();
  });
  await test('lock: a refreshing holder older than the maximum run time is broken', () => {
    const file = path.join(dir('lock5'), '.x.lock');
    holderFile(file, { host: 'another-container', startedAt: iso(601_000) });
    assert.equal(inspectLock(file, opts).reason, 'MAX_HOLD_EXCEEDED');
  });
  await test('lock: an unreadable lock blocks until its mtime is older than staleAfterMs', () => {
    const file = path.join(dir('lock6'), '.x.lock');
    fs.writeFileSync(file, 'legacy-owner');
    assert.throws(() => acquireLock(file, opts), LockBusyError);
    assert.equal(fs.readFileSync(file, 'utf8'), 'legacy-owner');
    const old = new Date(Date.now() - 120_000); fs.utimesSync(file, old, old);
    acquireLock(file, opts).release();
  });
  await test('lock: refresh keeps the lock fresh; a holder whose lock was broken notices', () => {
    const file = path.join(dir('lock7'), '.x.lock');
    const lock = acquireLock(file, opts);
    assert.equal(lock.refresh(), true);
    fs.unlinkSync(file); holderFile(file, { host: 'another-container' });
    assert.equal(lock.refresh(), false); assert.equal(lock.lost, true);
    lock.release();
    assert.equal(fs.existsSync(file), true, 'release must not delete a lock someone else holds');
  });
  await test('withTimeout bounds a hung await', async () => {
    await assert.rejects(withTimeout(new Promise(() => {}), 20, 'HUNG'), e => e.code === 'HUNG');
    assert.equal(await withTimeout(Promise.resolve(7), 1000), 7);
  });
  await test('standard exporter lock is RXO_EXPORT_BUSY across processes', () => {
    const data = dir('export-lock');
    const lock = acquireExportLock(data, 'test');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { acquireExportLock } from ${JSON.stringify(path.join(root, 'apps/rxo-integration/src/lib/rxo-export-runtime.mjs'))};
       try { acquireExportLock(${JSON.stringify(data)}, 'second'); process.exit(0); } catch (e) { process.exit(e.code === 'RXO_EXPORT_BUSY' ? 3 : 1); }`]);
    assert.equal(child.status, 3, String(child.stderr));
    lock.release();
  });

  await test('retention keeps newest successful/failed batches and never a protected one', () => {
    const d = dir('retention');
    for (let i = 0; i < 10; i++) {
      const name = `202601${String(10 + i)}-000000`;
      fs.mkdirSync(path.join(d, name));
      if (i % 2 === 0) fs.writeFileSync(path.join(d, name, 'manifest.json'), '{}');
    }
    fs.mkdirSync(path.join(d, 'not-a-batch'));
    const result = pruneBatchDirectories(d, { keepSuccessful: 2, keepFailed: 1, protect: ['20260110-000000'],
      validName: n => /^\d{8}-\d{6}$/.test(n), isSuccessful: (n, full) => fs.existsSync(path.join(full, 'manifest.json')) });
    assert.deepEqual(fs.readdirSync(d).sort(), ['20260110-000000', '20260116-000000', '20260118-000000', '20260119-000000', 'not-a-batch']);
    assert.equal(result.removed.length, 6);
  });
  await test('standard batch ids are UTC and sortable', () => {
    assert.equal(batchId(new Date('2026-11-01T06:30:05Z')), '20261101-063005');
  });

  const pages = [{ key: 'orders', exportKey: 'orders' }, { key: 'freight', exportKey: 'freight' }, { key: 'shipments', exportKey: 'shipments' }];
  const directions = [{ direction: 'OUTBOUND', file: 'Outbound.xlsx' }, { direction: 'INBOUND', file: 'Inbound.xlsx' }];
  const makeBatch = (data, id, marker) => {
    const batch = path.join(data, 'batches', id);
    for (const p of pages) for (const d of directions) {
      fs.mkdirSync(path.join(batch, 'fort-wayne', p.exportKey), { recursive: true });
      fs.writeFileSync(path.join(batch, 'fort-wayne', p.exportKey, d.file), Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from(marker)]));
    }
    return { batch, manifest: { version: '1.0.0', batchId: id, completedAt: iso(0), status: 'complete', site: {},
      exports: pages.flatMap(p => directions.map(d => ({ pageKey: p.key, direction: d.direction }))) } };
  };
  const publish = (data, id, marker) => { const { batch, manifest } = makeBatch(data, id, marker);
    const log = console.log; console.log = quiet;
    try { publishLatestExports({ dataDir: data, productionPages: pages, exportDirections: directions, batchDir: batch, manifest }); }
    finally { console.log = log; } };
  const verify = (data, id) => { const log = console.log; console.log = quiet;
    try { return verifyLatestExports({ dataDir: data, productionPages: pages, exportDirections: directions, expectedBatchId: id }); }
    finally { console.log = log; } };
  await test('latest/ is published as a whole directory and replaced by a swap', () => {
    const data = dir('publish');
    publish(data, '20260101-000000', 'one');
    verify(data, '20260101-000000');
    const first = fs.lstatSync(path.join(data, 'latest'));
    assert.ok(first.isDirectory() && !first.isSymbolicLink(), 'latest must be a real directory for docker cp');
    publish(data, '20260101-003000', 'two');
    verify(data, '20260101-003000');
    assert.equal(fs.readFileSync(path.join(data, 'latest/fort-wayne/orders/Inbound.xlsx'), 'utf8').slice(4), 'two');
    assert.deepEqual(fs.readdirSync(data).filter(n => n.startsWith('.latest')), [], 'no staging/previous leftovers');
  });
  await test('a publication interrupted between the two renames is restored', () => {
    const data = dir('publish-recover');
    publish(data, '20260101-000000', 'one');
    fs.renameSync(path.join(data, 'latest'), path.join(data, '.latest-previous-crash'));
    fs.mkdirSync(path.join(data, '.latest-staging-orphan'));
    recoverLatestPublication(data);
    verify(data, '20260101-000000');
    assert.deepEqual(fs.readdirSync(data).filter(n => n.startsWith('.latest')), []);
  });
  await test('an incomplete staged set never replaces latest/', () => {
    const data = dir('publish-bad');
    publish(data, '20260101-000000', 'one');
    const { batch, manifest } = makeBatch(data, '20260101-010000', 'bad');
    fs.writeFileSync(path.join(batch, 'fort-wayne/orders/Inbound.xlsx'), 'not-a-zip');
    const log = console.log; console.log = quiet;
    try { assert.throws(() => publishLatestExports({ dataDir: data, productionPages: pages, exportDirections: directions, batchDir: batch, manifest }), /XLSX/); }
    finally { console.log = log; }
    verify(data, '20260101-000000');
  });
  await test('JSON state files are replaced atomically (no temp files left behind)', () => {
    const d = dir('atomic'); const file = path.join(d, 'health.json');
    writeJson(file, { a: 1 }); writeJson(file, { a: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 2 });
    assert.deepEqual(fs.readdirSync(d), ['health.json']);
  });

  await test('standard credential version follows contents, not file identity', () => {
    const secrets = dir('std-secrets'), auth = dir('std-auth');
    const env = { RXO_USERNAME_FILE: process.env.RXO_USERNAME_FILE, RXO_PASSWORD_FILE: process.env.RXO_PASSWORD_FILE };
    process.env.RXO_USERNAME_FILE = path.join(secrets, 'rxo_username'); process.env.RXO_PASSWORD_FILE = path.join(secrets, 'rxo_password');
    try {
      const save = (u, p) => { for (const [f, v] of [['rxo_username', u], ['rxo_password', p]]) {
        const t = path.join(secrets, f + '.tmp'); fs.writeFileSync(t, v); fs.renameSync(t, path.join(secrets, f)); } };
      save('user@example.test', 'rejected-password');
      const v1 = currentCredentialVersion('standard', auth);
      assert.match(v1, /^standard:hmac-sha256:[a-f0-9]{64}$/);
      assert.ok(!v1.includes('rejected-password'));
      save('user@example.test', 'rejected-password'); // re-save: new inode and mtime, same contents
      assert.equal(currentCredentialVersion('standard', auth), v1);
      fs.writeFileSync(path.join(auth, 'rxo-auth-review.json'), JSON.stringify({ version: AUTH_VERSION, role: 'standard', code: 'RXO_AUTH_REJECTED',
        phase: 'FAILED', passwordSubmissions: 1, message: 'rejected', credentialVersion: v1, updatedAt: iso(0) }));
      assert.equal(credentialsChangedSinceHold(auth, 'standard'), false);
      assert.deepEqual(requestAuthRetry(auth, 'standard'), { role: 'standard', requested: false, reason: 'CREDENTIALS_UNCHANGED' });
      save('user@example.test', 'new-password');
      assert.equal(credentialsChangedSinceHold(auth, 'standard'), true);
    } finally {
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  await test('expedite: re-saving unchanged credentials keeps the version; old generations are pruned', () => {
    const secrets = dir('exp-secrets'), auth = dir('exp-auth');
    saveCredentials({ username: 'expedite-user', password: 'p1' }, secrets);
    const v1 = currentCredentialVersion('expedite', auth, secrets);
    for (let i = 0; i < 4; i++) saveCredentials({ username: 'expedite-user', password: 'p1' }, secrets);
    assert.equal(currentCredentialVersion('expedite', auth, secrets), v1);
    assert.equal(fs.readdirSync(path.join(secrets, 'rxo_expedite_versions')).length, 2, 'current + one previous generation');
    saveCredentials({ username: 'expedite-user', password: 'p2' }, secrets);
    assert.notEqual(currentCredentialVersion('expedite', auth, secrets), v1);
  });
  await test('expedite: a credential lock left by a killed writer is broken', () => {
    const secrets = dir('exp-lock');
    holderFile(path.join(secrets, '.rxo_expedite_write_lock'), { host: 'api-helper-container', refreshedAt: iso(180_000), startedAt: iso(180_000) });
    saveCredentials({ username: 'expedite-user', password: 'p1' }, secrets);
    assert.equal(fs.existsSync(path.join(secrets, '.rxo_expedite_write_lock')), false);
  });
  await test('SMTP: SENDING left by a killed process becomes retryable after 10 minutes', () => {
    assert.equal(notificationPending({ status: 'SENDING', at: iso(60_000) }), false);
    assert.equal(notificationPending({ status: 'SENDING', at: iso(11 * 60_000) }), true);
    assert.equal(notificationPending({ status: 'SENT', at: iso(0) }), false);
    assert.equal(notificationPending(undefined), true);
  });

  await test('compose: RXO healthchecks require loop progress; rxo-export/rxo-browser are hardened', () => {
    const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    const block = name => { const start = compose.indexOf(`\n  ${name}:\n`); assert.ok(start >= 0, name);
      const next = compose.slice(start + 1).search(/\n  [a-z][\w-]*:\n|\nvolumes:\n/); return compose.slice(start, start + 1 + next); };
    for (const name of ['rxo-export', 'rxo-expedite-scheduler']) assert.ok(block(name).includes('schedulerLoopDeadlineAt'), name + ' loop liveness');
    for (const name of ['rxo-export', 'rxo-browser', 'rxo-expedite-scheduler', 'rxo-expedite']) {
      const b = block(name);
      for (const marker of ['no-new-privileges:true', 'cap_drop: ["ALL"]', 'mem_limit:', 'pids_limit:', 'TZ: "${TZ:-America/Indiana/Indianapolis}"', 'context: .'])
        assert.ok(b.includes(marker), `${name}: ${marker}`);
    }
    assert.ok(block('rxo-browser').includes('"127.0.0.1:${TRUCK_LOG_RXO_BROWSER_PORT:-6080}:6080"'));
    const bootstrap = fs.readFileSync(path.join(root, 'apps/rxo-integration/browser-bootstrap.sh'), 'utf8');
    assert.ok(!bootstrap.includes('-nopw') && bootstrap.includes('-rfbauth /run/rxo-browser/vnc-passwd'), 'VNC requires a per-session password');
  });
  await test('operator scripts: one compose file, safe session reset, configured API port and image tag', () => {
    const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
    assert.equal(fs.existsSync(path.join(root, 'apps/rxo-integration/docker-compose.yml')), false);
    const reset = read('apps/rxo-integration/reset-session.ps1');
    assert.ok(reset.includes('$Answer -cne "RESET"') && reset.includes('--filter "volume=$StateVolume"') && reset.includes('docker volume rm $StateVolume failed'));
    assert.ok(!/\*> \$null\s*\n\s*if \(\$LASTEXITCODE -ne 0\) \{\s*\n\s*Write-Host "No existing/.test(reset), 'volume removal failure must not be reported as success');
    const importer = read('tools/truck-log/rxo/import-latest.ps1');
    assert.ok(importer.includes('Get-DotEnvValue "TRUCK_LOG_API_PORT" "3334"') && importer.includes('Get-DotEnvValue "TRUCK_LOG_API_BASE_URL"'));
    for (const rel of ['SETUP-RXO-EXPEDITE-CREDENTIALS.sh', 'tools/truck-log/setup-rxo-expedite-credentials.ps1']) {
      const text = read(rel);
      assert.ok(!text.includes('truck-log-rxo-expedite:1.0.0'), rel + ' must not pin the image tag');
      assert.ok(text.includes('TRUCK_LOG_RELEASE') && text.includes('VERSION'), rel + ' reads the release from .env or VERSION');
    }
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`[PASS] RXO worker safety: ${passed} cases (locks, retention, atomic publication, credential versions, compose). No Docker, browser or network used.`);
