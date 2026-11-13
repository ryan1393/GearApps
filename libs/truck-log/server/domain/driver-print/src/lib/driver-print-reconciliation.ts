import { returnedRows } from '@truck-log/server/data-access';
import { ConflictException, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AutomaticDriverPrintService } from './automatic-driver-print.service';
import { DriverPrintAgentOperations } from './driver-print-agent.operations';
import { DriverPrintStore } from './driver-print.store';

/**
 * Background safety work for Driver Print queues: expire ambiguous leases,
 * fail queued items whose frozen printer/route is no longer advertised, and
 * scrub plaintext claim tokens from legacy idempotency responses. Nothing here
 * requeues or retries a job, so it can never duplicate a physical print.
 * A plain class owned by DriverPrintService (not a Nest provider).
 */
export class DriverPrintReconciliation {
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private reconciliationRunning = false;
  private lastReconciliationError: string | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly store: DriverPrintStore,
    private readonly automatic: AutomaticDriverPrintService,
    private readonly agentOperations: DriverPrintAgentOperations,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    await this.scrubPersistedClaimTokens();
    this.reconciliationTimer = setInterval(() => {
      void this.runScheduledReconciliation();
    }, 15_000);
    this.reconciliationTimer.unref();
  }

  stop(): void {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = null;
  }

  /**
   * Reconciles only jobs that have not been leased to Windows. It never
   * requeues or retries a job and therefore cannot duplicate a physical print.
   * Public for deterministic release tests; it is intentionally not an HTTP
   * endpoint.
   */
  async reconcileQueuedJobs(): Promise<number> {
    await this.dataSource.transaction(manager => this.automatic.expire(manager));
    await this.dataSource.transaction(manager => this.automatic.reconcileQueued(manager));

    return this.dataSource.transaction(async (manager) => {
      // Select only invalid queued items, so healthy old items cannot starve later failures.
      const rows = await manager.query(
        `SELECT item.id AS item_id, item.package_id, item.attempt_count,
                item.assigned_agent_id, item.route, item.printer,
                item.visit_document_id, package.truck_visit_id, package.request_kind
           FROM driver_print_items item
           JOIN driver_print_packages package ON package.id = item.package_id
          WHERE item.item_type = 'RXO_DOCUMENT' AND item.status = 'QUEUED'
            AND NOT EXISTS (
              SELECT 1 FROM print_agents agent
               WHERE agent.agent_id = item.assigned_agent_id AND agent.enabled = TRUE
                 AND agent.last_seen_at >= NOW() - ($1::int * INTERVAL '1 second')
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements(agent.configured_routes) r
                   WHERE r->>'route' = item.route AND r->>'outputPrinter' = item.printer)
            )
          ORDER BY item.created_at, item.id LIMIT 500 FOR UPDATE OF item SKIP LOCKED`,
        [this.store.offlineSeconds()],
      );
      let failed = 0;
      const now = new Date();
      for (const row of rows) {
        const error = 'The frozen gate printer/route is not currently advertised by its online Print Agent. Verify the printer before a guard retry.';
        if (await this.failLockedQueuedItem(manager, row, error, now)) failed += 1;
      }
      return failed;
    });
  }

  async runScheduledReconciliation(): Promise<void> {
    if (this.reconciliationRunning) return;
    this.reconciliationRunning = true;
    try {
      await this.scrubPersistedClaimTokens();
      // A Windows agent can disappear after leasing a job. Expire those
      // ambiguous leases on the server's own timer so UI-only polling cannot
      // leave the guard stuck in PRINTING indefinitely. Expiry records an
      // explicit failure; it never automatically requeues or duplicates a
      // physical print.
      await this.agentOperations.expireLeases();
      await this.reconcileQueuedJobs();
      this.lastReconciliationError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.lastReconciliationError) {
        this.logger.warn(`Driver Print queue reconciliation failed: ${message}`);
        this.lastReconciliationError = message;
      }
    } finally {
      this.reconciliationRunning = false;
    }
  }

  async scrubPersistedClaimTokens(): Promise<number> {
    const scrubbed = returnedRows(await this.dataSource.query(
      `WITH candidates AS (
         SELECT agent_id, idempotency_key
           FROM print_agent_idempotency
          WHERE jsonb_typeof(response_body -> 'job') = 'object'
            AND (response_body -> 'job') ? 'claimToken'
          ORDER BY created_at, agent_id, idempotency_key
          LIMIT 1000
          FOR UPDATE SKIP LOCKED
       )
       UPDATE print_agent_idempotency stored
          SET response_body = stored.response_body #- '{job,claimToken}'
         FROM candidates
        WHERE stored.agent_id = candidates.agent_id
          AND stored.idempotency_key = candidates.idempotency_key
       RETURNING stored.agent_id`,
    ));
    if (scrubbed.length > 0) {
      this.logger.warn(
        `Removed plaintext claim tokens from ${scrubbed.length} legacy Print Agent idempotency response(s).`,
      );
    }
    return scrubbed.length;
  }

  private async failLockedQueuedItem(
    manager: EntityManager,
    row: Record<string, unknown>,
    error: string,
    now: Date,
  ): Promise<boolean> {
    const updated = returnedRows(await manager.query(
      `UPDATE driver_print_items
          SET status = 'FAILED', last_error = $2,
              printed_at = NULL, updated_at = $3
        WHERE id = $1 AND status = 'QUEUED'
        RETURNING id`,
      [row.item_id, error, now],
    ));
    if (!updated[0]) return false;
    const attempt = returnedRows(await manager.query(
      `UPDATE driver_print_attempts
          SET status = 'FAILED', completed_at = $3, error_message = $4,
              details = details || $5::jsonb
        WHERE item_id = $1 AND attempt_number = $2 AND status = 'REQUESTED'
        RETURNING id`,
      [
        row.item_id,
        Number(row.attempt_count),
        now,
        error,
        JSON.stringify({ phase: 'QUEUE', retryRequired: true }),
      ],
    ));
    if (!attempt[0]) {
      throw new ConflictException('The queued Print Agent attempt is missing or final.');
    }
    const document = await this.store.documentSnapshotForAudit(
      manager,
      Number(row.truck_visit_id),
      Number(row.visit_document_id),
    );
    if (row.request_kind === 'ORIGINAL') {
      await manager.query(
        `UPDATE visit_documents
            SET print_status = 'FAILED', print_error = $2, updated_at = $3
          WHERE id = $1`,
        [document.id, error, now],
      );
    }
    await this.store.insertDriverEvent(manager, {
      eventType: 'RXO_DOCUMENT_PRINT_FAILED',
      actorType: 'SYSTEM',
      actorId: 'TRUCK_LOG_AGENT_MONITOR',
      truckVisitId: Number(row.truck_visit_id),
      packageId: String(row.package_id),
      itemId: String(row.item_id),
      document,
      route: row.route === null ? null : String(row.route),
      printer: row.printer === null ? null : String(row.printer),
      error,
      details: { phase: 'QUEUE', retryRequired: true },
    });
    await this.store.insertVisitEvent(
      manager,
      Number(row.truck_visit_id),
      'RXO_DOCUMENT_PRINT_FAILED',
      'TRUCK_LOG_AGENT_MONITOR',
      error,
      now,
    );
    await this.store.refreshPackageStatus(manager, String(row.package_id));
    return true;
  }
}
