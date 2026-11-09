import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthenticatedTruckLogPrincipal } from '@truck-log/server/auth/access';
import type { AuthenticatedPrintAgent } from '@truck-log/server/auth/print-agent';
import { SapDocumentStorageService } from '@truck-log/server/infrastructure/sap-documents';
import { DockPrintResultDto } from './dto/dock-print-result.dto';
import { PrintAgentJobClaimDto } from './dto/print-agent-job-claim.dto';
import { PrintAgentJobResultDto } from './dto/print-agent-job-result.dto';
import type { RecoverQueuedPrintDto } from './dto/recover-queued-print.dto';
import { ReprintRxoDocumentDto } from './dto/reprint-rxo-document.dto';
import { AutomaticDriverPrintService } from './automatic-driver-print.service';
import { DriverPrintAgentOperations } from './driver-print-agent.operations';
import { DriverPrintGuardActions } from './driver-print-guard-actions';
import { DriverPrintOriginalPackage } from './driver-print-original-package';
import { DriverPrintReconciliation } from './driver-print-reconciliation';
import { DriverPrintReprint } from './driver-print-reprint';
import { DriverPrintStore } from './driver-print.store';
export type {
  DriverPrintItemStatus,
  DriverPrintPackageSummary,
  PrintAgentDocumentDownload,
} from './driver-print.types';
import type {
  DriverPrintPackageSummary,
  PrintAgentDocumentDownload,
} from './driver-print.types';

/**
 * Orchestrates Driver Print Packages and their retry/reprint lifecycle.
 *
 * Print Agent protocol mechanics live in DriverPrintAgentOperations and common
 * persistence/summary work lives in DriverPrintStore. Legacy package creation,
 * guard actions, authorized reprint and background reconciliation live in
 * DriverPrintOriginalPackage, DriverPrintGuardActions, DriverPrintReprint and
 * DriverPrintReconciliation. This class routes each public call to the
 * automatic (agent-printed) flow when it owns the package, otherwise to the
 * legacy collaborator. New behavior should go to those collaborators instead
 * of growing this coordinator again.
 */
