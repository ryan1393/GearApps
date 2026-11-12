#!/usr/bin/env node
// MeshForge remote deploy (replaces Dana-Apps-Native-Remote-Deploy.cmd).
//
// Packs the shared repository root, copies it over SSH to the Linux Docker host behind the
// active SSH Docker context, backs up the database, swaps the new source in (the
// previous copy is kept for --rollback), then runs `docker compose build` and
// `up -d`. It never runs `compose down`, never deletes volumes, and keeps the
// server's own .env and FANUC FOCAS library (apps/lapper-read-py/fanuc/libfwlib32*).
//
//   node tools/manufacturing/deploy/deploy-remote.mjs                 deploy this folder
//   node tools/manufacturing/deploy/deploy-remote.mjs --rollback      put the previous release back
//   node tools/manufacturing/deploy/deploy-remote.mjs --check         preflight only, change nothing
//
// Options:
//   --context <name>        Docker context to use (default: the active one; must be ssh://)
//   --remote-root <path>    Release folder on the host (default: ~/dana-apps)
//   --legacy-root <path>    Old release folder to carry .env from (default: /tmp/dana-apps.v0.1)
//   --upload-env            First deploy only: copy root .env when the host has none
//   --skip-backup           Do not pg_dump before deploying (not recommended)
//   --allow-weak-secrets    Accepted for older scripts; weak JWT secrets only warn now
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const PROJECT = 'dana-apps'; // compose.yml `name:` - containers and volumes belong to this project

// ---------- arguments ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const MODE = flag('--rollback') ? 'rollback' : flag('--check') ? 'check' : 'deploy';
const REMOTE_ROOT = option('--remote-root', '~/dana-apps');
const LEGACY_ROOT = option('--legacy-root', '/tmp/dana-apps.v0.1');
const BACKUP_DIR = '~/dana-apps-backups';

// ---------- helpers ----------
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
// Remote paths may start with ~; expand on the host, quote everything else.
const rq = (p) => (p.startsWith('~/') ? `"$HOME"/'${p.slice(2).replace(/'/g, "'\\''")}'` : `'${p.replace(/'/g, "'\\''")}'`);

