import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readExporterSource } from './rxo/runtime-sources.mjs';

const root = process.cwd();
const logDir = path.join(root, '.runtime-logs');
fs.mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = path.join(logDir, `truck-log-full-live-scan-${stamp}.log`);
const output = [];

const log = (...values) => {
  const line = values.join(' ');
  output.push(line);
  console.log(line);
};

const sleep = (milliseconds) => {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, milliseconds);
};

const run = (command, args, options = {}) => {
  const attempts = options.attempts ?? 1;
  let last = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = spawnSync(command, args, {
      cwd: options.cwd ?? root,
      encoding: 'utf8',
      windowsHide: false,
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    });

    const stdout = last.stdout ?? '';
    const stderr = last.stderr ?? '';
    const combined = `${stdout}\n${stderr}`;
    const transient = /connection reset|exit status 255|port 22|docker\.example\.com|failed to dial gRPC/i.test(
      combined,
    );

    if (last.status === 0 || !transient || attempt === attempts) {
      return {
        status: last.status ?? 1,
        stdout,
        stderr,
      };
    }

    log(`[WARN] ${command} transport retry ${attempt}/${attempts}.`);
    sleep(4_000);
  }

  return {
    status: last?.status ?? 1,
    stdout: last?.stdout ?? '',
    stderr: last?.stderr ?? '',
  };
};

const section = (title) => {
  log('='.repeat(68));
  log(` ${title}`);
  log('='.repeat(68));
};

const excluded = new Set([
  'node_modules',
  '.git',
  '.nx',
  '.angular',
  'dist',
  '_patch_backups',
  '.runtime-logs',
  'data',
  'tmp',
]);
const textPattern = /\.(?:ts|js|mjs|css|ps1|cmd|sql|ya?ml|json|md|html|conf|dockerfile)$/i;
const maxReadBytes = 8 * 1024 * 1024;
const files = [];
const oversized = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) files.push(full);
  }
}

