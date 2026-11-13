import { returnedRows } from '@truck-log/server/data-access';
import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { AuthenticatedPrintAgent } from '@truck-log/server/auth/print-agent';
import { PrintAgentJobResultDto } from './dto/print-agent-job-result.dto';
import { DriverPrintStore } from './driver-print.store';
import type { DriverPrintPackageSummary } from './driver-print.types';
import { EXPIRED_LEASE_ERROR } from './driver-print.types';
import { cleanOptional } from './driver-print.utils';
import { lateResultNote } from './print-agent-late-result';

/**
 * How the reported outcome reaches the item:
 * - IN_LEASE: LEASED and the lease is still active (the normal path).
 * - AFTER_EXPIRY: still LEASED, lease expired, but the result was submitted in
 *   time; recorded as if it had arrived before expiry (details.lateResult).
 * - REPLACES_MONITOR_FAILURE: FAILED only by the lease monitor; the agent's
 *   in-time result replaces that uncertain failure, exactly once.
 */
export type AgentResultMode = 'IN_LEASE' | 'AFTER_EXPIRY' | 'REPLACES_MONITOR_FAILURE';

export interface LockedAgentResultRow {
  item_id: string;
  package_id: string;
  attempt_count: number;
  truck_visit_id: number;
  visit_document_id: number;
  request_kind: string;
  route: string;
  printer: string;
}

/**
 * Writes a verified Print Agent result for a legacy Driver Print item inside
 * the caller's transaction (row lock and idempotency advisory lock held).
 * A plain class constructed by DriverPrintAgentOperations (not a Nest provider).
 */
export class DriverPrintAgentResults {
  constructor(private readonly store: DriverPrintStore) {}

  /**
   * True when the locked item is FAILED only because the lease monitor expired
   * it: the EXPIRED_LEASE_ERROR marker, attempt details.outcomeAmbiguous = true
   * and no agent result recorded yet. Locks the attempt row.
   */
  async expiredByMonitor(
    manager: EntityManager,
    row: { item_id: string; attempt_count: number; status: string; last_error: string | null },
  ): Promise<boolean> {
    if (row.status !== 'FAILED' || row.last_error !== EXPIRED_LEASE_ERROR) return false;
    const attempts = await manager.query(
      `SELECT details
         FROM driver_print_attempts
        WHERE item_id = $1 AND attempt_number = $2 AND status = 'FAILED'
          AND details->>'outcomeAmbiguous' = 'true'
          AND NOT (details ? 'resultIdempotencyKey')
        FOR UPDATE`,
      [row.item_id, Number(row.attempt_count)],
    );
    return attempts.length === 1;
  }

