import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type NativeResult = { exitCode: number; stdout: string; stderr: string };
export type ManualRun = {
  id: string;
  status: 'IDLE' | 'QUEUED' | 'EXPORTING' | 'SYNCING' | 'IMPORTING' | 'COMPLETE' | 'PARTIAL' | 'FAILED';
  phase: string;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  sourceBatchId?: string | null;
  importSummary?: unknown;
};

export type ExporterSettings = {
  syncIntervalMinutes: number;
  maxScanDurationMinutes: number;
  noProgressTimeoutMinutes: number;
};

/**
 * Docker and volume runtime used by the RXO Control Center: shell-less process
 * runs with retries, exporter container lookup, data/credential volume file
 * access, persisted exporter settings, health/scheduler status and the running
 * exporter's source-hash verification.
 * A plain class constructed by RxoControlService (not a Nest provider).
 */
export class RxoControlRuntime {
  constructor(private readonly config: ConfigService) {}

  dockerBinary() { return process.platform === 'win32' ? 'docker.exe' : 'docker'; }
  nodeBinary() { return process.platform === 'win32' ? 'node.exe' : 'node'; }
  workspaceRoot() { return path.resolve(process.cwd()); }
  latestRoot() { return path.resolve(this.config.get<string>('TRUCK_LOG_RXO_LATEST_DIR', 'data/rxo/latest')); }
  rxoRoot() { return path.dirname(this.latestRoot()); }
  dataVolume() { return this.config.get<string>('TRUCK_LOG_RXO_DOCKER_DATA_VOLUME', 'truck-log-rxo-data'); }
  credentialVolume() { return this.config.get<string>('TRUCK_LOG_RXO_DOCKER_CREDENTIAL_VOLUME', 'truck-log-rxo-credentials'); }