function run(cmd, args, { capture = false, allowFail = false, input } = {}) {
  if (!capture) console.log('> ' + cmd + ' ' + args.join(' '));
  const r = cp.spawnSync(cmd, args, {
    cwd: ROOT, encoding: 'utf8', shell: false, input,
    // Captured calls buffer output; everything else streams (compose build can print many MB).
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : input !== undefined ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) {
    if (allowFail) return { status: 127, output: String(r.error.message), stdout: '' };
    throw r.error;
  }
  const output = (r.stdout ?? '') + (r.stderr ?? '');
  if (!allowFail && r.status !== 0) {
    if (output.trim()) console.error(output.trimEnd());
    fail(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
  }
  return { status: r.status ?? 1, output, stdout: r.stdout ?? '' };
}

function sshContext() {
  const name = option('--context', run('docker', ['context', 'show'], { capture: true }).output.trim());
  const info = JSON.parse(run('docker', ['context', 'inspect', name], { capture: true }).output);
  const endpoint = info?.[0]?.Endpoints?.docker?.Host;
  if (!endpoint || !/^ssh:\/\//i.test(endpoint)) fail(`Docker context "${name}" must be an ssh:// context; it is ${endpoint}`);
  const u = new URL(endpoint);
  const user = decodeURIComponent(u.username || '');
  return {
    name, endpoint, host: u.hostname,
    target: user ? `${user}@${u.hostname}` : u.hostname,
    sshPort: u.port ? ['-p', u.port] : [],
    scpPort: u.port ? ['-P', u.port] : [],
  };
}

// Run a bash script on the host; the script travels on stdin, so nothing needs escaping.
function remote(ctx, script, opts = {}) {
  return run('ssh', [...ctx.sshPort, ctx.target, 'bash -s'], { ...opts, input: script, capture: opts.capture ?? false });
}
function remoteOut(ctx, script) {
  return remote(ctx, script, { capture: true }).output;
}

// ---------- remote scripts ----------
const COMPOSE_FN = `
if [ -f compose.yml ]; then COMPOSE_FILE=compose.yml; ENV_FILE=.env
elif [ -f manufacturing/compose.yml ]; then COMPOSE_FILE=manufacturing/compose.yml; ENV_FILE=manufacturing/.env
else COMPOSE_FILE=docker-compose.yml; ENV_FILE=.env; fi
if docker compose version >/dev/null 2>&1; then compose(){ docker compose -p ${PROJECT} --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then compose(){ docker-compose -p ${PROJECT} --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
else echo '[FAIL] Docker Compose is not installed on the host.' >&2; exit 42; fi`;

const envCheckScript = (root) => `set -eu
ENV=${rq(root)}/.env
if [ ! -f ${rq(root)}/compose.yml ] && [ -f ${rq(root)}/manufacturing/compose.yml ]; then ENV=${rq(root)}/manufacturing/.env; fi
[ -f "$ENV" ] || { echo NO_ENV; exit 0; }
val(){ grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- | tr -d '\\r"' ; }
weak(){ v="$(val "$1")"; if [ "\${#v}" -lt 32 ] || printf '%s' "$v" | grep -qiE 'change|example|placeholder|replace|secret$|^x+$'; then echo "WEAK $1"; fi; }
weak JWT_ACCESS_SECRET; weak JWT_REFRESH_SECRET
p="$(val GEAR_DB_PASSWORD)"; [ "\${#p}" -ge 12 ] || echo "SHORTDB GEAR_DB_PASSWORD"
grep -qE '^MESHFORGE_ALLOW_TEST_ACCOUNTS=YES' "$ENV" && echo "TEST_ACCOUNTS_ENABLED" || true
echo ENV_OK`;

// Finds Postgres by its compose labels, so it works whatever folder the release is in, and
// uses the container's own POSTGRES_USER/POSTGRES_DB (the host .env is never sourced).
const backupScript = (label) => `set -euo pipefail
umask 077
PG="$(docker ps -q --filter label=com.docker.compose.project=${PROJECT} --filter label=com.docker.compose.service=dana-postgres | head -1 || true)"
if [ -z "$PG" ]; then
  echo '[SKIP] No running dana-postgres container (first install); nothing to back up.'; exit 0
fi
mkdir -p ${rq(BACKUP_DIR)}
OUT=${rq(BACKUP_DIR)}/meshforge-${label}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
docker exec "$PG" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip > "$OUT"
[ "$(gzip -dc "$OUT" | head -c 4096 | grep -c 'PostgreSQL database dump')" -ge 1 ] || { echo "[FAIL] Backup $OUT looks empty." >&2; exit 43; }
ls -1t ${rq(BACKUP_DIR)}/meshforge-*.sql.gz | tail -n +21 | xargs -r rm -f   # keep the newest 20
echo "[PASS] Database backed up to $OUT ($(du -h "$OUT" | cut -f1))"`;

// Removes a release folder. A one-off container run as root (CLEAR-OPERATIONAL-DATA before
// it ran as the host account) can leave root-owned files in a release, which this account
// cannot delete; those are removed from a throwaway root container using an image this
// project already runs, so nothing is pulled. Anything else stops with the exact command.
const REMOVE_TREE_FN = `remove_tree() {
  [ -e "$1" ] || [ -L "$1" ] || return 0
  rm -rf "$1" 2>/dev/null && return 0
  local parent name img
  parent="$(cd "$(dirname "$1")" && pwd)"; name="$(basename "$1")"
  img="$(docker ps --filter "label=com.docker.compose.project=${PROJECT}" --format '{{.Image}}' 2>/dev/null | head -1)"
  if [ -n "$img" ] && docker run --rm --user 0:0 --network none --entrypoint rm -v "$parent:/parent" "$img" -rf "/parent/$name" >/dev/null 2>&1 && [ ! -e "$1" ]; then
    echo "[PASS] Removed $1 (it held files owned by another account)."
    return 0
  fi
  echo "[FAIL] Could not remove $1: it holds files owned by another account. Run: sudo rm -rf '$1'" >&2
  return 1
}`;

// The Lapper Read collector mounts LAPPER_READ_FOCAS_DIR (default ./apps/lapper-read-py/fanuc,
// relative to the release) at /opt/fanuc. FANUC's licensed libfwlib32.so is git-ignored, so a
// release packed from a fresh clone or GitHub ZIP has none: like .env, it is carried over from
// the release being replaced. A folder outside the release (absolute path) is left alone.
const FOCAS_FN = `# Prints the release-relative FOCAS folder from an .env, or nothing when it is outside the release.
focas_rel() {
  local v=''
  if [ -f "$1" ]; then
    v="$(grep -E '^LAPPER_READ_FOCAS_DIR=' "$1" | tail -1 | cut -d= -f2- | sed 's/[[:space:]]#.*$//' | tr -d "\\r\\"'" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || true)"
  fi
  case "$v" in
    '') echo 'apps/lapper-read-py/fanuc' ;;
    /*|'~'*|'$'*|..|../*) ;;
    *) v="\${v#./}"; v="\${v%/}"; echo "\${v:-.}" ;;
  esac
}
has_focas() { [ -e "$1/libfwlib32.so" ]; }
# carry_focas FROM TO REL: copies libfwlib32* (symlinks kept) when TO lacks the library and FROM has it.
carry_focas() {
  local from="$1/$3" to="$2/$3" f
  has_focas "$to" && return 0
  has_focas "$from" || return 1
  mkdir -p "$to"
  for f in "$from"/libfwlib32*; do
    [ -e "$to/\${f##*/}" ] || [ -L "$to/\${f##*/}" ] || cp -pP "$f" "$to/"
  done
  echo "[PASS] FANUC FOCAS library carried over from $1."
}
# The collector runs as an unprivileged container user, and releases unpack owner-only (umask 077).
# The release folder itself stays owner-only, so this exposes nothing to other host accounts.
open_focas() {
  [ -d "$1" ] && has_focas "$1" || return 0
  chmod a+rx "$1"
  find "$1" -maxdepth 1 -type f -name 'libfwlib32*' -exec chmod a+r {} +
}
warn_no_focas() {
  local c
  c="$( { docker ps -a -q --filter label=com.docker.compose.project=${PROJECT} --filter label=com.docker.compose.service=lapper-read 2>/dev/null || true; } | head -1)"
  [ -n "$c" ] || return 0
  echo "[WARN] No FANUC FOCAS library at $1/libfwlib32.so: the Lapper Read collector cannot record cycles." >&2
  echo "       Copy libfwlib32.so there, or set LAPPER_READ_FOCAS_DIR in .env to an absolute folder outside the release." >&2
}`;

// Release folders: BASE (current), BASE.prev (last good), BASE.pending-prev (the release that
// was current when an unfinished deploy started). A deploy that fails leaves pending-prev in
// place, so a retry discards the failed release instead of making it the rollback target.
const stageScript = (root, legacy, archive, uploadedEnv) => `set -euo pipefail
umask 077
BASE=${rq(root)}; NEXT="$BASE.next"; PEND="$BASE.pending-prev"; LEGACY=${rq(legacy)}
${REMOVE_TREE_FN}
${FOCAS_FN}
mkdir -p "$(dirname "$BASE")"
remove_tree "$NEXT"; mkdir -p "$NEXT"
tar -xzf ${rq(archive)} -C "$NEXT"
# The release is packed on Windows, whose tar keeps no Unix execute bits: make the shipped
# shell scripts (commands/*.sh and the tools) runnable as ./script.sh again.
find "$NEXT" -type f -name '*.sh' -exec chmod u+x {} +
SOURCE_ENV=''
for TREE in "$BASE" "$PEND" "$LEGACY"; do
  if [ ! -f "$TREE/compose.yml" ] && [ -f "$TREE/manufacturing/compose.yml" ]; then CANDIDATE="$TREE/manufacturing/.env"
  else CANDIDATE="$TREE/.env"; fi
  if [ -f "$CANDIDATE" ]; then SOURCE_ENV="$CANDIDATE"; break; fi
done
if [ -n "$SOURCE_ENV" ]; then cp -p "$SOURCE_ENV" "$NEXT/.env"
elif [ -f ${rq(uploadedEnv)} ]; then tr -d '\\r' < ${rq(uploadedEnv)} > "$NEXT/.env"; rm -f ${rq(uploadedEnv)}
else echo '[FAIL] The host has no shared .env. Re-run with --upload-env for the first install.' >&2; exit 41; fi
chmod 600 "$NEXT/.env"
test -f "$NEXT/compose.yml"
test -f "$NEXT/package-lock.json"
FOCAS_REL="$(focas_rel "$NEXT/.env")"
if [ -n "$FOCAS_REL" ]; then
  for TREE in "$BASE" "$PEND"; do carry_focas "$TREE" "$NEXT" "$FOCAS_REL" && break; done || true
  open_focas "$NEXT/$FOCAS_REL"
  has_focas "$NEXT/$FOCAS_REL" || warn_no_focas "$BASE/$FOCAS_REL"
fi
if [ -d "$PEND" ]; then
  echo "[RETRY] Discarding the failed release while preserving $PEND as the last good release."
  remove_tree "$BASE"
elif [ -d "$BASE" ]; then mv "$BASE" "$PEND"; fi
mv "$NEXT" "$BASE"
rm -f ${rq(archive)}
echo "[PASS] Consolidated release ${VERSION} staged at $BASE."`;

// Called only after every service is healthy: the pending release becomes the rollback target.
const finalizeScript = (root) => `set -euo pipefail
BASE=${rq(root)}; PEND="$BASE.pending-prev"; PREV="$BASE.prev"
${REMOVE_TREE_FN}
if [ -d "$PEND" ]; then remove_tree "$PREV"; mv "$PEND" "$PREV"; fi
echo "[PASS] Previous release kept at $PREV for --rollback."`;

const rollbackSwapScript = (root, legacy) => `set -euo pipefail
umask 077
BASE=${rq(root)}; PREV="$BASE.prev"; PEND="$BASE.pending-prev"; TMP="$BASE.rollback-tmp"; LEGACY=${rq(legacy)}
${REMOVE_TREE_FN}
${FOCAS_FN}
if [ -d "$PEND" ]; then TARGET="$PEND"
elif [ -d "$PREV" ]; then TARGET="$PREV"
elif [ -f "$LEGACY/compose.yml" ] || [ -f "$LEGACY/manufacturing/compose.yml" ]; then TARGET="$LEGACY"
else echo "[FAIL] No previous release is available." >&2; exit 44; fi
KEEP="$(mktemp -d)"; trap 'rm -rf "$KEEP"' EXIT
if [ -f "$BASE/compose.yml" ]; then CURRENT_ENV="$BASE/.env"
elif [ -f "$BASE/manufacturing/compose.yml" ]; then CURRENT_ENV="$BASE/manufacturing/.env"
else CURRENT_ENV="$BASE/.env"; fi
[ ! -f "$CURRENT_ENV" ] || cp -p "$CURRENT_ENV" "$KEEP/active.env"
remove_tree "$TMP"; mv "$BASE" "$TMP"; mv "$TARGET" "$BASE"; remove_tree "$PREV"; mv "$TMP" "$PREV"
if [ -f "$BASE/compose.yml" ]; then TARGET_ENV="$BASE/.env"
elif [ -f "$BASE/manufacturing/compose.yml" ]; then TARGET_ENV="$BASE/manufacturing/.env"
else TARGET_ENV="$BASE/.env"; fi
[ ! -f "$KEEP/active.env" ] || cp -p "$KEEP/active.env" "$TARGET_ENV"
# An older release may predate the FANUC library on this host: keep the one just replaced.
FOCAS_REL="$(focas_rel "$TARGET_ENV")"
if [ -n "$FOCAS_REL" ]; then
  carry_focas "$PREV" "$BASE" "$FOCAS_REL" || true
  open_focas "$BASE/$FOCAS_REL"
fi
echo "[PASS] Previous release restored with the current host environment preserved."`;

const upScript = (root) => `set -euo pipefail
cd ${rq(root)}
${COMPOSE_FN}
export COMPOSE_PARALLEL_LIMIT=1
compose config --quiet
# The Lapper Read collector (compose profile "collectors") is only started by hand. When it already
# has a container here, rebuild and restart it with this release so it never keeps an old image.
COLLECTOR=''
if compose --profile collectors config --services 2>/dev/null | grep -qx lapper-read \
  && [ -n "$(compose --profile collectors ps -a -q lapper-read 2>/dev/null)" ]; then COLLECTOR=lapper-read; fi
compose build
if [ -n "$COLLECTOR" ]; then compose --profile collectors build lapper-read; fi
if ! compose up -d --no-build; then
  echo '----- setup step logs -----' >&2
  compose logs --no-color --tail 40 gear-db-bootstrap gear-base-data-bootstrap >&2 || true
  exit 1
fi
if [ -n "$COLLECTOR" ]; then
  compose --profile collectors up -d --no-build --no-deps --force-recreate lapper-read
  echo '[PASS] Lapper Read collector rebuilt and restarted with this release.'
else
  echo '[INFO] Lapper Read collector is not running here. Start it once with: docker compose --profile collectors up -d lapper-read'
fi
compose ps -a`;

// Same rules as envCheckScript, for a local .env about to be uploaded.
function localEnvCheck(text) {
  const vals = {};
  for (const line of text.split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line); if (m) vals[m[1]] = m[2].replace(/["\r]/g, ''); }
  const out = [];
  for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const v = vals[k] ?? '';
    if (v.length < 32 || /change|example|placeholder|replace|secret$|^x+$/i.test(v)) out.push('WEAK ' + k);
  }
  if ((vals.GEAR_DB_PASSWORD ?? '').length < 12) out.push('SHORTDB GEAR_DB_PASSWORD');
  if (vals.MESHFORGE_ALLOW_TEST_ACCOUNTS === 'YES') out.push('TEST_ACCOUNTS_ENABLED');
  return out.concat('ENV_OK').join('\n');
}

// ---------- runtime checks ----------
// Returns null when the container is missing or the ssh/docker call failed; callers retry. Only
// stdout is trusted: an ssh or docker warning on stderr must never be mistaken for a container id.
function containerState(ctx, service) {
  const ps = run('docker', ['--context', ctx.name, 'ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--filter', `label=com.docker.compose.service=${service}`], { capture: true, allowFail: true });
  if (ps.status !== 0) return null;
  const id = ps.stdout.trim().split(/\r?\n/)[0];
  if (!/^[0-9a-f]{12,64}$/i.test(id)) return null;
  const r = run('docker', ['--context', ctx.name, 'inspect', id], { capture: true, allowFail: true });
  if (r.status !== 0) return null;
  try { return { id, state: JSON.parse(r.stdout)[0].State }; } catch { return null; }
}

async function waitFor(ctx, service, { oneShot = false, minutes = 8 } = {}) {
  console.log(`[WAIT] ${service} ${oneShot ? '(must exit 0)' : '(running/healthy)'}`);
  const end = Date.now() + minutes * 60_000;
  while (Date.now() < end) {
    const c = containerState(ctx, service);
    if (c) {
      const s = c.state;
      if (oneShot && s.Status === 'exited') {
        if (Number(s.ExitCode) === 0) return console.log(`[PASS] ${service} exited 0.`);
        run('docker', ['--context', ctx.name, 'logs', '--tail', '120', c.id], { allowFail: true });
        fail(`${service} exited ${s.ExitCode}`);
      }
      if (!oneShot) {
        if (['exited', 'dead'].includes(s.Status)) { run('docker', ['--context', ctx.name, 'logs', '--tail', '120', c.id], { allowFail: true }); fail(`${service} is ${s.Status}`); }
        if (s.Status === 'running' && (!s.Health || s.Health.Status === 'healthy')) return console.log(`[PASS] ${service} ${s.Health?.Status ?? 'running'}.`);
        if (s.Health?.Status === 'unhealthy') { run('docker', ['--context', ctx.name, 'logs', '--tail', '120', c.id], { allowFail: true }); fail(`${service} is unhealthy`); }
      }
    }
    await sleep(3000);
  }
  fail(`${service} was not ready within ${minutes} minutes`);
}

// Asks the API from inside its own container, so host firewalls and ssh aliases don't matter.
async function verifyVersion(ctx, expected) {
  const probe = "fetch('http://127.0.0.1:3333/api/v1/health/live').then(r=>r.json()).then(j=>console.log(j.version||'none')).catch(e=>console.log('error '+e.message))";
  let seen = '';
  for (let i = 0; i < 10; i++) {
    // Look the container up on every attempt: one failed ssh call must not end the deploy.
    const api = containerState(ctx, 'meshforge-server');
    seen = api
      ? run('docker', ['--context', ctx.name, 'exec', api.id, 'node', '-e', probe], { capture: true, allowFail: true }).stdout.trim()
      : 'meshforge-server container not found';
    if (seen === expected) return console.log(`[PASS] API reports version ${seen}.`);
    await sleep(3000);
  }
  fail(`API did not report version ${expected} (last answer: ${seen || 'nothing'})`);
}

async function waitAll(ctx) {
  await waitFor(ctx, 'dana-postgres');
  await waitFor(ctx, 'gear-db-bootstrap', { oneShot: true, minutes: 10 });
  await waitFor(ctx, 'gear-base-data-bootstrap', { oneShot: true, minutes: 10 });
  await waitFor(ctx, 'meshforge-server');
  // Older rollback releases predate the Lapper services.
  if (containerState(ctx, 'lapper-client')) await waitFor(ctx, 'lapper-client', { minutes: 6 });
  for (const ui of ['blade-tracking', 'cutter-builder', 'greenshed']) await waitFor(ctx, ui, { minutes: 6 });
}

function writeReport(lines) {
  const dir = path.join(ROOT, 'deploy-reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `MeshForge-${VERSION}-${MODE}-${stamp()}.txt`);
  fs.writeFileSync(file, lines.join(os.EOL) + os.EOL);
  return file;
}

// ---------- main ----------
async function main() {
  console.log(`MeshForge ${VERSION} - ${MODE}`);
  for (const tool of ['ssh', 'scp', 'tar', 'docker']) {
    if (run(tool, tool === 'ssh' ? ['-V'] : ['--version'], { capture: true, allowFail: true }).status === 127) fail(`${tool} is not installed or not on PATH`);
  }
  if (MODE !== 'rollback') run(process.execPath, ['tools/manufacturing/test-version-consistency-contract.mjs']);

  const ctx = sshContext();
  console.log(`[PASS] Docker context ${ctx.name} -> ${ctx.target}`);
  remote(ctx, 'docker version --format "[PASS] Host Docker {{.Server.Version}}"');

  const legacyHasEnv = remoteOut(ctx, `{ [ -f ${rq(LEGACY_ROOT)}/.env ] || [ -f ${rq(LEGACY_ROOT)}/manufacturing/.env ]; } && echo yes || true`).trim() === 'yes';
  let env = remoteOut(ctx, envCheckScript(REMOTE_ROOT));
  if (env.includes('NO_ENV') && legacyHasEnv) env = remoteOut(ctx, envCheckScript(LEGACY_ROOT));
  const uploadEnv = env.includes('NO_ENV') && MODE === 'deploy';
  if (uploadEnv) {
    if (!flag('--upload-env')) fail('The host has no .env yet. For a first install, re-run with --upload-env.');
    const local = path.join(ROOT, '.env');
    if (!fs.existsSync(local)) fail('--upload-env was given but the root .env is missing');
    env = localEnvCheck(fs.readFileSync(local, 'utf8'));
    console.log('[INFO] First install: the root .env will be uploaded.');
  }
  const weak = env.split(/\r?\n/).filter((l) => l.startsWith('WEAK '));
  if (env.includes('TEST_ACCOUNTS_ENABLED')) fail('The .env being deployed sets MESHFORGE_ALLOW_TEST_ACCOUNTS=YES. Remove it: production must never allow test accounts.');
  if (/^SHORTDB /m.test(env)) {
    console.warn('[WARN] GEAR_DB_PASSWORD is shorter than 12 characters. Postgres only reads it when the volume is first created,\n' +
      '       so change it inside Postgres first (ALTER USER ... PASSWORD ...), then in .env, then deploy.');
  }
  // The owner decides on the host's secrets, so weak ones only warn (the API does the same at
  // startup). The API itself still refuses secrets under 16 characters.
  if (weak.length) {
    console.warn(`[WARN] The .env being deployed has weak or placeholder values: ${weak.map((w) => w.slice(5)).join(', ')}.\n` +
      '       JWT secrets should be 32+ random characters (anyone who knows them can sign an admin login).\n' +
      '       Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n' +
      '       Changing the JWT secrets signs everyone out once; nothing else is affected. Deploying anyway.');
  }

  if (MODE === 'check') {
    console.log('[PASS] Preflight complete. Nothing was changed.');
    return;
  }

  if (!flag('--skip-backup')) remote(ctx, backupScript(MODE === 'rollback' ? 'before-rollback' : `before-${VERSION}`));

  if (MODE === 'rollback') {
    remote(ctx, rollbackSwapScript(REMOTE_ROOT, LEGACY_ROOT));
  } else {
    const archive = path.join(os.tmpdir(), `meshforge-${VERSION}-${Date.now()}.tar.gz`);
    const remoteUploadDir = remoteOut(ctx, 'umask 077; mktemp -d /tmp/meshforge-upload.XXXXXXXXXX').trim();
    if (!/^\/tmp\/meshforge-upload\.[A-Za-z0-9]+$/.test(remoteUploadDir)) fail('Unable to create private remote upload staging directory');
    const remoteArchive = `${remoteUploadDir}/source.tar.gz`;
    const remoteEnv = `${remoteUploadDir}/environment`;
    try {
      run('tar', ['-czf', archive,
        '--exclude=./node_modules', '--exclude=./.nx', '--exclude=./dist', '--exclude=./.angular', '--exclude=./.git',
        '--exclude=./_patch_backups', '--exclude=./deploy-reports', '--exclude=./tools/manufacturing/data-import/work',
        '--exclude=./swagger.json', '--exclude=.env', '--exclude=.env.*', '--exclude=.npmrc',
        '--exclude=.ssh', '--exclude=*.pem', '--exclude=*.key', '--exclude=./coverage', '-C', ROOT, '.']);
      console.log(`[PASS] Packed ${Math.round(fs.statSync(archive).size / 1048576 * 10) / 10} MB`);
      run('scp', [...ctx.scpPort, archive, `${ctx.target}:${remoteArchive}`]);
      if (uploadEnv) {
        remote(ctx, `umask 077; : > ${rq(remoteEnv)}`); // scp into an existing 600 file keeps it private
        run('scp', [...ctx.scpPort, path.join(ROOT, '.env'), `${ctx.target}:${remoteEnv}`]);
      }
      remote(ctx, stageScript(REMOTE_ROOT, LEGACY_ROOT, remoteArchive, remoteEnv));
    } finally {
      fs.rmSync(archive, { force: true });
      try { remote(ctx, `rm -rf -- ${rq(remoteUploadDir)}`); } catch { console.warn('[WARN] Private upload directory cleanup failed.'); }
    }
  }

  remote(ctx, upScript(REMOTE_ROOT));
  try {
    await waitAll(ctx);
    if (MODE !== 'rollback') await verifyVersion(ctx, VERSION);
  } catch (e) {
    console.error(`[FAIL] ${e.message}`);
    fail(`The new release is not healthy. Run with --rollback to restore the last good release (database backup in ${BACKUP_DIR}).`);
  }
  if (MODE !== 'rollback') remote(ctx, finalizeScript(REMOTE_ROOT));

  const report = writeReport([
    `MESHFORGE ${VERSION} ${MODE.toUpperCase()} - PASS`, '',
    `Docker context: ${ctx.name} (${ctx.target})`, `Release folder: ${REMOTE_ROOT}`, `Previous release: ${REMOTE_ROOT}.prev`,
    `Database backup: ${flag('--skip-backup') ? 'SKIPPED' : BACKUP_DIR}`, '',
    'compose down: NO', 'volumes deleted: NO', 'host root .env preserved: YES',
  ]);
  console.log(`\n[PASS] MeshForge ${MODE} complete. Report: ${report}`);
  console.log(`Blade Tracking: http://${ctx.host}:4200   Cutter Builder: http://${ctx.host}:4201   Greenshed: http://${ctx.host}:4202`);
}

export { envCheckScript, stageScript, finalizeScript, rollbackSwapScript, upScript, containerState, verifyVersion, REMOVE_TREE_FN };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('\n[FAIL] ' + (e?.message ?? e));
    console.error('[SAFE] No compose down, database reset or volume deletion is ever run by this script.');
    process.exit(1);
  });
}
