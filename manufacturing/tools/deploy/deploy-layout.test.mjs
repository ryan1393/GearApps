import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { envCheckScript, finalizeScript, rollbackSwapScript, stageScript } from './deploy-remote.mjs';

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function execute(script) {
  const result = spawnSync('bash', ['-s'], { input: script, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-deploy-layout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "release with ' quote");
  const legacy = path.join(dir, 'legacy');
  const archive = path.join(dir, 'source.tgz');
  const upload = path.join(dir, 'uploaded.env');
  const source = path.join(dir, 'source');
  write(path.join(source, 'package-lock.json'), '{}');
  write(path.join(source, 'manufacturing/compose.yml'), 'services: {}\n');
  const packed = spawnSync('tar', ['-czf', archive, '-C', source, '.'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  return { root, legacy, archive, upload };
}

test('deploy migrates the legacy host environment into manufacturing and retains rollback', (t) => {
  const f = fixture(t);
  write(path.join(f.root, 'compose.yml'), 'services: {}\n');
  write(path.join(f.root, '.env'), 'GEAR_DB_PASSWORD=legacy-host-password\n');
  execute(stageScript(f.root, f.legacy, f.archive, f.upload));
  assert.equal(fs.readFileSync(path.join(f.root, 'manufacturing/.env'), 'utf8'), 'GEAR_DB_PASSWORD=legacy-host-password\n');
  assert.equal(fs.existsSync(path.join(f.root, '.env')), false);
  assert.equal(fs.existsSync(path.join(`${f.root}.pending-prev`, 'compose.yml')), true);
  execute(finalizeScript(f.root));
  assert.equal(fs.existsSync(path.join(`${f.root}.prev`, 'compose.yml')), true);
});

test('deploy preserves separate manufacturing and Lapper environments', (t) => {
  const f = fixture(t);
  write(path.join(f.root, 'manufacturing/compose.yml'), 'services: {}\n');
  write(path.join(f.root, 'manufacturing/.env'), 'APP=manufacturing\n');
  write(path.join(f.root, '.env'), 'APP=lapper\n');
  write(f.upload, 'APP=wrong-upload\n');
  execute(stageScript(f.root, f.legacy, f.archive, f.upload));
  assert.equal(fs.readFileSync(path.join(f.root, 'manufacturing/.env'), 'utf8'), 'APP=manufacturing\n');
  assert.equal(fs.readFileSync(path.join(f.root, '.env'), 'utf8'), 'APP=lapper\n');
});

test('first deploy accepts an uploaded environment and normalizes Windows newlines', (t) => {
  const f = fixture(t);
  write(f.upload, 'APP=manufacturing\r\n');
  execute(stageScript(f.root, f.legacy, f.archive, f.upload));
  assert.equal(fs.readFileSync(path.join(f.root, 'manufacturing/.env'), 'utf8'), 'APP=manufacturing\n');
  assert.equal(fs.existsSync(f.upload), false);
});

test('a missing manufacturing environment cannot be replaced by the Lapper environment', (t) => {
  const f = fixture(t);
  write(path.join(f.root, 'manufacturing/compose.yml'), 'services: {}\n');
  write(path.join(f.root, '.env'), 'APP=lapper\n');
  assert.equal(execute(envCheckScript(f.root)).trim(), 'NO_ENV');
  const result = spawnSync('bash', ['-s'], { input: stageScript(f.root, f.legacy, f.archive, f.upload), encoding: 'utf8' });
  assert.equal(result.status, 41);
  assert.equal(fs.readFileSync(path.join(f.root, '.env'), 'utf8'), 'APP=lapper\n');
});

test('rollback to a legacy release carries the current manufacturing environment', (t) => {
  const f = fixture(t);
  write(path.join(f.root, 'manufacturing/compose.yml'), 'services: {}\n');
  write(path.join(f.root, 'manufacturing/.env'), 'APP=current-manufacturing\n');
  write(path.join(f.root, '.env'), 'APP=lapper\n');
  write(path.join(`${f.root}.prev`, 'compose.yml'), 'services: {}\n');
  write(path.join(`${f.root}.prev`, '.env'), 'APP=outdated\n');
  execute(rollbackSwapScript(f.root, f.legacy));
  assert.equal(fs.readFileSync(path.join(f.root, '.env'), 'utf8'), 'APP=current-manufacturing\n');
  assert.equal(fs.readFileSync(path.join(`${f.root}.prev`, '.env'), 'utf8'), 'APP=lapper\n');
});

test('rollback between consolidated releases preserves both current environments', (t) => {
  const f = fixture(t);
  for (const root of [f.root, `${f.root}.pending-prev`]) {
    write(path.join(root, 'manufacturing/compose.yml'), 'services: {}\n');
    write(path.join(root, 'manufacturing/.env'), 'APP=outdated\n');
    write(path.join(root, '.env'), 'APP=outdated-lapper\n');
  }
  write(path.join(f.root, 'manufacturing/.env'), 'APP=current-manufacturing\n');
  write(path.join(f.root, '.env'), 'APP=current-lapper\n');
  execute(rollbackSwapScript(f.root, f.legacy));
  assert.equal(fs.readFileSync(path.join(f.root, 'manufacturing/.env'), 'utf8'), 'APP=current-manufacturing\n');
  assert.equal(fs.readFileSync(path.join(f.root, '.env'), 'utf8'), 'APP=current-lapper\n');
  assert.equal(fs.existsSync(`${f.root}.pending-prev`), false);
});