function readSmall(file) {
  const size = fs.statSync(file).size;
  if (size > maxReadBytes) {
    oversized.push({ file: path.relative(root, file).replaceAll('\\', '/'), size });
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

section('TRUCK LOG FULL LIVE SCAN - READ ONLY');
log('[INFO] No source, container, image, volume, database, credential, or network changes are made.');
log(`[INFO] Project: ${root}`);
log(`[INFO] Log: ${logPath}`);

let failures = 0;
let warnings = 0;

section('STEP 1 - BOUNDED STATIC SOURCE SCAN');
walk(root);
const textFiles = files.filter((file) => textPattern.test(file));
let authMarkers = false;
let mutatingRoutes = 0;
let dockerSocket = false;
let timerArchitecture = 'unknown';
let allTextMarkers = '';

for (const file of textFiles) {
  const text = readSmall(file);
  if (!text) continue;
  if (/AuthGuard|JwtAuthGuard|UseGuards|passport|Authorization/i.test(text)) authMarkers = true;
  mutatingRoutes += (text.match(/@(Post|Put|Patch|Delete)\(/g) ?? []).length;
  if (text.includes('/var/run/docker.sock:/var/run/docker.sock')) dockerSocket = true;
  if (text.includes('scheduler-status.json') && text.includes('schedulerHeartbeatAt')) {
    timerArchitecture = 'scheduler-status';
  }
  if (allTextMarkers.length < 4 * 1024 * 1024) {
    allTextMarkers += `\n${text.slice(0, 64 * 1024)}`;
  }
}

log(`[PASS] Files enumerated: ${files.length}`);
log(`[PASS] Text files inspected within ${maxReadBytes} byte limit: ${textFiles.length - oversized.length}`);
if (oversized.length) {
  warnings += 1;
  log(`[WARN] Oversized files skipped safely: ${oversized.length}`);
  for (const item of oversized) {
    log(`       ${item.file} (${item.size} bytes)`);
  }
} else {
  log('[PASS] No oversized source file required skipping.');
}
log(`[INFO] Mutating HTTP route decorators: ${mutatingRoutes}`);
log(`[INFO] Authentication markers: ${authMarkers ? 'FOUND' : 'NONE'}`);
log(`[INFO] Raw Docker socket in Compose: ${dockerSocket ? 'YES' : 'NO'}`);
log(`[INFO] Timer architecture: ${timerArchitecture}`);
if (!authMarkers && mutatingRoutes > 0) {
  warnings += 1;
  log('[WARN] Mutating API routes remain unauthenticated. This is a security-boundary item.');
}

const requiredMarkers = [
  '12808',
  'DANA_USA_FORT_WAYNE_IN',
  '10000',
  'Origin',
  'OUTBOUND',
  'Destination',
  'INBOUND',
];
// Entry point plus its lib/rxo-export-*.mjs modules (site/direction rules live in rxo-export-config.mjs).
const exporter = readExporterSource(root);
for (const marker of requiredMarkers) {
  if (!exporter.includes(marker)) {
    failures += 1;
    log(`[FAIL] Protected exporter marker missing: ${marker}`);
  }
}
if (!failures) log('[PASS] Protected RXO exporter markers are intact.');

section('STEP 2 - AUTHORITATIVE SOURCE VALIDATION');
const validation = run('npm', ['run', 'validate:all'], { attempts: 1, maxBuffer: 64 * 1024 * 1024 });
process.stdout.write(validation.stdout);
process.stderr.write(validation.stderr);
output.push(validation.stdout, validation.stderr);
if (validation.status !== 0) {
  failures += 1;
  log('[FAIL] npm run validate:all failed.');
} else {
  log('[PASS] npm run validate:all passed.');
}

section('STEP 3 - COMPOSE MODEL');
const compose = run('docker', ['compose', 'config'], { attempts: 1, maxBuffer: 32 * 1024 * 1024 });
process.stdout.write(compose.stdout);
process.stderr.write(compose.stderr);
output.push(compose.stdout, compose.stderr);
if (compose.status !== 0) {
  failures += 1;
  log('[FAIL] Docker Compose configuration is invalid.');
} else {
  log('[PASS] Docker Compose configuration is valid.');
  for (const marker of [
    'truck-log-server:',
    'truck-log-web:',
    'rxo-export:',
    'truck-log-rxo-import',
    'truck-log-rxo-data',
    'truck-log',
  ]) {
    if (!compose.stdout.includes(marker)) {
      failures += 1;
      log(`[FAIL] Compose marker missing: ${marker}`);
    }
  }
}

section('STEP 4 - REMOTE DOCKER CONTEXT AND CONTAINERS');
const context = run('docker', ['context', 'show'], { attempts: 3 });
const version = run('docker', ['version', '--format', 'Server={{.Server.Version}}'], { attempts: 3 });
log(context.stdout.trim());
log(version.stdout.trim());
if (context.status !== 0 || version.status !== 0) {
  failures += 1;
  log('[FAIL] Configured Docker context is unreachable.');
} else {
  log('[PASS] Configured remote Docker context is reachable.');
}

const ps = run(
  'docker',
  ['ps', '-a', '--format', '{{json .}}'],
  { attempts: 3, maxBuffer: 32 * 1024 * 1024 },
);
const containers = ps.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

for (const item of containers) {
  log(`${item.Names}\t${item.Image}\t${item.Status}`);
}

const exporterCandidates = containers.filter((item) =>
  (item.Names ?? '') === 'truck-log-rxo-export',
);
log(`\n[INFO] RXO exporter candidates: ${exporterCandidates.length}`);
for (const item of exporterCandidates) {
  log(`       ${item.Names}\t${item.Status}\t${item.Image}`);
}
const runningExporterCandidates = exporterCandidates.filter((item) =>
  /^Up\b/i.test(item.Status ?? ''),
);
if (
  runningExporterCandidates.length !== 1 ||
  runningExporterCandidates[0]?.Names !== 'truck-log-rxo-export'
) {
  warnings += 1;
  log('[WARN] Runtime does not currently have exactly one authoritative truck-log-rxo-export container.');
} else {
  log('[PASS] Exactly one authoritative RXO exporter is running.');
}

const findContainer = (exactName, service) => {
  let result = run('docker', ['inspect', exactName, '--format', '{{.Id}}'], { attempts: 3 });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  result = run(
    'docker',
    ['ps', '-q', '--filter', `label=com.docker.compose.project=truck-log`, '--filter', `label=com.docker.compose.service=${service}`],
    { attempts: 3 },
  );
  return result.stdout.split(/\r?\n/).find(Boolean) ?? '';
};

const serverId = findContainer('truck-log-server', 'truck-log-server');
const webId = findContainer('truck-log-web', 'truck-log-web');
const exporterId = findContainer('truck-log-rxo-export', 'rxo-export');

section('STEP 5 - LIVE API AND WEB CONTRACTS');
if (!serverId) {
  failures += 1;
  log('[FAIL] API container was not found by exact name or Compose service label.');
} else {
  const apiHealth = run('docker', [
    'exec',
    serverId,
    'node',
    '-e',
    "fetch('http://127.0.0.1:3334/api/v1/health/live').then(async r=>{console.log(r.status);console.log(await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})",
  ], { attempts: 3 });
  log(apiHealth.stdout.trim());
  if (apiHealth.status !== 0) {
    failures += 1;
    log('[FAIL] API liveness failed.');
  } else {
    log('[PASS] API liveness passed.');
  }

  const control = run('docker', [
    'exec',
    serverId,
    'node',
    '-e',
    "fetch('http://127.0.0.1:3334/api/v1/rxo/control').then(async r=>{const t=await r.text();console.log(r.status);console.log(t);if(!r.ok||/\"password\"\s*:/.test(t))process.exit(1);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})",
  ], { attempts: 3, maxBuffer: 16 * 1024 * 1024 });
  if (control.status !== 0) {
    failures += 1;
    log('[FAIL] RXO control route or password guard failed.');
  } else {
    log('[PASS] RXO control route responds and does not expose the password.');
  }

  const data = run('docker', [
    'exec',
    serverId,
    'node',
    '-e',
    "const kinds=['orders','shipments','freight'];(async()=>{for(const kind of kinds){const u='http://127.0.0.1:3334/api/v1/rxo/data?'+new URLSearchParams({kind,site:'fort-wayne',page:'1',pageSize:'2'});const r=await fetch(u);const j=await r.json();console.log(kind,r.status,j.total);if(!r.ok||!Array.isArray(j.rows)||typeof j.total!=='number')process.exit(1)}})().catch(e=>{console.error(e.message);process.exit(1)})",
  ], { attempts: 3 });
  log(data.stdout.trim());
  if (data.status !== 0) {
    failures += 1;
    log('[FAIL] One or more RXO data routes failed.');
  } else {
    log('[PASS] Orders, Shipments, and Freight data routes passed.');
  }
}

if (!webId) {
  failures += 1;
  log('[FAIL] Web container was not found by exact name or Compose service label.');
} else {
  const web = run('docker', [
    'exec',
    webId,
    'sh',
    '-c',
    'wget -q -O /dev/null http://127.0.0.1/ || exit 1',
  ], { attempts: 3 });
  if (web.status !== 0) {
    failures += 1;
    log('[FAIL] Web internal health check failed.');
  } else {
    log('[PASS] Web internal health check passed.');
  }
}

section('STEP 6 - MOUNTS AND RECENT LOGS');
for (const [label, id] of [
  ['API', serverId],
  ['WEB', webId],
  ['RXO', exporterId],
]) {
  if (!id) continue;
  const inspect = run('docker', [
    'inspect',
    id,
    '--format',
    '{{.Name}} user={{.Config.User}} network={{.HostConfig.NetworkMode}} restart={{.HostConfig.RestartPolicy.Name}}\n{{range .Mounts}}{{println .Type .Name .Source .Destination .RW}}{{end}}',
  ], { attempts: 3 });
  log(`[${label}]\n${inspect.stdout.trim()}`);
  const logs = run('docker', ['logs', '--tail', '100', id], { attempts: 3, maxBuffer: 16 * 1024 * 1024 });
  log(`[${label} LOGS]\n${logs.stdout.trim()}\n${logs.stderr.trim()}`);
}

section('FINAL SUMMARY');
log(`[SUMMARY] ${failures} failure(s), ${warnings} warning(s).`);
if (failures === 0) log('[PASS] Truck Log full live scan completed.');
else log('[FAIL] Truck Log full live scan found blocking failures.');
log(`[INFO] Log: ${logPath}`);
fs.writeFileSync(logPath, `${output.join('\n')}\n`, 'utf8');
process.exitCode = failures === 0 ? 0 : 1;
