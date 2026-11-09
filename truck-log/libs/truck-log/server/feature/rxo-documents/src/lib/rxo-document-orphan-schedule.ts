import { Logger } from '@nestjs/common';

import type { RxoDocumentOrphanReconciler } from './rxo-document-orphan-reconciler';

export const ORPHAN_RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Runs the RXO orphaned-file reconciler at startup and every six hours.
 * Runs never overlap, and a failure is logged without removing any uncertain file.
 * A plain class owned by RxoDocumentsService (not a Nest provider).
 */
export class RxoDocumentOrphanSchedule {
  private orphanReconciliationTimer: NodeJS.Timeout | null = null;
  private orphanReconciliationRunning = false;

  constructor(
    private readonly orphanReconciler: RxoDocumentOrphanReconciler,
    private readonly logger: Logger,
  ) {}

  start(): void {
    // Recover the narrow filesystem-before-database crash window without
    // delaying startup. The grace period prevents any live upload transaction
    // from being mistaken for an orphan.
    this.runOrphanReconciliation();
    this.orphanReconciliationTimer = setInterval(
      () => this.runOrphanReconciliation(),
      ORPHAN_RECONCILIATION_INTERVAL_MS,
    );
    this.orphanReconciliationTimer.unref();
  }

  stop(): void {
    if (this.orphanReconciliationTimer) {
      clearInterval(this.orphanReconciliationTimer);
      this.orphanReconciliationTimer = null;
    }
  }

  private runOrphanReconciliation(): void {
    if (this.orphanReconciliationRunning) return;
    this.orphanReconciliationRunning = true;
    void this.orphanReconciler.reconcile()
      .catch((error: unknown) => {
        this.logger.error(
          'RXO orphaned-document reconciliation stopped safely; no uncertain file was removed.',
          error instanceof Error ? error.stack : undefined,
        );
      })
      .finally(() => {
        this.orphanReconciliationRunning = false;
      });
  }
}
