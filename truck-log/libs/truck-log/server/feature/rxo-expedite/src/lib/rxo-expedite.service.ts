import { RxoConnectionRecoveryService, type RecoverOptions } from '@truck-log/server/infrastructure/rxo-recovery';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  EXPEDITE_CHECK_IN_SITE,
  latestExpediteBatchSql,
} from '@truck-log/server/domain/rxo';
import type { CredentialInput, ExpediteSettingsInput } from './rxo-expedite.types';
import { RxoExpediteDockerHelpers, runDockerNative } from './rxo-expedite-docker';
import { RxoExpediteDatabaseMirror } from './rxo-expedite-mirror';
import { expediteDirection } from './rxo-expedite-identity';
import { publicAcquisitionDiagnostic } from './rxo-expedite-status-diagnostics';
import { publicManualScan } from './rxo-expedite-manual-scan';
import type { RxoExpediteManualRunState } from '@truck-log/shared/contracts';

const SAFE_STATE = new Set(['NOT_RUN', 'RUNNING', 'SUCCESS', 'REVIEW', 'FAILED']);

/**
 * Coordinates the independent RXO Expedite runtime and its PostgreSQL mirror.
 *
 * Design boundary:
 * - native Docker helpers own credentials, schedule state, and verified acquisition
 *   (rxo-expedite-docker.ts);
 * - this service validates/normalizes that boundary before exposing it to Truck Log
 *   (HTTP-facing policy, status/shipment shaping, write authorization);
 * - PostgreSQL is a mirror for querying and check-in, never the source of RXO login
 *   state (rxo-expedite-mirror.ts).
 *
 * Keep standard RXO and Expedite lifecycles independent. A failure here must not
 * disable the standard RXO integration or manual Truck Log check-in.
 */
