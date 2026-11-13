import type { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { RECOVERY_HELPER } from './recovery-helper';
import { recoveryObservation, type RecoveryObservation, type RecoveryRole } from './recovery-policy';

export type RecoveryDockerRun = (args: string[], timeoutMs?: number) => Promise<{ ok: boolean; stdout: string }>;
/** stdout and duration are bounded; native stderr can contain secrets and is discarded. */
export const runRecoveryDocker: RecoveryDockerRun = (args, timeoutMs = 15000) => new Promise(resolve => {
  let output = '', bytes = 0, settled = false;
  const child = spawn(process.platform === 'win32' ? 'docker.exe' : 'docker', args, { shell: false, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  const finish = (ok: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ok, stdout: ok ? output : ''}); } };
  const timer = setTimeout(() => { child.kill('SIGKILL'); finish(false); }, timeoutMs);
  child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65536) { child.kill('SIGKILL'); finish(false); } else output += String(chunk); });
  child.stderr.on('data', () => undefined);
  child.on('error', () => finish(false));
  child.on('close', code => finish(code === 0));
});
export interface RecoveryTarget { id: string; role: RecoveryRole; image: string; imageId: string; dataVolume: string; credentialVolume: string; running: boolean; restarting: boolean; }
const services = { standard: 'rxo-export', expedite: 'rxo-expedite-scheduler' };
const images = { standard: 'truck-log-rxo-export', expedite: 'truck-log-rxo-expedite' };
const components = { standard: 'rxo-export', expedite: 'rxo-expedite' };

/** Exact Compose identity, storage and release validation before any helper or lifecycle command. */
export class RxoRecoveryRuntime {
  constructor(private readonly config: ConfigService, private readonly native: RecoveryDockerRun = runRecoveryDocker) {}
  /** One request has an overall budget; cleanup retains a separate short allowance. */
  withDeadline(milliseconds: number): RxoRecoveryRuntime {
    const deadline = Date.now() + milliseconds;
    return new RxoRecoveryRuntime(this.config, (args, timeout = 15000) => {
      if (args[0] === 'rm') return this.native(args, Math.min(timeout, 3000));
      const remaining = deadline - Date.now();
      return remaining > 0 ? this.native(args, Math.min(timeout, remaining)) : Promise.resolve({ok:false,stdout:''});
    });
  }
  private project() { const value = this.config.get<string>('TRUCK_LOG_DOCKER_PROJECT', 'truck-log'); if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)) throw new Error('WORKER_UNAVAILABLE'); return value; }
  private release() { const value = this.config.get<string>('TRUCK_LOG_RELEASE', ''); if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value)) throw new Error('WORKER_UNAVAILABLE'); return value; }
  private volume(role: RecoveryRole) { return role === 'standard' ? this.config.get<string>('TRUCK_LOG_RXO_DOCKER_DATA_VOLUME','truck-log-rxo-data') : 'truck-log-rxo-expedite-data'; }
  private credentials() { return this.config.get<string>('TRUCK_LOG_RXO_DOCKER_CREDENTIAL_VOLUME','truck-log-rxo-credentials'); }
  private async json(args: string[]): Promise<any> {
    const result = await this.native(args);
    if (!result.ok) throw new Error('WORKER_UNAVAILABLE');
    try { return JSON.parse(result.stdout); } catch { throw new Error('WORKER_UNAVAILABLE'); }
  }
  async target(role: RecoveryRole): Promise<RecoveryTarget> {
    const project = this.project(), release = this.release(), service = services[role];
    const found = await this.native(['ps','-a','--no-trunc','--filter',`label=com.docker.compose.project=${project}`,'--filter',`label=com.docker.compose.service=${service}`,'--format','{{.ID}}']);
    const ids = found.stdout.trim().split(/\s+/).filter(Boolean);
    if (!found.ok || ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0])) throw new Error('WORKER_UNAVAILABLE');
    const v = await this.json(['inspect','--type','container','--format','{{json .}}',ids[0]]);
    const labels = v?.Config?.Labels;
    const image = `${images[role]}:${release}`, dataVolume = this.volume(role), credentialVolume = this.credentials();
    if (!labels || labels['com.docker.compose.project'] !== project || labels['com.docker.compose.service'] !== service ||
      !['False','false'].includes(labels['com.docker.compose.oneoff']) || labels['com.dana.truck-log.release'] !== release ||
      v.Id !== ids[0] || v.Config.Image !== image || v.State?.Paused || ['dead','removing'].includes(v.State?.Status)) throw new Error('WORKER_UNAVAILABLE');
    for (const name of [dataVolume,credentialVolume]) if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) throw new Error('WORKER_UNAVAILABLE');
    const mounts = v.Mounts;
    if (!Array.isArray(mounts) || !mounts.some(m => m.Type === 'volume' && m.Name === dataVolume && m.Destination === '/app/data' && m.RW === true) ||
      !mounts.some(m => m.Type === 'volume' && m.Name === credentialVolume && m.Destination === '/run/secrets' && m.RW === false)) throw new Error('WORKER_UNAVAILABLE');
    const imageInfo = await this.json(['image','inspect','--format','{{json .}}',image]);
    if (!/^sha256:[a-f0-9]{64}$/.test(imageInfo?.Id || '') || imageInfo?.Id !== v.Image || imageInfo?.Config?.Labels?.['com.dana.truck-log.release'] !== release ||
      imageInfo?.Config?.Labels?.['com.dana.truck-log.component'] !== components[role]) throw new Error('WORKER_UNAVAILABLE');
    for (const name of [dataVolume,credentialVolume]) {
      const volume = await this.json(['volume','inspect','--format','{{json .}}',name]);
      if (volume?.Name !== name) throw new Error('WORKER_UNAVAILABLE');
    }
    return {id: ids[0], role, image, imageId: imageInfo.Id, dataVolume, credentialVolume, running: v.State?.Running === true, restarting: v.State?.Restarting === true};
  }
  async observe(target: RecoveryTarget, operation: 'status' | 'request'): Promise<RecoveryObservation> {
    const name = `truck-log-rxo-recovery-${randomUUID()}`;
    const args = ['run','--rm','--pull=never','--name',name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
      '--pids-limit=32','--memory=128m','--cpus=0.5','--tmpfs','/tmp:rw,noexec,nosuid,size=8m',
      '--mount',`type=volume,source=${target.dataVolume},target=/app/data${operation === 'status' ? ',readonly' : ''}`,
      '--mount',`type=volume,source=${target.credentialVolume},target=/run/secrets,readonly`,
      '--entrypoint','node',target.imageId,'--input-type=module','-e',RECOVERY_HELPER,target.role,operation];
    try {
      const result = await this.native(args);
      if (!result.ok) throw new Error('RECOVERY_UNAVAILABLE');
      return recoveryObservation(JSON.parse(result.stdout),target.role);
    } finally { await this.native(['rm','-f',name],5000).catch(() => undefined); }
  }
  async lifecycle(target: RecoveryTarget, action: 'start' | 'restart'): Promise<void> {
    const result = await this.native(action === 'start' ? ['start',target.id] : ['restart','--time','10',target.id],25000);
    if (!result.ok) throw new Error('RECOVERY_UNAVAILABLE');
  }
}
