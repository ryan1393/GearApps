import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RxoIngestionService } from './rxo-ingestion.service';
import { RxoControlRuntime, type ExporterSettings, type ManualRun } from './rxo-control-runtime';
import { RXO_BOUNDARY_FILE } from './rxo-ingestion-paths';

@Injectable()
export class RxoControlService implements OnModuleInit, OnModuleDestroy {
  private autoTimer?: NodeJS.Timeout;
  private autoCheckBusy = false;
  private manualRun: ManualRun = {
    id: '', status: 'IDLE', phase: 'Ready', requestedAt: null, startedAt: null, completedAt: null, error: null,
  };

  private readonly runtime: RxoControlRuntime;

  constructor(
    private readonly config: ConfigService,
    private readonly ingestion: RxoIngestionService,
  ) {
    this.runtime = new RxoControlRuntime(this.config);
  }

  onModuleInit() {
    const enabled = !/^(0|false|no)$/i.test(String(this.config.get('TRUCK_LOG_RXO_AUTO_SYNC', 'true')));
    if (!enabled) return;
    setTimeout(() => void this.autoSyncCheck(), 12000);
    this.autoTimer = setInterval(() => void this.autoSyncCheck(), 30000);
  }

  onModuleDestroy() {
    if (this.autoTimer) clearInterval(this.autoTimer);
  }

