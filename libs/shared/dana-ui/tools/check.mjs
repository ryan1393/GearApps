import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(project, '../../..');
const files = process.argv.includes('--browser') ? ['test-browser.mjs'] : [
  'test-dana-ui-boundary.mjs', 'test-dana-ui-compatibility-boundary.mjs',
  'test-dana-ui-truck-log-visual-source.mjs', 'test-consumer.mjs',
];
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(project, 'tools', file)], {
    cwd: project, stdio: 'inherit',
    env: { ...process.env, DANA_TEST_ANGULAR_ROOT: root },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
