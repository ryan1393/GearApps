import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { containerState, upScript, verifyVersion } from './deploy-remote.mjs';

// A fake `docker` on PATH: the first `ps` fails the way a dropped ssh connection does (error text,
// non-zero exit), later calls answer normally. `exec` also writes an ssh warning to stderr.
function fakeDocker(t, version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-fake-docker-'));
  const calls = path.join(dir, 'ps-calls');
  fs.writeFileSync(calls, '0');
  fs.writeFileSync(path.join(dir, 'docker'), `#!/bin/sh
case " $* " in
  *" ps "*)
    n=$(cat '${calls}'); echo $((n + 1)) > '${calls}'
    if [ "$n" = 0 ]; then echo 'ssh: connect to host usftwvmdocker: Connection reset' >&2; exit 255; fi
    echo 0123456789abcdef ;;
  *" inspect "*) echo '[{"State":{"Status":"running","Health":{"Status":"healthy"}}}]' ;;
  *" exec "*) echo 'Warning: Permanently added usftwvmdocker' >&2; echo '${version}' ;;
esac
`, { mode: 0o755 });
  const previous = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${previous}`;
  t.after(() => { process.env.PATH = previous; fs.rmSync(dir, { recursive: true, force: true }); });
}

test('a failed ssh call is "not found", never a container id built from its error text', (t) => {
  fakeDocker(t, '70.5.0');
  assert.equal(containerState({ name: 'usftwvmdocker' }, 'gear-app-server'), null);
  assert.deepEqual(containerState({ name: 'usftwvmdocker' }, 'gear-app-server'), {
    id: '0123456789abcdef',
    state: { Status: 'running', Health: { Status: 'healthy' } },
  });
});

test('the version check retries the container lookup and ignores stderr warnings', async (t) => {
  fakeDocker(t, '70.5.0');
  const log = t.mock.method(console, 'log', () => {});
  await verifyVersion({ name: 'usftwvmdocker' }, '70.5.0');
  assert.ok(log.mock.calls.some((c) => String(c.arguments[0]).includes('API reports version 70.5.0')));
});

// Runs the deploy's container step against a fake `docker` that records every compose call.
function runUpScript(t, { collectorRunning }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-up-script-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'release');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'compose.yml'), 'services: {}\n');
  fs.writeFileSync(path.join(root, '.env'), '');
  const log = path.join(dir, 'calls');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
echo "$*" >> '${log}'
case " $* " in
  *" config --services "*) printf 'gear-app-server\\nlapper-read\\n' ;;
  *" ps -a -q lapper-read "*) ${collectorRunning ? "echo 0123456789ab" : 'true'} ;;
esac
`, { mode: 0o755 });
  const result = spawnSync('bash', ['-s'], {
    input: upScript(root),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => line.replace(/^compose -p dana-apps --env-file \.env -f compose\.yml /, ''));
  return { calls, stdout: result.stdout };
}

test('a deploy rebuilds and restarts the collector when it already runs on the host', (t) => {
  const { calls, stdout } = runUpScript(t, { collectorRunning: true });
  const at = (call) => calls.indexOf(call);
  assert.ok(at('--profile collectors build lapper-read') > at('build'));
  assert.ok(at('up -d --no-build') > at('--profile collectors build lapper-read'));
  assert.ok(at('--profile collectors up -d --no-build --no-deps --force-recreate lapper-read') > at('up -d --no-build'));
  assert.match(stdout, /collector rebuilt and restarted/);
});

test('a deploy never starts a collector the owner has not started', (t) => {
  const { calls, stdout } = runUpScript(t, { collectorRunning: false });
  assert.ok(calls.includes('up -d --no-build'));
  assert.ok(!calls.some((call) => call.includes('build lapper-read') || call.includes('up -d --no-build --no-deps')));
  assert.match(stdout, /collector is not running here/);
});
