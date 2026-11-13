// CHANGE-TRUCK-LOG-PASSWORDS: runs the Linux script against a fake docker CLI and checks
// that PostgreSQL and .env always receive the same new value, that a refused change
// leaves .env alone, and that an HTTPS installation is restarted with its overlay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let count = 0;
const check = (ok, message) => { assert.ok(ok, message); count++; };

const OLD_DB = 'a'.repeat(64);
const OLD_CLAIM = 'b'.repeat(64);
const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
case "$1 $2" in
  'compose version') printf '2.29.0\\n'; exit 0 ;;
  'inspect --format') printf '%s\\n' "\${FAKE_RUNNING:-true}"; exit 0 ;;
  'exec -i') cat > "$FAKE_SQL"; exit "\${FAKE_PSQL_EXIT:-0}" ;;
esac
exit 0
`;

function sandbox(extraEnv = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-passwords-'));
  fs.mkdirSync(path.join(dir, 'tools/truck-log'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'bin'));
  for (const rel of ['CHANGE-TRUCK-LOG-PASSWORDS.sh', 'tools/truck-log/compose-common.sh', 'VERSION']) fs.copyFileSync(path.join(root, rel), path.join(dir, rel));
  fs.chmodSync(path.join(dir, 'CHANGE-TRUCK-LOG-PASSWORDS.sh'), 0o755);
  fs.writeFileSync(path.join(dir, 'bin/docker'), FAKE_DOCKER, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, '.env'), `# kept comment\nTRUCK_LOG_DATABASE_USERNAME=api\nTRUCK_LOG_DATABASE_PASSWORD=${OLD_DB}\nTRUCK_LOG_DATABASE_NAME=TruckLog\nTRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET=${OLD_CLAIM}\nTRUCK_LOG_WEB_PORT=4300\n${extraEnv}`);
  return dir;
}
function run(dir, args, env = {}) {
  const result = spawnSync('sh', [path.join(dir, 'CHANGE-TRUCK-LOG-PASSWORDS.sh'), ...args], {
    encoding: 'utf8',
    env: { PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, FAKE_LOG: path.join(dir, 'docker.log'), FAKE_SQL: path.join(dir, 'sql.txt'), ...env },
  });
  const file = (name) => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : '');
  const values = Object.fromEntries(file('.env').split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  return { ...result, output: result.stdout + result.stderr, values, envText: file('.env'), log: file('docker.log'), sql: file('sql.txt') };
}

// --database: the same fresh value reaches PostgreSQL (on stdin) and .env.
{
  const dir = sandbox();
  const r = run(dir, ['--database']);
  const next = r.values.TRUCK_LOG_DATABASE_PASSWORD;
  check(r.status === 0, `--database succeeds: ${r.output}`);
  check(/^[0-9a-f]{64}$/.test(next) && next !== OLD_DB, '--database writes a new 64-hex password to .env');
  check(r.sql === `ALTER ROLE "api" WITH PASSWORD '${next}';\n`, 'PostgreSQL receives exactly the value written to .env');
  check(r.log.includes('exec -i truck-log-postgres psql -v ON_ERROR_STOP=1 -q -U api -d TruckLog'), 'the change runs inside the database container');
  check(!r.log.includes(next) && !r.output.includes(next), 'the new password is never an argument or printed');
  check(r.values.TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET === OLD_CLAIM && r.envText.includes('# kept comment') && r.values.TRUCK_LOG_WEB_PORT === '4300', 'other .env content is preserved');
  check(/compose -p truck-log up -d\n/.test(r.log) && !r.log.includes('docker-compose.https.yml'), 'an HTTP installation restarts with the base Compose file');
  check(!/volume rm| down|prune/.test(r.log), 'no volume or container is removed');
  check((fs.statSync(path.join(dir, '.env')).mode & 0o077) === 0, '.env stays private');
}

// A refused change leaves .env untouched and does not restart anything.
{
  const r = run(sandbox(), ['--database'], { FAKE_PSQL_EXIT: '1' });
  check(r.status !== 0 && r.values.TRUCK_LOG_DATABASE_PASSWORD === OLD_DB, 'a PostgreSQL failure keeps the old password in .env');
  check(!/ up -d/.test(r.log), 'a PostgreSQL failure does not restart services');
}
{
  const r = run(sandbox(), ['--database'], { FAKE_RUNNING: 'false' });
  check(r.status !== 0 && r.values.TRUCK_LOG_DATABASE_PASSWORD === OLD_DB && r.sql === '', 'a stopped database is reported before anything changes');
}
{
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, '.env'), `TRUCK_LOG_DATABASE_USERNAME=api"; DROP ROLE x; --\nTRUCK_LOG_DATABASE_PASSWORD=${OLD_DB}\n`);
  const r = run(dir, ['--database']);
  check(r.status !== 0 && r.sql === '', 'an unsafe role name never reaches SQL');
}