  async record(
    manager: EntityManager,
    agent: AuthenticatedPrintAgent,
    row: LockedAgentResultRow,
    idempotencyKey: string,
    digest: string,
    input: PrintAgentJobResultDto,
    submittedAt: Date,
    now: Date,
    mode: AgentResultMode,
  ): Promise<DriverPrintPackageSummary> {
    const itemId = String(row.item_id);
    const replaces = mode === 'REPLACES_MONITOR_FAILURE';
    const late = mode !== 'IN_LEASE';
    const document = await this.store.documentSnapshotForAudit(
      manager,
      Number(row.truck_visit_id),
      Number(row.visit_document_id),
    );
    const status = input.success ? 'PRINTED' : 'FAILED';
    const error = input.success
      ? null
      : cleanOptional(input.error) ?? 'The Print Agent reported a failed RXO document print.';
    // Guarded: the normal path needs LEASED; a replacement needs the monitor's
    // FAILED marker on the same attempt. Exactly one row must change.
    const item = returnedRows(await manager.query(
      `UPDATE driver_print_items
          SET status = $2::varchar(30), last_error = $3,
              printed_at = CASE WHEN $2::varchar(30) = 'PRINTED' THEN $4::timestamptz ELSE NULL END,
              updated_at = $5
        WHERE id = $1 AND attempt_count = $6
          AND ${replaces ? `status = 'FAILED' AND last_error = $7` : `status = 'LEASED'`}
        RETURNING id`,
      [
        itemId,
        status,
        error,
        submittedAt,
        now,
        Number(row.attempt_count),
        ...(replaces ? [EXPIRED_LEASE_ERROR] : []),
      ],
    ));
    if (item.length !== 1) {
      throw new ConflictException('The Print Agent job changed before its result was saved.');
    }
    const attempt = returnedRows(await manager.query(
      `UPDATE driver_print_attempts
          SET status = $3, completed_at = $4, error_message = $5,
              details = details || $6::jsonb
        WHERE item_id = $1 AND attempt_number = $2
          AND ${replaces
            ? `status = 'FAILED' AND details->>'outcomeAmbiguous' = 'true' AND NOT (details ? 'resultIdempotencyKey')`
            : `status = 'LEASED'`}
        RETURNING id`,
      [
        itemId,
        Number(row.attempt_count),
        status,
        now,
        error,
        JSON.stringify({
          resultIdempotencyKey: idempotencyKey,
          submittedAt: submittedAt.toISOString(),
          reportedPrinter: input.printer.trim(),
          ...(late ? { lateResult: true } : {}),
          ...(replaces ? { outcomeAmbiguous: false, replacedLeaseMonitorError: EXPIRED_LEASE_ERROR } : {}),
        }),
      ],
    ));
    if (attempt.length !== 1) {
      throw new ConflictException(
        replaces
          ? 'The Print Agent attempt no longer carries the lease monitor failure.'
          : 'The Print Agent attempt is not in a leased state.',
      );
    }
    if (row.request_kind === 'ORIGINAL') {
      await manager.query(
        `UPDATE visit_documents
            SET print_status = $2, print_error = $3, updated_at = $4
          WHERE id = $1`,
        [document.id, status, error, now],
      );
    }
    if (input.success) {
      await manager.query(
        `UPDATE print_agents
            SET last_successful_print_at = CASE
                  WHEN last_successful_print_at IS NULL THEN $2
                  ELSE GREATEST(last_successful_print_at, $2)
                END,
                last_seen_at = $3, updated_at = $3
          WHERE agent_id = $1 AND enabled = TRUE`,
        [agent.agentId, submittedAt, now],
      );
    } else {
      await manager.query(
        `UPDATE print_agents
            SET last_error_at = $2, last_error = $3,
                last_seen_at = $2, updated_at = $2
          WHERE agent_id = $1 AND enabled = TRUE`,
        [agent.agentId, now, error],
      );
    }

    // driver_print_events keeps its constrained event types; the late result
    // is flagged in details. The visit history gets a distinct _LATE_RESULT event.
    const eventType = input.success ? 'RXO_DOCUMENT_PRINTED' : 'RXO_DOCUMENT_PRINT_FAILED';
    await this.store.insertDriverEvent(manager, {
      eventType,
      actorType: 'PRINT_AGENT',
      actorId: agent.agentId,
      truckVisitId: Number(row.truck_visit_id),
      packageId: String(row.package_id),
      itemId,
      document,
      route: String(row.route),
      printer: String(row.printer),
      error,
      details: {
        attemptNumber: Number(row.attempt_count),
        submittedAt: submittedAt.toISOString(),
        resultIdempotencyKey: idempotencyKey,
        ...(late ? { lateResult: true } : {}),
        ...(replaces ? { replacedLeaseMonitorError: EXPIRED_LEASE_ERROR } : {}),
      },
    });
    const outcome =
      error ?? `RXO document ${document.id} version ${document.documentVersion} printed to ${row.printer}.`;
    await this.store.insertVisitEvent(
      manager,
      Number(row.truck_visit_id),
      !replaces
        ? eventType
        : input.success
          ? 'RXO_DOCUMENT_PRINTED_LATE_RESULT'
          : 'RXO_DOCUMENT_PRINT_FAILED_LATE_RESULT',
      agent.displayName,
      replaces ? lateResultNote(submittedAt, outcome) : outcome,
      now,
    );
    await this.store.refreshPackageStatus(manager, String(row.package_id));
    const response = await this.store.summaryByPackageId(manager, String(row.package_id));
    await this.store.insertAgentIdempotency(manager, agent.agentId, idempotencyKey, digest, response);
    return response;
  }
}