  private async autoSyncCheck() {
    if (this.autoCheckBusy || !['IDLE', 'COMPLETE', 'PARTIAL', 'FAILED'].includes(this.manualRun.status)) return;
    this.autoCheckBusy = true;
    try {
      const containerId = await this.runtime.findExporterContainer();
      if (!containerId) return;
      const health = await this.runtime.readExporterHealth(containerId);
      if (health?.status !== 'ok' || !health?.lastBatchId) return;

      const ingestionStatus = await this.ingestion.status();
      const importedBatch = String((ingestionStatus.lastImport as Record<string, unknown> | null)?.['source_batch_id'] ?? '');
      const remoteBatch = String(health.lastBatchId);
      if (!remoteBatch || remoteBatch === importedBatch) return;

      const requestedAt = new Date().toISOString();
      const id = `auto-${remoteBatch}-${crypto.randomBytes(2).toString('hex')}`;
      this.manualRun = {
        id, status: 'SYNCING', phase: 'Automatic RXO sync/import', requestedAt, startedAt: requestedAt,
        completedAt: null, error: null, sourceBatchId: remoteBatch,
      };
      try {
        await this.executeSyncImport(id);
      } catch (error) {
        if (this.manualRun.id === id) {
          this.manualRun = {
            ...this.manualRun, status: 'FAILED', phase: 'Automatic sync/import failed', completedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    } catch {
      // Auto-sync is best-effort. Truck Log guard/dock operation must never
      // depend on remote Docker/RXO availability.
    } finally {
      this.autoCheckBusy = false;
    }
  }

  // Status runs several Docker commands. Concurrent callers share one run, and a
  // result is reused for a few seconds, so polling screens cannot flood the host.
  private statusInFlight: Promise<Awaited<ReturnType<RxoControlService['computeStatus']>>> | null = null;
  private statusCache: { at: number; value: Awaited<ReturnType<RxoControlService['computeStatus']>> } | null = null;
  private static readonly STATUS_CACHE_MS = 4000;

  async status() {
    const cached = this.statusCache;
    if (cached && Date.now() - cached.at < RxoControlService.STATUS_CACHE_MS) return cached.value;
    if (!this.statusInFlight) {
      this.statusInFlight = this.computeStatus()
        .then((value) => { this.statusCache = { at: Date.now(), value }; return value; })
        .finally(() => { this.statusInFlight = null; });
    }
    return this.statusInFlight;
  }

  private invalidateStatus() { this.statusCache = null; }

  private async computeStatus() {
    const generatedAt = new Date();
    let dockerVersion: string | null = null;
    let dockerConnected = false;

    try {
      dockerVersion = await this.runtime.requireDocker();
      dockerConnected = true;
    } catch {
      return {
        serverTime: generatedAt.toISOString(),
        serverEpochMs: generatedAt.getTime(),
        statusGeneratedAt: generatedAt.toISOString(),
        controlAvailable: false,
        dockerConnected: false,
        dockerVersion: null,
        exporterRunning: false,
        exporterContainerId: null,
        exporterHealth: null,
        scheduler: null,
        settings: this.runtime.defaultSettings(),
        exportWindow: this.runtime.exportWindow(),
        credentials: {
          username: '',
          usernameConfigured: false,
          passwordConfigured: false,
        },
        runtime: {
          checked: false,
          verified: false,
          expectedSha256: this.runtime.readExpectedMainHash(),
          actualSha256: null,
        },
        manualRun: this.manualRun,
        message:
          'Remote Docker is unavailable from the Truck Log API host.',
      };
    }

    const containerId = await this.runtime.findExporterContainer();
    const [exporterHealth, scheduler, settings] = await Promise.all([
      this.runtime.readExporterHealth(containerId),
      this.runtime.readSchedulerStatus(containerId),
      this.runtime.readSettings(),
    ]);
    const usernameConfigured = await this.runtime.volumeFileHasContent(
      this.runtime.credentialVolume(),
      'rxo_username',
    );
    const passwordConfigured = await this.runtime.volumeFileHasContent(
      this.runtime.credentialVolume(),
      'rxo_password',
    );
    const username = usernameConfigured
      ? String(
          (await this.runtime.readVolumeFile(
            this.runtime.credentialVolume(),
            'rxo_username',
          )) ?? '',
        ).trim()
      : '';
    const runtime = await this.runtime.runtimeVerification(containerId);
    const completedAt = new Date();

    return {
      serverTime: completedAt.toISOString(),
      serverEpochMs: completedAt.getTime(),
      statusGeneratedAt: completedAt.toISOString(),
      controlAvailable: true,
      dockerConnected,
      dockerVersion,
      exporterRunning: Boolean(containerId),
      exporterContainerId: containerId,
      exporterHealth,
      scheduler,
      settings,
      exportWindow: this.runtime.exportWindow(),
      credentials: {
        username,
        usernameConfigured,
        passwordConfigured,
      },
      runtime,
      manualRun: this.manualRun,
      message: containerId
        ? null
        : 'RXO exporter container is not currently running.',
    };
  }

  async updateSettings(payload: Partial<ExporterSettings>) {
    this.invalidateStatus();
    await this.runtime.requireDocker();
    const current = await this.runtime.readSettings();
    const maxScanDurationMinutes = this.runtime.boundedInt(
      payload.maxScanDurationMinutes,
      current.maxScanDurationMinutes,
      5,
      240,
    );
    const next: ExporterSettings = {
      syncIntervalMinutes: this.runtime.boundedInt(payload.syncIntervalMinutes, current.syncIntervalMinutes, 1, 1440),
      maxScanDurationMinutes,
      noProgressTimeoutMinutes: Math.min(
        this.runtime.boundedInt(
          payload.noProgressTimeoutMinutes,
          current.noProgressTimeoutMinutes,
          2,
          120,
        ),
        maxScanDurationMinutes,
      ),
    };
    await this.runtime.writeVolumeFile(this.runtime.dataVolume(), 'control-settings.json', `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }

  async updateCredentials(payload: { username?: string; password?: string }) {
    this.invalidateStatus();
    await this.runtime.requireDocker();
    const username = String(payload.username ?? '').trim();
    const password = String(payload.password ?? '');
    if (!username) throw new BadRequestException('RXO username is required.');
    await this.runtime.writeCredentialFile('rxo_username', username);
    if (password) await this.runtime.writeCredentialFile('rxo_password', password);
    const usernameConfigured = await this.runtime.volumeFileHasContent(this.runtime.credentialVolume(), 'rxo_username');
    const passwordConfigured = await this.runtime.volumeFileHasContent(this.runtime.credentialVolume(), 'rxo_password');
    if (!usernameConfigured || !passwordConfigured) {
      throw new ServiceUnavailableException('RXO credentials were not both verified after the update.');
    }
    return { username, usernameConfigured: true, passwordConfigured: true, passwordUpdated: Boolean(password) };
  }

  async requestRescan() {
    this.invalidateStatus();
    if (!['IDLE', 'COMPLETE', 'PARTIAL', 'FAILED'].includes(this.manualRun.status)) {
      throw new BadRequestException('An RXO manual scan/import is already running.');
    }
    await this.runtime.requireDocker();
    const containerId = await this.runtime.findExporterContainer();
    if (!containerId) throw new ServiceUnavailableException('RXO exporter is not running.');

    const requestedAt = new Date().toISOString();
    const id = `manual-${requestedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
    this.manualRun = { id, status: 'QUEUED', phase: 'Queueing RXO scan', requestedAt, startedAt: requestedAt, completedAt: null, error: null };

    void this.executeManualRun(id).catch((error) => {
      if (this.manualRun.id !== id) return;
      this.manualRun = {
        ...this.manualRun,
        status: 'FAILED', phase: 'Failed', completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    });

    return this.manualRun;
  }

  async syncLatestNow() {
    this.invalidateStatus();
    if (!['IDLE', 'COMPLETE', 'PARTIAL', 'FAILED'].includes(this.manualRun.status)) {
      throw new BadRequestException('An RXO manual scan/import is already running.');
    }
    const requestedAt = new Date().toISOString();
    const id = `sync-${requestedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
    this.manualRun = { id, status: 'SYNCING', phase: 'Copying verified RXO latest snapshot', requestedAt, startedAt: requestedAt, completedAt: null, error: null };
    void this.executeSyncImport(id).catch((error) => {
      if (this.manualRun.id !== id) return;
      this.manualRun = { ...this.manualRun, status: 'FAILED', phase: 'Failed', completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
    });
    return this.manualRun;
  }

  private async executeManualRun(id: string) {
    const containerId = await this.runtime.findExporterContainer();
    if (!containerId) throw new Error('RXO exporter stopped before the manual scan could be queued.');
    const before = await this.runtime.readExporterHealth(containerId);
    const previousSuccess = String(before?.lastSuccessAt ?? '');
    const requestedAt = new Date().toISOString();
    await this.runtime.writeVolumeFile(this.runtime.dataVolume(), 'rescan-request.json', `${JSON.stringify({ requestId: id, requestedAt }, null, 2)}\n`);
    this.manualRun = { ...this.manualRun, status: 'EXPORTING', phase: 'RXO scan running' };

    const settings = await this.runtime.readSettings();
    const timeoutMinutes = Math.min(
      settings.maxScanDurationMinutes * 2 + 5,
      485,
    );
    const started = Date.now();
    while (Date.now() - started < timeoutMinutes * 60 * 1000) {
      await this.runtime.sleep(3000);
      if (this.manualRun.id !== id) return;
      const currentContainer = await this.runtime.findExporterContainer();
      if (!currentContainer) continue;
      const health = await this.runtime.readExporterHealth(currentContainer);
      if (health?.status === 'error' && health?.lastError) throw new Error(`RXO scan failed: ${health.lastError}`);
      const lastSuccess = String(health?.lastSuccessAt ?? '');
      if (health?.status === 'ok' && lastSuccess && lastSuccess !== previousSuccess) {
        this.manualRun = { ...this.manualRun, sourceBatchId: health?.lastBatchId ?? null, phase: 'RXO export complete; syncing to Truck Log' };
        await this.executeSyncImport(id);
        return;
      }
    }
    throw new Error(`RXO manual scan did not finish within ${timeoutMinutes} minutes, including the automatic recovery allowance.`);
  }

  private async executeSyncImport(id: string) {
    this.manualRun = { ...this.manualRun, status: 'SYNCING', phase: 'Copying verified RXO latest snapshot' };
    const result = await this.copyLatestSnapshot();
    if (this.manualRun.id !== id) return;
    this.manualRun = { ...this.manualRun, status: 'IMPORTING', phase: 'Importing RXO data into PostgreSQL', sourceBatchId: result.batchId ?? this.manualRun.sourceBatchId };
    const importSummary = await this.ingestion.importLatest();
    if (this.manualRun.id !== id) return;
    this.manualRun = {
      ...this.manualRun,
      status: importSummary.importHealth.complete ? 'COMPLETE' : 'PARTIAL',
      phase: importSummary.importHealth.complete ? 'RXO import complete' : 'RXO import needs review; one or more datasets are incomplete or unverified',
      completedAt: new Date().toISOString(), error: null,
      sourceBatchId: result.batchId ?? this.manualRun.sourceBatchId,
      importSummary,
    };
  }

  private async copyLatestSnapshot() {
    await this.runtime.requireDocker();
    const root = this.runtime.rxoRoot();
    const final = this.runtime.latestRoot();
    const previous = path.join(root, 'previous');
    const staging = path.join(root, `.incoming-${crypto.randomUUID()}`);
    const tempName = `truck-log-rxo-api-sync-${crypto.randomUUID().replace(/-/g, '')}`;
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(staging, { recursive: true });

    try {
      const created = await this.runtime.docker(['create', '--name', tempName, '-v', `${this.runtime.dataVolume()}:/data:ro`, 'alpine:3.20', 'sleep', '300'], undefined, 30000, 4);
      if (created.exitCode !== 0) throw new Error(`Could not create temporary RXO copy container: ${this.runtime.cleanError(created)}`);
      const copied = await this.runtime.docker(['cp', `${tempName}:/data/latest/.`, staging], undefined, 120000, 4);
      if (copied.exitCode !== 0) throw new Error(`Could not copy RXO latest snapshot: ${this.runtime.cleanError(copied)}`);
    } finally {
      await this.runtime.docker(['rm', '-f', tempName], undefined, 20000, 1).catch(() => undefined);
    }

    const verifier = path.join(this.runtime.workspaceRoot(), 'tools', 'truck-log', 'rxo', 'verify-local-rxo-latest.mjs');
    const verified = await this.runtime.runNative(this.runtime.nodeBinary(), [verifier, staging], undefined, 120000);
    if (verified.exitCode !== 0) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw new Error(`Copied RXO snapshot failed verification: ${this.runtime.cleanError(verified)}`);
    }

    let batchId: string | null = null;
    try {
      const boundary = JSON.parse(fs.readFileSync(path.join(staging, RXO_BOUNDARY_FILE), 'utf8'));
      batchId = boundary?.sourceBatchId ?? null;
    } catch {}

    if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
    if (fs.existsSync(final)) fs.renameSync(final, previous);
    fs.renameSync(staging, final);
    return { batchId };
  }
}
