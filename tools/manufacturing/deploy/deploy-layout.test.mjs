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
  write(path.join(source, 'compose.yml'), 'services: {}\n');
  // Packed without execute bits, as Windows tar does.
  write(path.join(source, 'commands/CLEAR-OPERATIONAL-DATA.sh'), '#!/usr/bin/env bash\necho ok\n');
  fs.chmodSync(path.join(source, 'commands/CLEAR-OPERATIONAL-DATA.sh'), 0o644);
  const packed = spawnSync('tar', ['-czf', archive, '-C', source, '.'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  return { root, legacy, archive, upload };
}

test('deploy retains the root environment and rollback release', (t) => {
  const f = fixture(t);
  write(path.join(f.root, 'compose.yml'), 'services: {}\n');
  write(path.join(f.root, '.env'), 'GEAR_DB_PASSWORD=legacy-host-password\n');
  execute(stageScript(f.root, f.legacy, f.archive, f.upload));
  assert.equal(fs.readFileSync(path.join(f.root, '.env'), 'utf8'), 'GEAR_DB_PASSWORD=legacy-host-password\n');
  assert.equal(fs.existsSync(path.join(f.root, 'manufacturing/.env')), false);
  assert.equal(fs.existsSync(path.join(`${f.root}.pending-prev`, 'compose.yml')), true);
  execute(finalizeScript(f.root));
  assert.equal(fs.existsSync(path.join(`${f.root}.prev`, 'compose.yml')), true);
});

test('deploy makes the shipped shell scripts executable', (t) => {
  const f = fixture(t);
  write(f.upload, 'APP=manufacturing\n');
  execute(stageScript(f.root, f.legacy, f.archive, f.upload));
  const script = path.join(f.root, 'commands/CLEAR-OPERATIONAL-DATA.sh');
  assert.equal(fs.statSync(script).mode & 0o100, 0o100);
  assert.equal(execute(`cd ${JSON.stringify(f.root)} && ./commands/CLEAR-OPERATIONAL-DATA.sh`), 'ok\n');
});

test('deploy carries the old shared manufacturing environment into the root', (t) => {
  const f = fixture(t);
  write(path.join(f.root, 'manufacturing/compose.yml'), 'services: {}\n');
  write(path.join(f.root, 'manufacturing/.env'), 'APP=manufacturing\n');
  write(path.join(f.root, '.env'), 'APP=lapper\n');
  write(f.upload, 'APP=wrong-upload\n');
  execute(stageScript(f.root, f.legacy, f.archive, f.upload));
  assert.equal(fs.readFileSync(path.join(f.root, '.env'), 'utf8'), 'APP=manufacturing\n');
  assert.equal(fs.readFileSync(path.join(`${f.root}.pending-prev`, '.env'), 'utf8'), 'APP=lapper\n');
});

test('first deploy accepts an uploaded environment and normalizes Windows newlines', (t) => {
  const f = fixture(t);
  write(f.upload, 'APP=manufacturing\r\n');
  execute(stageScript(f.root, f.legacy, f.archive, f.upload));
  assert.equal(fs.readFileSync(path.join(f.root, '.env'), 'utf8'), 'APP=manufacturing\n');
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

test('rollback to the older split layout preserves its root environment and current shared settings', (t) => {
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
  assert.equal(fs.readFileSync(path.join(f.root, '.env'), 'utf8'), 'APP=outdated-lapper\n');
  assert.equal(fs.existsSync(`${f.root}.pending-prev`), false);
});

// A release can hold files a one-off root container wrote; this account cannot delete them.
// Simulate that with an `rm` that refuses the tree and a `docker` that deletes it "as root".
function rootOwnedShims(dir, blocked, { dockerWorks = true } = {}) {
  const log = path.join(dir, 'docker.log');
  return {
    log,
    prefix: `rm() { case " $* " in *" ${blocked}"*) return 1;; esac; command rm "$@"; }
docker() {
  echo "$*" >> '${log}'
  if [ "$1" = ps ]; then ${dockerWorks ? "echo dana-apps-meshforge-server:70.7.0" : 'true'}; return 0; fi
  if [ "$1" = run ]; then
    local mount="" last="\${!#}"; for a in "$@"; do case "$a" in *:/parent) mount="\${a%:/parent}";; esac; done
    command rm -rf "$mount/\${last##*/}"; return 0
  fi
}
`,
  };
}

test('finalize removes a previous release holding root-owned files through a root container', (t) => {
  const f = fixture(t);
  const prev = `${f.root}.prev`;
  write(path.join(prev, 'tools/manufacturing/data-import/work/pre-clear-operational-data-manifest.json'), '{}');
  write(path.join(`${f.root}.pending-prev`, 'compose.yml'), 'services: {}\n');
  const shims = rootOwnedShims(path.dirname(f.root), prev);
  const out = execute(shims.prefix + finalizeScript(f.root));
  assert.match(out, /Removed .*\.prev \(it held files owned by another account\)/);
  assert.equal(fs.existsSync(path.join(prev, 'tools')), false);
  assert.equal(fs.existsSync(path.join(prev, 'compose.yml')), true);
  assert.equal(fs.existsSync(`${f.root}.pending-prev`), false);
  const calls = fs.readFileSync(shims.log, 'utf8');
  assert.match(calls, /label=com\.docker\.compose\.project=dana-apps/);
  assert.match(calls, /run --rm --user 0:0 --network none --entrypoint rm -v .*:\/parent dana-apps-meshforge-server:70\.7\.0 -rf \/parent\//);
});

test('finalize stops with the exact command when no project image can remove the folder', (t) => {
  const f = fixture(t);
  const prev = `${f.root}.prev`;
  write(path.join(prev, 'work/root-owned.json'), '{}');
  write(path.join(`${f.root}.pending-prev`, 'compose.yml'), 'services: {}\n');
  const shims = rootOwnedShims(path.dirname(f.root), prev, { dockerWorks: false });
  const result = spawnSync('bash', ['-s'], { input: shims.prefix + finalizeScript(f.root), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Could not remove .*\.prev: it holds files owned by another account\. Run: sudo rm -rf '/);
  // The pending release is kept, so a re-run (or rollback) still finds it.
  assert.equal(fs.existsSync(path.join(`${f.root}.pending-prev`, 'compose.yml')), true);
});