// --print-secret and --all-generated.
{
  const r = run(sandbox(), ['--print-secret']);
  check(r.status === 0 && /^[0-9a-f]{64}$/.test(r.values.TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET) && r.values.TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET !== OLD_CLAIM, '--print-secret replaces the signing secret');
  check(r.values.TRUCK_LOG_DATABASE_PASSWORD === OLD_DB && r.sql === '', '--print-secret leaves the database password alone');
}
{
  const r = run(sandbox('TRUCK_LOG_ADMIN_TRANSPORT=https\n'), ['--all-generated']);
  check(r.status === 0 && r.values.TRUCK_LOG_DATABASE_PASSWORD !== OLD_DB && r.values.TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET !== OLD_CLAIM, '--all-generated changes both values');
  check((r.log.match(/ up -d/g) ?? []).length === 1, '--all-generated restarts once');
  check(r.log.includes('compose -p truck-log --env-file .env -f docker-compose.yml -f docker-compose.https.yml up -d'), 'an HTTPS installation restarts with its overlay');
}

// Arguments: usage only, never a password on the command line.
{
  const dir = sandbox();
  check(run(dir, []).status === 0 && run(dir, ['--bogus']).status === 2 && run(dir, ['--database', 'secret']).status === 2, 'unknown or extra arguments show usage');
  check(run(dir, ['--bogus']).log === '', 'usage does not call docker');
}

// Wrappers delegate to the existing maintenance commands; Windows mirrors Linux.
const sh = read('CHANGE-TRUCK-LOG-PASSWORDS.sh');
const cmd = read('CHANGE-TRUCK-LOG-PASSWORDS.cmd');
const ps = read('tools/truck-log/change-passwords.ps1');
check(sh.includes('SETUP-TRUCK-LOG-ADMIN.sh" --recover') && cmd.includes('SETUP-TRUCK-LOG-ADMIN.cmd" --recover'), '--admin uses administrator recovery');
check(sh.includes('SETUP-RXO-INTEGRATION-CREDENTIALS.sh') && sh.includes('SETUP-RXO-EXPEDITE-CREDENTIALS.sh') && cmd.includes('SETUP-RXO-INTEGRATION-CREDENTIALS.cmd') && cmd.includes('SETUP-RXO-EXPEDITE-CREDENTIALS.cmd'), 'RXO options use the existing credential setup');
check(cmd.includes('tools\\truck-log\\change-passwords.ps1" -Action %ACTION:~2%'), 'Windows wrapper runs the PowerShell implementation');
for (const option of ['--admin', '--database', '--print-secret', '--rxo', '--rxo-expedite', '--all-generated']) check(sh.includes(option) && cmd.includes(option), `both wrappers offer ${option}`);
check(ps.includes("[ValidateSet('database','print-secret','all-generated')]"), 'PowerShell accepts only the generated-secret actions');
check(ps.indexOf('docker exec -i truck-log-postgres psql') > 0 && ps.indexOf('docker exec -i truck-log-postgres psql') < ps.indexOf("Set-EnvValue 'TRUCK_LOG_DATABASE_PASSWORD' $new"), 'PowerShell changes PostgreSQL before .env');
check(ps.includes("if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not accept the change.") && ps.includes("-notmatch '^[A-Za-z0-9_]+$'"), 'PowerShell stops on a refused change or unsafe role name');
check(ps.includes("'-f','docker-compose.yml','-f','docker-compose.https.yml','up','-d'"), 'PowerShell keeps the HTTPS overlay on restart');
check(!/volume rm|docker rm|prune| down/.test(ps + sh + cmd), 'no password command deletes containers or volumes');
// A Windows PC that deploys over SSH may have the Docker CLI without the Compose plugin;
// then "docker compose exec ... --agent-id" fails with "unknown flag". Use the fixed container name.
for (const file of ['SETUP-PRINT-AGENT-CREDENTIAL.cmd', 'SETUP-TRUCK-LOG-ADMIN.cmd']) check(/\ndocker exec (-it )?truck-log-server node /.test(read(file)) && !read(file).includes('docker compose'), `${file} works without the Compose plugin`);

console.log(`[PASS] Change passwords: ${count} checks.`);
