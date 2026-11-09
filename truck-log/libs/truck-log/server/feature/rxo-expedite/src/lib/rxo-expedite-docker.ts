import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { CredentialInput, ExpediteSettingsInput } from './rxo-expedite.types';

/*
 * Native Docker boundary of RXO Expedite: short-lived, network-less helper
 * containers own credentials, schedule settings and the verified shipment
 * export. Nothing here touches PostgreSQL or HTTP policy.
 */

export const IMAGE = `truck-log-rxo-expedite:${process.env.TRUCK_LOG_RELEASE || '1.0.1'}`;
export const DATA_VOLUME = 'truck-log-rxo-expedite-data';

export type DockerNativeRun = (
  args: string[],
  input?: string,
  timeoutMs?: number,
  maxStdoutBytes?: number,
) => Promise<{ ok: boolean; stdout: string }>;

/** Run docker without a shell. stdout is capped (default 64 KiB; shipment exports pass a larger cap). */
export function runDockerNative(args: string[], input?: string, timeoutMs = 30000, maxStdoutBytes = 65536): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    let text = '', bytes = 0, settled = false;
    const child = spawn(process.platform === 'win32' ? 'docker.exe' : 'docker', args,
      { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const finish = (ok: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok, stdout: ok ? text : '' }); } };
    const timer = setTimeout(() => { child.kill(); finish(false); }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; text += String(chunk); if (bytes > maxStdoutBytes) { child.kill(); finish(false); } });
    // Never concatenate/return child stderr: it may contain sensitive native error text.
    child.stderr.on('data', () => undefined);
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

/**
 * Builds and validates the Expedite helper-container runs. `native` is the
 * process runner (RxoExpediteService.native, which uses runDockerNative).
 * A plain class constructed by RxoExpediteService (not a Nest provider).
 */
export class RxoExpediteDockerHelpers {
  constructor(
    private readonly config: ConfigService,
    private readonly native: DockerNativeRun,
  ) {}

  volume() {
    // The current credential-volume setting is intentionally reused, not its values.
    const name = this.config.get<string>('TRUCK_LOG_RXO_DOCKER_CREDENTIAL_VOLUME', 'truck-log-rxo-credentials');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) throw new ServiceUnavailableException('Expedite credential storage requires configuration review.');
    return name;
  }

  async helper(write: boolean, body?: CredentialInput): Promise<Record<string, any>> {
    const name = `truck-log-expedite-control-${randomUUID()}`;
    const args = ['run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=256m',
      '-i', '-v', `${this.volume()}:/run/secrets${write ? '' : ':ro'}`,
      '-v', `${DATA_VOLUME}:/app/data:ro`, IMAGE, write ? '--set-credentials' : '--status'];
    try {
      const result = await this.native(args, write ? JSON.stringify(body) : undefined);
      if (!result.ok) throw new ServiceUnavailableException('Expedite control is unavailable. Verify the dedicated image and storage; standard RXO is unaffected.');
      let value: unknown;
      try { value = JSON.parse(result.stdout); } catch { throw new ServiceUnavailableException('Expedite returned an invalid control response.'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceUnavailableException('Expedite returned an invalid control response.');
      return value as Record<string, any>;
    } finally {
      // Only our uniquely named ephemeral helper; never standard RXO or the Print Agent.
      await this.native(['rm', '-f', name], undefined, 10000);
    }
  }

  async settingsHelper(write: boolean, body?: ExpediteSettingsInput): Promise<Record<string, any>> {
    const name = `truck-log-expedite-settings-${randomUUID()}`;
    const args = ['run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=256m',
      '-i', '-v', `${DATA_VOLUME}:/app/data${write ? '' : ':ro'}`, IMAGE, write ? '--set-settings' : '--settings'];
    try {
      const result = await this.native(args, write ? JSON.stringify(body) : undefined);
      if (!result.ok) throw new ServiceUnavailableException('Expedite schedule control is unavailable.');
      let value: any; try { value = JSON.parse(result.stdout); } catch { throw new ServiceUnavailableException('Expedite returned invalid schedule settings.'); }
      if (value?.source !== 'RXO_EXPEDITE' || !value.settings) throw new ServiceUnavailableException('Expedite returned invalid schedule settings.');
      return value.settings;
    } finally { await this.native(['rm', '-f', name], undefined, 10000); }
  }

  async nativeShipments() {
    const name = `truck-log-expedite-shipments-${randomUUID()}`;
    const args = ['run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=256m',
      '-v', `${DATA_VOLUME}:/app/data:ro`, IMAGE, '--latest-shipments'];
    try {
      // Up to 50,000 rows are allowed by the database contract; 64 MiB leaves ample room for that.
      const result = await this.native(args, undefined, 60000, 64 * 1024 * 1024);
      if (!result.ok) throw new ServiceUnavailableException('Verified Expedite shipments are unavailable. Standard RXO is unaffected.');
      let value: any; try { value = JSON.parse(result.stdout); } catch { throw new ServiceUnavailableException('Expedite returned an invalid shipment response.'); }
      const text = (v: unknown, max = 8192): string | null => v == null ? null : typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]/.test(v) ? v : (() => { throw new ServiceUnavailableException('Expedite shipment data requires review.'); })();
      if (!value || value.source !== 'RXO_EXPEDITE' || value.contractVersion !== 1 || !Array.isArray(value.shipments) || !Number.isSafeInteger(value.rowCount) || value.rowCount !== value.shipments.length || value.rowCount < 0 || value.rowCount > 50000) throw new ServiceUnavailableException('Expedite shipment data requires review.');
      const sourceBatchId = text(value.sourceBatchId, 128); if (!sourceBatchId || !/^[0-9TZ-]+[a-f0-9-]{36}$/.test(sourceBatchId)) throw new ServiceUnavailableException('Expedite shipment batch requires review.');
      const completedAt = text(value.completedAt, 64); if (!completedAt || !Number.isFinite(Date.parse(completedAt))) throw new ServiceUnavailableException('Expedite shipment timestamp requires review.');
      const shipments = value.shipments.map((r: any) => {
        const shipmentId = text(r?.shipmentId, 128); if (!shipmentId || !(r?.critical === null || typeof r?.critical === 'boolean')) throw new ServiceUnavailableException('Expedite shipment record requires review.');
        const eta = r?.etaNextStop; if (!(eta == null || typeof eta === 'string' || (typeof eta === 'number' && Number.isFinite(eta)))) throw new ServiceUnavailableException('Expedite ETA value requires review.');
        return { shipmentId, critical: r.critical, authCode: text(r.authCode), originName: text(r.originName), origin: text(r.origin), destination: text(r.destination), scac: text(r.scac), commodity: text(r.commodity), mode: text(r.mode), currentLocation: text(r.currentLocation), nextStop: text(r.nextStop), etaNextStop: typeof eta === 'string' ? text(eta) : eta ?? null, etaStatus: text(r.etaStatus) };
      });
      return { contractVersion: 1 as const, source: 'RXO_EXPEDITE' as const, sourceBatchId, completedAt: new Date(completedAt).toISOString(), rowCount: shipments.length, shipments };
    } finally { await this.native(['rm', '-f', name], undefined, 10000); }
  }
}