  async runNative(filePath: string, args: string[], input?: string, timeoutMs = 30000): Promise<NativeResult> {
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      const child = spawn(filePath, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => {
        if (settled) return;
        child.kill();
      }, timeoutMs);
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.message}` });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr });
      });
      if (input !== undefined) child.stdin.end(input);
      else child.stdin.end();
    });
  }

  async docker(args: string[], input?: string, timeoutMs = 30000, attempts = 3) {
    let last: NativeResult = { exitCode: 1, stdout: '', stderr: 'Docker command was not attempted.' };
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      last = await this.runNative(this.dockerBinary(), args, input, timeoutMs);
      if (last.exitCode === 0) return last;
      if (attempt < attempts) await this.sleep(attempt * 1500);
    }
    return last;
  }

  async requireDocker() {
    const result = await this.docker(['version', '--format', '{{.Server.Version}}'], undefined, 20000, 3);
    if (result.exitCode !== 0) {
      throw new ServiceUnavailableException(`Remote Docker is unavailable: ${this.cleanError(result)}`);
    }
    return result.stdout.trim();
  }

  cleanError(result: NativeResult) {
    return (result.stderr || result.stdout || `exit ${result.exitCode}`).trim().slice(0, 1000);
  }

  sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  boundedInt(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
  }

  async findExporterContainer() {
    const result = await this.docker([
      'ps',
      '--filter', `label=com.docker.compose.project=${this.config.get<string>('TRUCK_LOG_DOCKER_PROJECT', 'truck-log')}`,
      '--filter', 'label=com.docker.compose.service=rxo-export',
      '--filter', 'label=com.docker.compose.oneoff=False',
      '--format', '{{.ID}}',
    ], undefined, 20000, 3);
    if (result.exitCode !== 0) return null;
    return result.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean) ?? null;
  }

  async readVolumeFile(volume: string, file: string) {
    const result = await this.docker([
      'run', '--rm', '-v', `${volume}:/volume:ro`, 'alpine:3.20', 'cat', `/volume/${file}`,
    ], undefined, 30000, 2);
    return result.exitCode === 0 ? result.stdout : null;
  }

  async volumeFileHasContent(volume: string, file: string) {
    const result = await this.docker([
      'run', '--rm', '-v', `${volume}:/volume:ro`, 'alpine:3.20', 'test', '-s', `/volume/${file}`,
    ], undefined, 30000, 2);
    return result.exitCode === 0;
  }

  async writeVolumeFile(volume: string, file: string, content: string) {
    const fixedScript = `cat > /volume/${file}.tmp && mv /volume/${file}.tmp /volume/${file}`;
    const result = await this.docker([
      'run', '--rm', '-i', '-v', `${volume}:/volume`, 'alpine:3.20', 'sh', '-c', fixedScript,
    ], content, 30000, 3);
    if (result.exitCode !== 0) throw new ServiceUnavailableException(`Could not write RXO control file: ${this.cleanError(result)}`);
  }

  async writeCredentialFile(file: string, content: string) {
    const fixedScript = `tr -d '\\r\\n' > /volume/${file}.tmp && chmod 600 /volume/${file}.tmp && mv /volume/${file}.tmp /volume/${file}`;
    const result = await this.docker([
      'run', '--rm', '-i', '-v', `${this.credentialVolume()}:/volume`, 'alpine:3.20', 'sh', '-c', fixedScript,
    ], `${content}\n`, 30000, 3);
    if (result.exitCode !== 0) throw new ServiceUnavailableException(`Could not update RXO credentials: ${this.cleanError(result)}`);
  }

  parseJson(value: string | null) {
    if (!value) return null;
    try { return JSON.parse(value.replace(/^\uFEFF/, '')); } catch { return null; }
  }

  defaultSettings(): ExporterSettings {
    return {
      syncIntervalMinutes: 30,
      maxScanDurationMinutes: 30,
      noProgressTimeoutMinutes: 15,
    };
  }

  /** The verified acquisition plan is fixed; these are status, not editable settings. */
  exportWindow() {
    return { lookbackDays: 1, lookaheadDays: 1, timeZone: 'America/Indiana/Indianapolis' } as const;
  }

  async readSettings(): Promise<ExporterSettings> {
    const stored = this.parseJson(await this.readVolumeFile(this.dataVolume(), 'control-settings.json')) ?? {};
    // Old releases saved lookback/ahead values without applying them. Ignore those
    // legacy keys; the next save replaces the file with supported settings only.
    const maxScanDurationMinutes = this.boundedInt(
      stored.maxScanDurationMinutes,
      30,
      5,
      240,
    );
    return {
      syncIntervalMinutes: this.boundedInt(stored.syncIntervalMinutes, 30, 1, 1440),
      maxScanDurationMinutes,
      noProgressTimeoutMinutes: Math.min(
        this.boundedInt(stored.noProgressTimeoutMinutes, 15, 2, 120),
        maxScanDurationMinutes,
      ),
    };
  }

  async readExporterHealth(containerId: string | null) {
    let raw: string | null = null;
    if (containerId) {
      const result = await this.docker(['exec', containerId, 'cat', '/app/data/health.json'], undefined, 20000, 2);
      if (result.exitCode === 0) raw = result.stdout;
    }
    if (!raw) raw = await this.readVolumeFile(this.dataVolume(), 'health.json');
    return this.parseJson(raw);
  }

  async readSchedulerStatus(containerId: string | null) {
    let raw: string | null = null;
    if (containerId) {
      const result = await this.docker(
        ['exec', containerId, 'cat', '/app/data/scheduler-status.json'],
        undefined,
        20000,
        2,
      );
      if (result.exitCode === 0) raw = result.stdout;
    }
    if (!raw) {
      raw = await this.readVolumeFile(
        this.dataVolume(),
        'scheduler-status.json',
      );
    }
    return this.parseJson(raw);
  }

  /**
   * Digest of the exporter's whole /app/src as the release built it (written to
   * RUNTIME-MANIFEST.json by tools/truck-log/refresh-manifests.mjs). Covers every
   * exporter module, not only the entry file. Name kept for existing callers.
   */
  readExpectedMainHash() {
    try {
      const manifestPath = path.join(this.workspaceRoot(), 'apps', 'rxo-integration', 'RUNTIME-MANIFEST.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { imageSourceDigest?: string };
      return /^[0-9a-f]{64}$/.test(manifest.imageSourceDigest ?? '') ? manifest.imageSourceDigest! : null;
    } catch { return null; }
  }

  async runtimeVerification(containerId: string | null) {
    if (!containerId) return { checked: false, verified: false, expectedSha256: this.readExpectedMainHash(), actualSha256: null };
    const result = await this.docker(['exec', containerId, 'sh', '-c',
      'cd /app && find src -type f | LC_ALL=C sort | xargs sha256sum | sha256sum'], undefined, 20000, 2);
    const actual = result.exitCode === 0 ? result.stdout.trim().split(/\s+/)[0]?.toLowerCase() ?? null : null;
    const expected = this.readExpectedMainHash()?.toLowerCase() ?? null;
    // Compare the running exporter's source tree with this release's manifest.
    return { checked: Boolean(actual), verified: Boolean(actual && expected && actual === expected), expectedSha256: expected, actualSha256: actual };
  }
}
