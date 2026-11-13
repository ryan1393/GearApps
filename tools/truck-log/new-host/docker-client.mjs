import { spawnSync } from 'node:child_process';

export class DockerClient {
  constructor({ context, root = process.cwd(), executable = 'docker', secrets = [] } = {}) {
    this.context = context; this.root = root; this.executable = executable; this.secrets = secrets;
  }
  redact(value) {
    let text = String(value || '');
    for (const secret of this.secrets) if (secret) text = text.split(secret).join('[REDACTED]');
    return text;
  }
  run(args, { label = args[0], input, timeout = 180000, allowFailure = false, env = process.env, visible = false } = {}) {
    const all = this.context ? ['--context', this.context, ...args] : args;
    const r = spawnSync(this.executable, all, { cwd: this.root, input, encoding: 'utf8',
      stdio: visible ? 'inherit' : 'pipe', shell: false, windowsHide: true,
      timeout, maxBuffer: 16 * 1024 * 1024, env });
    const result = { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
    if ((r.error || result.status !== 0) && !allowFailure) {
      throw new Error(`${label} failed: ${this.redact(r.error?.message || result.stderr || result.stdout || `exit ${result.status}`).slice(-5000)}`);
    }
    return result;
  }
  json(args, options) { return JSON.parse(this.run(args, options).stdout); }
  inspect(name) {
    const r = this.run(['inspect', name], { allowFailure: true, label: `Inspect ${name}` });
    if (r.status !== 0) {
      if (/no such (object|container)/i.test(r.stderr)) return null;
      throw new Error(`Cannot inspect ${name}: ${this.redact(r.stderr || r.error?.message)}`);
    }
    return JSON.parse(r.stdout)[0];
  }
}
export function resolveContext(root = process.cwd()) {
  if (process.env.DOCKER_HOST) throw new Error('DOCKER_HOST is set. Clear it before setup so setup and your later Compose command target the same selected context.');
  const d = new DockerClient({ root });
  const ctx = d.run(['context', 'show'], { label: 'Read active Docker context' }).stdout.trim();
  if (!ctx || /[\r\n]/.test(ctx)) throw new Error('Could not identify the active Docker context.');
  return ctx;
}
export async function stopContainerVerified(docker, name) {
  const before = docker.inspect(name);
  if (!before) return false;
  const active = Boolean(before.State?.Running || before.State?.Restarting);
  if (!active) return false;
  // After a transport reset, a stop may have succeeded remotely. Inspect before
  // deciding to fail; do not hammer an SSH endpoint with repeated state changes.
  const stop = docker.run(['stop', '--time', '20', name], { allowFailure: true, timeout: 60000, label: `Stop ${name}` });
  let last;
  for (let i = 0; i < 6; i++) {
    try {
      const now = docker.inspect(name);
      if (now && !now.State?.Running && !now.State?.Restarting) return true;
    } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Cannot prove ${name} stopped; no concurrent browser/credential operation will run. ${docker.redact(last?.message || stop.stderr)}`);
}
