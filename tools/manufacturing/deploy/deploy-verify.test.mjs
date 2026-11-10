import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { containerState, verifyVersion } from './deploy-remote.mjs';

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
