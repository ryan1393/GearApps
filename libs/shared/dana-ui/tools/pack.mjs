import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
fs.mkdirSync(path.join(root, 'dist/packages'), { recursive: true });
const result = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd pack dist/libs/shared/dana-ui --pack-destination dist/packages'], { cwd: root, stdio: 'inherit' })
  : spawnSync('npm', ['pack', 'dist/libs/shared/dana-ui', '--pack-destination', 'dist/packages'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
