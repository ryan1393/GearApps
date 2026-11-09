/**
 * Select a real Compose frontend before any container mutation.
 * `docker compose` and the standalone `docker-compose.exe` are different entry
 * points. Never interpret Docker's top-level help as a successful Compose probe.
 * Do not retry a failed build/up using another frontend: the first command may
 * have already made changes. The selected frontend is reused for cleanup.
 */
import { spawnSync } from 'node:child_process';

export function parseComposeVersion(value) {
  const match = String(value || '').trim().match(
    /^(?:Docker Compose version\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z._-]+)?$/i,
  );
  return match && Number(match[1]) >= 2 ? match[0].replace(/^Docker Compose version\s+/i, '') : null;
}

function scopedEnvironment(docker, env) {
  if (!docker.context || /[\r\n\0]/.test(docker.context)) throw new Error('Compose requires an explicitly resolved Docker context.');
  // Windows environment names are case-insensitive. Do not retain a second,
  // differently-cased DOCKER_CONTEXT that could override the pinned value.
  const scoped = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === 'DOCKER_CONTEXT') continue;
    if (key.toUpperCase() === 'DOCKER_HOST' && value) throw new Error('DOCKER_HOST is set. Clear it before using the selected Docker context.');
    scoped[key] = value;
  }
  scoped.DOCKER_CONTEXT = docker.context;
  return scoped;
}

function standaloneRun(docker, executable, spawnProcess, args, options = {}) {
  const { label = `Compose ${args[0] || 'command'}`, input, timeout = 180000,
    allowFailure = false, env = process.env, visible = false } = options;
  const r = spawnProcess(executable, args, {
    cwd: docker.root, input, encoding: 'utf8', shell: false,
    stdio: visible ? 'inherit' : 'pipe', windowsHide: true,
    timeout, maxBuffer: 16 * 1024 * 1024, env: scopedEnvironment(docker, env),
  });
  const result = { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
  if ((r.error || result.status !== 0) && !allowFailure) {
    throw new Error(`${label} failed: ${docker.redact(r.error?.message || result.stderr || result.stdout || `exit ${result.status}`).slice(-5000)}`);
  }
  return result;
}

export function resolveCompose(docker, { spawnProcess = spawnSync, platform = process.platform, env = process.env } = {}) {
  // Even a version probe must use the same context/config environment as actions.
  const scoped = scopedEnvironment(docker, env);
  const candidates = [
    { command: 'docker compose', kind: 'plugin',
      invoke: (args, options) => docker.run(['compose', ...args], options) },
    { command: 'docker-compose', kind: 'standalone',
      invoke: (args, options) => standaloneRun(docker, platform === 'win32' ? 'docker-compose.exe' : 'docker-compose', spawnProcess, args, options) },
  ];
  const failures = [];
  for (const candidate of candidates) {
    const probe = candidate.invoke(['version', '--short'], {
      label: `${candidate.command} version`, allowFailure: true, timeout: 15000, env: scoped,
    });
    const version = !probe.error && probe.status === 0 ? parseComposeVersion(probe.stdout) : null;
    if (!version) {
      failures.push(`${candidate.command}: ${docker.redact(probe.error?.message || probe.stderr || probe.stdout || 'no Compose version').trim().slice(0, 450)}`);
      continue;
    }
    const help = candidate.invoke(['--help'], {
      label: `${candidate.command} profile support`, allowFailure: true, timeout: 15000, env: scoped,
    });
    if (help.error || help.status !== 0 || !/(?:^|\s)--profile(?:\s|=|,|$)/m.test(help.stdout)) {
      failures.push(`${candidate.command}: Compose ${version} did not advertise --profile support.`);
      continue;
    }
    return Object.freeze({
      command: candidate.command, kind: candidate.kind, version,
      run(args, options = {}) {
        if (!Array.isArray(args) || !args.length || args.some(x => typeof x !== 'string' || x.includes('\0'))) {
          throw new Error('Compose requires an argument array, not a shell command.');
        }
        return candidate.invoke(args, { ...options, env: scopedEnvironment(docker, options.env || env) });
      },
    });
  }
  throw new Error('No working Compose v2+ frontend with profiles was found. Both docker compose and docker-compose were checked before any browser/scheduler change.\n' + failures.join('\n'));
}