@Injectable()
export class RxoExpediteService implements OnModuleInit, OnModuleDestroy {
  private ingestionTimer: ReturnType<typeof setInterval> | null = null;
  private ingestionStartupTimer: ReturnType<typeof setTimeout> | null = null;
  private ingestionRunning = false;
  private readonly docker: RxoExpediteDockerHelpers;
  private readonly mirror: RxoExpediteDatabaseMirror;
  private manualScanRequest: Promise<RxoExpediteManualRunState> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly connectionRecovery: RxoConnectionRecoveryService = new RxoConnectionRecoveryService(config),
  ) {
    // The runner closure resolves this.native at call time so it stays one seam.
    this.docker = new RxoExpediteDockerHelpers(
      this.config,
      (args, input, timeoutMs, maxStdoutBytes) => this.native(args, input, timeoutMs, maxStdoutBytes),
    );
    this.mirror = new RxoExpediteDatabaseMirror(this.dataSource, this.config);
  }

  onModuleInit() {
    this.ingestionStartupTimer = setTimeout(() => {
      void this.syncLatestVerifiedToDatabase().catch(() => undefined);
    }, 7500);
    this.ingestionTimer = setInterval(() => {
      void this.syncLatestVerifiedToDatabase().catch(() => undefined);
    }, 30000);
  }

  onModuleDestroy() {
    if (this.ingestionStartupTimer) clearTimeout(this.ingestionStartupTimer);
    if (this.ingestionTimer) clearInterval(this.ingestionTimer);
    this.ingestionStartupTimer = null;
    this.ingestionTimer = null;
  }

  private databaseSchemaReady(): Promise<boolean> {
    return this.mirror.databaseSchemaReady();
  }

  private batchAlreadyImported(sourceBatchId: string): Promise<boolean> {
    return this.mirror.batchAlreadyImported(sourceBatchId);
  }

  private async syncLatestVerifiedToDatabase(expectedBatchId?: string | null) {
    if (this.ingestionRunning || !await this.databaseSchemaReady()) return;
    if (expectedBatchId && await this.batchAlreadyImported(expectedBatchId)) return;
    this.ingestionRunning = true;
    try {
      const snapshot = await this.nativeShipments();
      if (await this.batchAlreadyImported(snapshot.sourceBatchId)) return;
      await this.mirror.importSnapshot(snapshot);
    } finally {
      this.ingestionRunning = false;
    }
  }

  controlPolicy() {
    // Saving still needs a signed-in administrator (TruckLogAdminWrites). With no dedicated
    // control origin configured, Expedite follows the administrator sign-in origin and its
    // transport decision, so a working admin sign-in can also save the Expedite login.
    const dedicated = this.config.get<string>('TRUCK_LOG_RXO_EXPEDITE_CONTROL_ORIGIN', '');
    const raw = dedicated || this.config.get<string>('TRUCK_LOG_ADMIN_ORIGIN', '');
    const allowHttp = this.config.get<string>('TRUCK_LOG_RXO_EXPEDITE_ALLOW_HTTP', 'false') === 'true'
      || (!dedicated && this.config.get<string>('TRUCK_LOG_ADMIN_TRANSPORT', 'https') === 'internal-http');
    try {
      const u = new URL(raw);
      const valid = raw === u.origin && !u.username && !u.password && (u.protocol === 'https:' || (u.protocol === 'http:' && allowHttp));
      return { credentialUpdatesEnabled: valid, controlOrigin: valid ? u.origin : null, transportWarning: valid && u.protocol === 'http:' };
    } catch { return { credentialUpdatesEnabled: false, controlOrigin: null, transportWarning: false }; }
  }

  /** Status/shipment reads start a container each time: share one run between concurrent callers and reuse it briefly. */
  private readonly flights = new Map<string, { at: number; value?: unknown; promise?: Promise<unknown> }>();
  private shared<T>(key: string, ttlMs: number, run: () => Promise<T>): Promise<T> {
    const entry = this.flights.get(key);
    if (entry?.promise) return entry.promise as Promise<T>;
    if (entry && 'value' in entry && Date.now() - entry.at < ttlMs) return Promise.resolve(entry.value as T);
    const promise = run()
      .then((value) => { this.flights.set(key, { at: Date.now(), value }); return value; })
      .catch((error) => { this.flights.delete(key); throw error; });
    this.flights.set(key, { at: Date.now(), promise });
    return promise;
  }
  private invalidateShared() { this.flights.clear(); }
  /** Run docker without a shell. stdout is capped (default 64 KiB; shipment exports pass a larger cap). */
  private native(args: string[], input?: string, timeoutMs = 30000, maxStdoutBytes = 65536): Promise<{ ok: boolean; stdout: string }> {
    return runDockerNative(args, input, timeoutMs, maxStdoutBytes);
  }

  private helper(write: boolean, body?: CredentialInput): Promise<Record<string, any>> {
    return this.docker.helper(write, body);
  }

  private settingsHelper(write: boolean, body?: ExpediteSettingsInput): Promise<Record<string, any>> {
    return this.docker.settingsHelper(write, body);
  }

  private nativeShipments() {
    return this.docker.nativeShipments();
  }

  private publicCredentials(value: unknown) {
    const c = value as Record<string, unknown> | null;
    if (!c || typeof c.username !== 'string' || c.username.length > 256 || /[\x00-\x1f\x7f]/.test(c.username)
      || typeof c.usernameConfigured !== 'boolean' || typeof c.passwordConfigured !== 'boolean'
      || typeof c.configured !== 'boolean' || c.configured !== (c.usernameConfigured && c.passwordConfigured)) {
      throw new ServiceUnavailableException('Expedite credential status requires review.');
    }
    // Positive allowlist. A helper returning extra secrets/hashes cannot expose them.
    return { username: c.username, usernameConfigured: c.usernameConfigured, passwordConfigured: c.passwordConfigured, configured: c.configured };
  }

  status() {
    return this.shared('status', 4000, () => this.computeStatus());
  }

  private async computeStatus() {
    const [raw, recovery] = await Promise.all([this.helper(false), this.connectionRecovery.status('expedite')]);
    const a = raw.acquisition, s = raw.scheduler;
    if (raw.source !== 'RXO_EXPEDITE' || !a || !SAFE_STATE.has(a.state)) throw new ServiceUnavailableException('Expedite acquisition status requires review.');
    const date = (v: unknown): string | null => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
    const last = a.lastSuccess;
    const schedulerState = typeof s?.schedulerState === 'string' && /^(NOT_STARTED|STARTING|WAITING|EXPORTING|STOPPING|STOPPED)$/.test(s.schedulerState) ? s.schedulerState : 'NOT_STARTED';
    const schedulerIntervalMinutes = Number.isSafeInteger(s?.intervalMinutes) && s.intervalMinutes >= 1 && s.intervalMinutes <= 1440 ? s.intervalMinutes as number : 30;
    const settings = raw.settings;
    const intervalMinutes = Number.isSafeInteger(settings?.intervalMinutes) && settings.intervalMinutes >= 1 && settings.intervalMinutes <= 1440 ? settings.intervalMinutes as number : 30;
    const syncOnStart = settings?.syncOnStart !== false;
    const verifiedBatchId = last?.verified === true && typeof last.sourceBatchId === 'string' && /^[0-9TZ-]+[a-f0-9-]{36}$/.test(last.sourceBatchId)
      ? last.sourceBatchId as string : null;
    if (verifiedBatchId && await this.databaseSchemaReady() && !await this.batchAlreadyImported(verifiedBatchId)) {
      try { await this.syncLatestVerifiedToDatabase(verifiedBatchId); } catch { /* database status reports the failure */ }
    }
    const database = await this.mirror.databaseStatus(verifiedBatchId);
    return { source: 'RXO_EXPEDITE', recovery, version: process.env.TRUCK_LOG_RELEASE || '1.0.5', schedulingEnabled: raw.schedulingEnabled === true, databaseIngestionEnabled: database.enabled,
      database, manualRun: publicManualScan(raw.manualRun),
      ...this.controlPolicy(), credentials: this.publicCredentials(raw.credentials), settings: { intervalMinutes, syncOnStart },
      scheduler: { state: schedulerState, intervalMinutes: schedulerIntervalMinutes, syncOnStart: s?.syncOnStart !== false, schedulerStartedAt: date(s?.schedulerStartedAt), schedulerHeartbeatAt: date(s?.schedulerHeartbeatAt), currentStartedAt: date(s?.currentStartedAt), nextRunAt: date(s?.nextRunAt), lastCompletedAt: date(s?.lastCompletedAt), lastSuccessAt: date(s?.lastSuccessAt), lastFailureAt: date(s?.lastFailureAt), lastErrorCode: typeof s?.lastErrorCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(s.lastErrorCode) ? s.lastErrorCode : null, lastDurationSeconds: Number.isFinite(s?.lastDurationSeconds) && s.lastDurationSeconds >= 0 ? s.lastDurationSeconds as number : null, lastSourceBatchId: typeof s?.lastSourceBatchId === 'string' && /^[0-9TZ-]+[a-f0-9-]{36}$/.test(s.lastSourceBatchId) ? s.lastSourceBatchId as string : null },
      acquisition: { state: a.state as string, diagnostic: publicAcquisitionDiagnostic(a.diagnostic), completedAt: date(a.completedAt), lastError: typeof a.lastError === 'string' && /^[A-Z0-9_]{1,80}$/.test(a.lastError) ? a.lastError : null,
        lastAttemptAt: date(a.lastAttemptAt), lastSuccessfulExport: last?.verified === true ? date(last.completedAt) : null,
        shipmentCount: last?.verified === true && Number.isSafeInteger(last.rowCount) && last.rowCount >= 0 ? last.rowCount as number : null,
        sourceBatchId: verifiedBatchId } };
  }

  async checkInLoads() {
    if (!await this.databaseSchemaReady()) {
      throw new ServiceUnavailableException('Expedite check-in is waiting for its PostgreSQL import. Standard RXO and manual check-in remain available.');
    }
    const [batch] = await this.dataSource.query(latestExpediteBatchSql) as Array<{ source_batch_id: string }>;
    if (!batch) return { rows: [], unselectableCount: 0, sourceBatchId: null };
    const stored = await this.mirror.databaseShipments(batch.source_batch_id);
    if (!stored) throw new ServiceUnavailableException('The latest Expedite import is incomplete. Refresh after the next successful import.');
    const available = await this.mirror.availableShipmentResponse(stored);
    const selectable = available.shipments.filter((row) =>
      ['INBOUND', 'OUTBOUND'].includes(expediteDirection(row))
      && String(row.shipmentId).trim().length <= 120,
    );
    return {
      sourceBatchId: batch.source_batch_id,
      unselectableCount: available.shipments.length - selectable.length,
      rows: selectable.map((row) => ({
        site_key: EXPEDITE_CHECK_IN_SITE,
        shipment_id: String(row.shipmentId).trim().toUpperCase(),
        direction: expediteDirection(row),
        carrier_name: row.scac ?? null,
        trailer_number: null,
        first_stop_name: row.originName ?? null,
        first_stop_address: [row.originName, row.origin].filter(Boolean).join(' - '),
        last_stop_address: row.destination ?? null,
        eta_status: row.etaStatus ?? null,
        mode: row.mode ?? null,
        plant_scheduled_at: null,
        source_batch_id: batch.source_batch_id,
        driverDocument: row.driverDocument,
      })),
    };
  }

  shipments() {
    return this.shared('shipments', 4000, () => this.computeShipments());
  }

  private async computeShipments() {
    const native = await this.nativeShipments();
    if (!await this.databaseSchemaReady()) {
      return this.mirror.availableShipmentResponse({
        ...native,
        storage: 'NATIVE_VERIFIED' as const,
        databaseImportedAt: null,
        shipments: await this.mirror.withDriverDocumentState(native.shipments),
      });
    }
    try {
      await this.mirror.importSnapshot(native);
      const persisted = await this.mirror.databaseShipments(native.sourceBatchId);
      if (persisted) return this.mirror.availableShipmentResponse(persisted);
    } catch {
      // Keep the verified native batch available even if PostgreSQL import needs review.
    }
    return this.mirror.availableShipmentResponse({
      ...native,
      storage: 'NATIVE_FALLBACK' as const,
      databaseImportedAt: null,
      shipments: await this.mirror.withDriverDocumentState(native.shipments),
    });
  }

  recoverConnection(options: RecoverOptions = {}) {
    this.invalidateShared();
    return this.connectionRecovery.recover('expedite', options);
  }

  /** Administrator Restart worker for the Expedite scheduler container. */
  restartWorker() {
    this.invalidateShared();
    return this.connectionRecovery.restartWorker('expedite');
  }

  requestRescan(): Promise<RxoExpediteManualRunState> {
    if (this.manualScanRequest) return this.manualScanRequest;
    if (this.connectionRecovery.isRecovering('expedite')) {
      throw new BadRequestException('Expedite connection recovery is already being queued.');
    }
    this.invalidateShared();
    const request = this.docker.requestScan().finally(() => {
      if (this.manualScanRequest === request) this.manualScanRequest = null;
      this.invalidateShared();
    });
    this.manualScanRequest = request;
    return request;
  }

  async updateSettings(input: ExpediteSettingsInput, origin: unknown, intent: unknown) {
    this.invalidateShared();
    const policy = this.controlPolicy();
    if (!policy.credentialUpdatesEnabled || origin !== policy.controlOrigin || intent !== 'update-settings') {
      throw new ForbiddenException('Expedite schedule updates are disabled or this origin is not authorized by the configured network policy.');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['intervalMinutes', 'syncOnStart'].includes(k))) throw new BadRequestException('Invalid Expedite schedule request.');
    if (!Number.isInteger(input.intervalMinutes) || Number(input.intervalMinutes) < 1 || Number(input.intervalMinutes) > 1440 || typeof input.syncOnStart !== 'boolean') throw new BadRequestException('Expedite interval must be 1-1440 minutes and run-on-start must be true or false.');
    const result = await this.settingsHelper(true, { intervalMinutes: Number(input.intervalMinutes), syncOnStart: input.syncOnStart });
    return { source: 'RXO_EXPEDITE', settings: { intervalMinutes: Number(result.intervalMinutes), syncOnStart: result.syncOnStart === true } };
  }

  async updateCredentials(input: CredentialInput, origin: unknown, intent: unknown) {
    this.invalidateShared();
    const policy = this.controlPolicy();
    if (!policy.credentialUpdatesEnabled || origin !== policy.controlOrigin || intent !== 'update-credentials') {
      throw new ForbiddenException('Expedite credential updates are disabled or this origin is not authorized by the configured network policy.');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['username', 'password'].includes(k))) throw new BadRequestException('Invalid Expedite credential request.');
    if (typeof input.username !== 'string' || !input.username.trim() || input.username.trim().length > 256 || /[\x00-\x1f\x7f]/.test(input.username)) throw new BadRequestException('A valid dedicated Expedite username is required.');
    if (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > 2048 || /[\x00-\x1f\x7f]/.test(input.password))) throw new BadRequestException('Invalid Expedite password input.');
    const result = await this.helper(true, { username: input.username.trim(), password: input.password });
    return { source: 'RXO_EXPEDITE', ...this.publicCredentials(result), passwordUpdated: result.passwordUpdated === true };
  }
}