@Injectable()
export class DriverPrintService implements OnModuleInit, OnModuleDestroy {
  private readonly store: DriverPrintStore;
  private readonly agentOperations: DriverPrintAgentOperations;
  private readonly logger = new Logger(DriverPrintService.name);
  private readonly originalPackage: DriverPrintOriginalPackage;
  private readonly guardActions: DriverPrintGuardActions;
  private readonly reprint: DriverPrintReprint;
  private readonly reconciliation: DriverPrintReconciliation;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly storage: SapDocumentStorageService,
    private readonly automatic: AutomaticDriverPrintService,
  ) {
    this.store = new DriverPrintStore(this.config);
    this.agentOperations = new DriverPrintAgentOperations(this.dataSource, this.storage, this.automatic, this.store);
    this.originalPackage = new DriverPrintOriginalPackage(this.store);
    this.guardActions = new DriverPrintGuardActions(this.dataSource, this.store, this.agentOperations);
    this.reprint = new DriverPrintReprint(this.dataSource, this.store);
    this.reconciliation = new DriverPrintReconciliation(
      this.dataSource,
      this.store,
      this.automatic,
      this.agentOperations,
      this.logger,
    );
  }

  async claimAgentJob(
    agent: AuthenticatedPrintAgent,
    idempotencyKey: string | undefined,
    body: PrintAgentJobClaimDto,
  ) {
    return this.agentOperations.claimAgentJob(agent, idempotencyKey, body);
  }

  async documentForAgent(
    agent: AuthenticatedPrintAgent,
    itemId: string,
    claimToken: string | undefined,
  ): Promise<PrintAgentDocumentDownload> {
    return this.agentOperations.documentForAgent(agent, itemId, claimToken);
  }

  async recordAgentResult(
    agent: AuthenticatedPrintAgent,
    itemId: string,
    idempotencyKey: string | undefined,
    body: PrintAgentJobResultDto,
  ): Promise<DriverPrintPackageSummary> {
    return this.agentOperations.recordAgentResult(agent, itemId, idempotencyKey, body);
  }

  async onModuleInit(): Promise<void> {
    await this.reconciliation.start();
  }

  onModuleDestroy(): void {
    this.reconciliation.stop();
  }

  /**
   * Called from the visit-creation transaction after the active RXO document
   * has been deterministically attached to the visit. The frozen document id,
   * package, both items, attempts, and audit records commit atomically with the
   * visit. A browser print dialog is never treated as proof of printing.
   */
  async createOriginalPackage(
    manager: EntityManager,
    visitId: number,
    frozenDocumentId: number,
    requestedBy: string | null,
    guardGate: 'EAST' | 'WEST' | null = null,
  ): Promise<DriverPrintPackageSummary> {
    const automaticPackage = await this.automatic.attachRxoIfOwned(manager, visitId, frozenDocumentId);
    if (automaticPackage) return automaticPackage;

    return this.originalPackage.createOriginalPackage(
      manager,
      visitId,
      frozenDocumentId,
      requestedBy,
      guardGate,
    );
  }

  async getPackageById(packageId: string): Promise<DriverPrintPackageSummary> {
    if (await this.automatic.ownsPackage(packageId)) return this.automatic.summary(this.dataSource.manager,packageId);
    return this.store.summaryByPackageId(this.dataSource.manager,packageId);
  }

  async getForVisit(visitId: number): Promise<DriverPrintPackageSummary | null> {
    const automaticPackage = await this.automatic.forVisit(visitId);
    if (automaticPackage) return automaticPackage;

    const rows = await this.dataSource.query(
      `SELECT id
         FROM driver_print_packages
        WHERE truck_visit_id = $1 AND request_kind = 'ORIGINAL'
        LIMIT 1`,
      [visitId],
    );
    return rows[0]
      ? this.store.summaryByPackageId(this.dataSource.manager, String(rows[0].id))
      : null;
  }

  async attachPackageSummary<T extends { id: number }>(
    visit: T,
  ): Promise<T & { driverPrintPackage: DriverPrintPackageSummary | null }> {
    return {
      ...visit,
      driverPrintPackage: await this.getForVisit(visit.id),
    };
  }

  /**
   * Reconciles only jobs that have not been leased to Windows. It never
   * requeues or retries a job and therefore cannot duplicate a physical print.
   * Public for deterministic release tests; it is intentionally not an HTTP
   * endpoint.
   */
  async reconcileQueuedJobs(): Promise<number> {
    return this.reconciliation.reconcileQueuedJobs();
  }

  async recordDockResult(
    packageId: string,
    idempotencyKey: string | undefined,
    guardActionKey: string | undefined,
    input: DockPrintResultDto,
  ): Promise<DriverPrintPackageSummary> {
    if (await this.automatic.ownsPackage(packageId)) {
      throw new ConflictException('This Dock Assignment is agent-printed. A browser cannot confirm its result.');
    }
    return this.guardActions.recordDockResult(packageId, idempotencyKey, guardActionKey, input);
  }

  async retryRxo(
    packageId: string,
    idempotencyKey: string | undefined,
    guardActionKey: string | undefined,
  ): Promise<DriverPrintPackageSummary> {
    const automaticResult = await this.automatic.retryIfOwned(packageId, 'RXO_DOCUMENT', idempotencyKey, guardActionKey);
    if (automaticResult) return automaticResult;
    return this.guardActions.retryRxo(packageId, idempotencyKey, guardActionKey);
  }

  async retryDock(
    packageId: string,
    idempotencyKey: string | undefined,
    guardActionKey: string | undefined,
  ): Promise<DriverPrintPackageSummary> {
    const automaticResult = await this.automatic.retryIfOwned(packageId, 'DOCK_ASSIGNMENT', idempotencyKey, guardActionKey);
    if (automaticResult) return automaticResult;
    return this.guardActions.retryDock(packageId, idempotencyKey, guardActionKey);
  }

  async recoverQueued(packageId: string, requestKey: string | undefined, guardKey: string | undefined, input: RecoverQueuedPrintDto) {
    return this.automatic.recoverQueued(packageId,requestKey,guardKey,input);
  }

  async reprintRxo(
    visitId: number,
    principal: AuthenticatedTruckLogPrincipal,
    idempotencyKey: string | undefined,
    input: ReprintRxoDocumentDto,
  ): Promise<DriverPrintPackageSummary> {
    const automaticResult = await this.automatic.reprintIfOwned(visitId, principal, idempotencyKey, input);
    if (automaticResult) return automaticResult;

    return this.reprint.reprintRxo(visitId, principal, idempotencyKey, input);
  }

  async getGateRoutingStatus() {
    // Read-only capability check for the installer; never returns tokens or signing keys.
    const configuration = this.store.driverPrintConfiguration();
    const gates = [];
    for (const gate of ['EAST', 'WEST'] as const) {
      const printer = await this.store.gatePrinterSetting(this.dataSource.manager, gate);
      const availability = await this.store.agentAvailability(this.dataSource.manager, false, printer);
      gates.push({gate, printer, configured: !!printer, available: availability.available, error: availability.error});
    }
    return {contract: 'truck-log-dual-gate-v1', version: process.env.TRUCK_LOG_RELEASE || '1.0.0', checkedAt: new Date().toISOString(),
      agentId: configuration.agentId, route: configuration.route, configurationValid: configuration.valid,
      gates, frozenPrinterRequired: true, claimUsesAdvertisedPrinters: true};
  }

  /** AUTOMATIC-CHECK-IN-PRINT: opt-in new visits only; old visits are never backfilled. */
  async createAutomaticDockPackage(manager: EntityManager, visitId: number, gate: 'EAST' | 'WEST', actor: string | null): Promise<void> {
    await this.automatic.create(manager, visitId, gate, actor);
  }

  async assertAutomaticPrintRequest(manager: EntityManager, visitId: number, enabled: boolean, gate: unknown): Promise<void> {
    await this.automatic.assertRequest(manager, visitId, enabled, gate);
  }
}
