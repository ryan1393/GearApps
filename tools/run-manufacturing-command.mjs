import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Maintenance tools retain their domain-relative working directory while every
// command gets configuration from the single repository environment.
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const scripts = JSON.parse(readFileSync(resolve(root, 'tools/manufacturing-scripts.json'), 'utf8'));
const [name, ...args] = process.argv.slice(2);
if (!Object.hasOwn(scripts, name)) throw new Error(`Unknown manufacturing command: ${name}`);
// Manufacturing commands run from the repository root, like Nx and npm.
const env = {
  ...process.env,
  TS_NODE_BASEURL: root,
  PATH: `${resolve(root, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? ''}`,
};
let child;
if (process.platform === 'win32') {
  if (args.some((arg) => /[\r\n%]/.test(arg)))
    throw new Error('Command arguments cannot contain newlines or percent signs on Windows.');
  const quote = (value) => `"${value.replaceAll('"', '""')}"`;
  child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `${scripts[name]} ${args.map(quote).join(' ')}`],
    { cwd: root, env, stdio: 'inherit' },
  );
} else {
  child = spawn('/bin/sh', ['-c', `${scripts[name]} "$@"`, name, ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
}
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
