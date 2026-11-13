import { returnedRows } from '@truck-log/server/data-access';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { DockPrintResultDto } from './dto/dock-print-result.dto';
import { DriverPrintAgentOperations } from './driver-print-agent.operations';
import { DriverPrintStore } from './driver-print.store';
import type { DriverPrintPackageSummary } from './driver-print.types';
import { SYSTEM_GUARD_ACTOR } from './driver-print.types';
import { cleanOptional } from './driver-print.utils';

/**
 * Guard-initiated actions on legacy (browser-confirmed) Driver Print Packages:
 * Dock Assignment confirmation and explicit Dock/RXO retries. Every action
 * takes the same prologue: an advisory lock per package action, a row lock on
 * the item, and proof of the original check-in capability (guard action key).
 * Automatic packages are routed away by DriverPrintService before these run.
 * A plain class constructed by DriverPrintService (not a Nest provider).
 */
export class DriverPrintGuardActions {
  constructor(
    private readonly dataSource: DataSource,
    private readonly store: DriverPrintStore,
    private readonly agentOperations: DriverPrintAgentOperations,
  ) {}

  /** Shared prologue: lock the action, lock the item row, prove the guard action key. */
  private async lockGuardActionItem(
    manager: EntityManager,
    lockKey: string,
    itemSql: string,
    packageId: string,
    guardActionKey: string | undefined,
    notFoundMessage: string,
  ): Promise<any> {
    await this.store.lockAction(manager, lockKey);
    const rows = await manager.query(itemSql, [packageId]);
    const row = rows[0];
    if (!row) throw new NotFoundException(notFoundMessage);
    this.store.assertGuardActionKey(guardActionKey, row.client_request_id);
    return row;
  }

  async recordDockResult(
    packageId: string,
    idempotencyKey: string | undefined,
    guardActionKey: string | undefined,
    input: DockPrintResultDto,
  ): Promise<DriverPrintPackageSummary> {
    this.store.assertIdempotencyKey(idempotencyKey);
    const desiredStatus = input.status;
    const result = await this.dataSource.transaction(async (manager) => {
      const row = await this.lockGuardActionItem(
        manager,
        `dock-result:${packageId}`,
        `SELECT package.id AS package_id, package.truck_visit_id,
                visit.client_request_id,
                item.id AS item_id, item.status, item.attempt_count
           FROM driver_print_packages package
           JOIN truck_visits visit ON visit.id = package.truck_visit_id
           JOIN driver_print_items item
             ON item.package_id = package.id
            AND item.item_type = 'DOCK_ASSIGNMENT'
          WHERE package.id = $1
          FOR UPDATE OF item`,
        packageId,
        guardActionKey,
        'Driver Print Package was not found.',
      );

      const prior = await manager.query(
        `SELECT event_type
           FROM driver_print_events
          WHERE item_id = $1
            AND details->>'idempotencyKey' = $2
            AND event_type IN ('DOCK_ASSIGNMENT_PRINTED', 'DOCK_ASSIGNMENT_PRINT_FAILED')
          ORDER BY id DESC
          LIMIT 1`,
        [row.item_id, idempotencyKey],
      );
      if (prior[0]) {
        const priorStatus = prior[0].event_type === 'DOCK_ASSIGNMENT_PRINTED'
          ? 'PRINTED'
          : 'FAILED';
        if (priorStatus !== desiredStatus) {
          throw new ConflictException(
            'This X-Idempotency-Key was already used with a different Dock Assignment result.',
          );
        }
        return this.store.summaryByPackageId(manager, packageId);
      }

      if (row.status === 'PRINTED' || row.status === 'FAILED') {
        if (row.status !== desiredStatus) {
          throw new ConflictException(
            'The Dock Assignment result is already final and cannot be changed.',
          );
        }
        return this.store.summaryByPackageId(manager, packageId);
      }
      if (row.status !== 'PENDING_CONFIRMATION') {
        throw new ConflictException('The Dock Assignment item is not awaiting confirmation.');
      }

      const now = new Date();
      const error = desiredStatus === 'FAILED'
        ? cleanOptional(input.error) ?? 'The guard reported that the Dock Assignment Slip failed to print.'
        : null;
      await manager.query(
        `UPDATE driver_print_items
            SET status = $2::varchar(30),
                last_error = $3,
                printed_at = CASE WHEN $2::varchar(30) = 'PRINTED' THEN $4::timestamptz ELSE NULL END,
                updated_at = $4
          WHERE id = $1 AND status = 'PENDING_CONFIRMATION'`,
        [row.item_id, desiredStatus, error, now],
      );
      const attempt = returnedRows(await manager.query(
        `UPDATE driver_print_attempts
            SET status = $3,
                completed_at = $4,
                error_message = $5,
                details = details || $6::jsonb
          WHERE item_id = $1 AND attempt_number = $2 AND status = 'REQUESTED'
          RETURNING id`,
        [
          row.item_id,
          Number(row.attempt_count),
          desiredStatus,
          now,
          error,
          JSON.stringify({ idempotencyKey, confirmationSource: 'GUARD_UI' }),
        ],
      ));
      if (!attempt[0]) {
        throw new ConflictException('The Dock Assignment confirmation attempt is missing or final.');
      }

      const eventType = desiredStatus === 'PRINTED'
        ? 'DOCK_ASSIGNMENT_PRINTED'
        : 'DOCK_ASSIGNMENT_PRINT_FAILED';
      await this.store.insertDriverEvent(manager, {
        eventType,
        actorType: 'SYSTEM',
        actorId: SYSTEM_GUARD_ACTOR,
        truckVisitId: Number(row.truck_visit_id),
        packageId,
        itemId: String(row.item_id),
        error,
        details: { idempotencyKey, confirmationSource: 'GUARD_UI' },
      });
      await this.store.insertVisitEvent(
        manager,
        Number(row.truck_visit_id),
        eventType,
        SYSTEM_GUARD_ACTOR,
        error ?? `Dock Assignment Slip confirmed printed for package ${packageId}.`,
        now,
      );
      await this.store.refreshPackageStatus(manager, packageId);
      return this.store.summaryByPackageId(manager, packageId);
    });
    return result;
  }

  async retryRxo(
    packageId: string,
    idempotencyKey: string | undefined,
    guardActionKey: string | undefined,
  ): Promise<DriverPrintPackageSummary> {
    this.store.assertIdempotencyKey(idempotencyKey);
    await this.agentOperations.expireLeases();
    return this.dataSource.transaction(async (manager) => {
      const row = await this.lockGuardActionItem(
        manager,
        `rxo-retry:${packageId}`,
        `SELECT package.id AS package_id, package.truck_visit_id,
                visit.client_request_id,
                item.id AS item_id, item.status, item.attempt_count,
                item.visit_document_id, item.printer, item.route, item.assigned_agent_id
           FROM driver_print_packages package
           JOIN truck_visits visit ON visit.id = package.truck_visit_id
           JOIN driver_print_items item
             ON item.package_id = package.id
            AND item.item_type = 'RXO_DOCUMENT'
          WHERE package.id = $1
            AND package.request_kind = 'ORIGINAL'
          FOR UPDATE OF item`,
        packageId,
        guardActionKey,
        'RXO Driver Print Package item was not found.',
      );

      const prior = await manager.query(
        `SELECT id, attempt_kind
           FROM driver_print_attempts
          WHERE item_id = $1
            AND idempotency_key = $2
          LIMIT 1`,
        [row.item_id, idempotencyKey],
      );
      if (prior[0]) {
        if (prior[0].attempt_kind !== 'RETRY') {
          throw new ConflictException(
            'This X-Idempotency-Key was already used for a different print attempt.',
          );
        }
        return this.store.summaryByPackageId(manager, packageId);
      }
      if (row.status !== 'FAILED') {
        throw new ConflictException(
          row.status === 'PRINTED'
            ? 'The RXO document is already printed; use authorized reprint for another copy.'
            : 'Only a failed RXO document item can be retried.',
        );
      }

      const availability = await this.store.agentAvailability(manager, false, cleanOptional(String(row.printer ?? '')));
      if (!availability.available || !availability.agentId || !availability.route || !availability.printer
        || availability.agentId !== row.assigned_agent_id || availability.route !== row.route) {
        throw new ServiceUnavailableException(
          availability.error ?? 'The configured Driver Print Agent is unavailable.',
        );
      }
      const document = await this.store.requireRxoDocument(
        manager,
        Number(row.truck_visit_id),
        Number(row.visit_document_id),
        false,
      );
      const now = new Date();
      const attemptNumber = Number(row.attempt_count) + 1;
      await manager.query(
        `UPDATE driver_print_items
            SET status = 'QUEUED', route = $2, printer = $3,
                assigned_agent_id = $4, lease_token_sha256 = NULL,
                leased_at = NULL, lease_expires_at = NULL,
                attempt_count = $5, last_error = NULL, printed_at = NULL,
                updated_at = $6
          WHERE id = $1 AND status = 'FAILED'`,
        [
          row.item_id,
          availability.route,
          availability.printer,
          availability.agentId,
          attemptNumber,
          now,
        ],
      );
      await manager.query(
        `INSERT INTO driver_print_attempts(
           id, item_id, attempt_number, attempt_kind, status, agent_id,
           route, printer, requested_at, idempotency_key, details, created_at
         ) VALUES ($1, $2, $3, 'RETRY', 'REQUESTED', $4, $5, $6, $7, $8, $9::jsonb, $7)`,
        [
          randomUUID(),
          row.item_id,
          attemptNumber,
          availability.agentId,
          availability.route,
          availability.printer,
          now,
          idempotencyKey,
          JSON.stringify({ requestedFrom: 'GUARD_UI' }),
        ],
      );
      await manager.query(
        `UPDATE visit_documents
            SET print_status = 'PENDING', print_error = NULL, updated_at = $2
          WHERE id = $1`,
        [document.id, now],
      );
      await this.store.insertDriverEvent(manager, {
        eventType: 'RXO_DOCUMENT_PRINT_RETRIED',
        actorType: 'SYSTEM',
        actorId: SYSTEM_GUARD_ACTOR,
        truckVisitId: Number(row.truck_visit_id),
        packageId,
        itemId: String(row.item_id),
        document,
        route: availability.route,
        printer: availability.printer,
        details: { attemptNumber, idempotencyKey },
      });
      await this.store.insertVisitEvent(
        manager,
        Number(row.truck_visit_id),
        'RXO_DOCUMENT_PRINT_RETRIED',
        SYSTEM_GUARD_ACTOR,
        `RXO driver document ${document.id} version ${document.documentVersion} retry ${attemptNumber} queued.`,
        now,
      );
      await this.store.refreshPackageStatus(manager, packageId);
      return this.store.summaryByPackageId(manager, packageId);
    });
  }

  async retryDock(
    packageId: string,
    idempotencyKey: string | undefined,
    guardActionKey: string | undefined,
  ): Promise<DriverPrintPackageSummary> {
    this.store.assertIdempotencyKey(idempotencyKey);
    return this.dataSource.transaction(async (manager) => {
      const row = await this.lockGuardActionItem(
        manager,
        `dock-retry:${packageId}`,
        `SELECT package.id AS package_id, package.truck_visit_id,
                visit.client_request_id,
                item.id AS item_id, item.status, item.attempt_count
           FROM driver_print_packages package
           JOIN truck_visits visit ON visit.id = package.truck_visit_id
           JOIN driver_print_items item
             ON item.package_id = package.id
            AND item.item_type = 'DOCK_ASSIGNMENT'
          WHERE package.id = $1
            AND package.request_kind = 'ORIGINAL'
          FOR UPDATE OF item`,
        packageId,
        guardActionKey,
        'Dock Assignment print item was not found.',
      );

      const prior = await manager.query(
        `SELECT id, attempt_kind
           FROM driver_print_attempts
          WHERE item_id = $1 AND idempotency_key = $2
          LIMIT 1`,
        [row.item_id, idempotencyKey],
      );
      if (prior[0]) {
        if (prior[0].attempt_kind !== 'RETRY') {
          throw new ConflictException(
            'This X-Idempotency-Key was already used for a different print attempt.',
          );
        }
        return this.store.summaryByPackageId(manager, packageId);
      }
      if (row.status !== 'FAILED') {
        throw new ConflictException(
          row.status === 'PRINTED'
            ? 'The Dock Assignment Slip is already confirmed printed.'
            : 'Only a failed Dock Assignment item can be retried.',
        );
      }

      const now = new Date();
      const attemptNumber = Number(row.attempt_count) + 1;
      const item = returnedRows(await manager.query(
        `UPDATE driver_print_items
            SET status = 'PENDING_CONFIRMATION', attempt_count = $2,
                last_error = NULL, printed_at = NULL, updated_at = $3
          WHERE id = $1 AND status = 'FAILED'
          RETURNING id`,
        [row.item_id, attemptNumber, now],
      ));
      if (!item[0]) {
        throw new ConflictException('The Dock Assignment item is no longer failed.');
      }
      await manager.query(
        `INSERT INTO driver_print_attempts(
           id, item_id, attempt_number, attempt_kind, status,
           requested_at, idempotency_key, details, created_at
         ) VALUES ($1, $2, $3, 'RETRY', 'REQUESTED', $4, $5, $6::jsonb, $4)`,
        [
          randomUUID(),
          row.item_id,
          attemptNumber,
          now,
          idempotencyKey,
          JSON.stringify({ requestedFrom: 'GUARD_UI', itemType: 'DOCK_ASSIGNMENT' }),
        ],
      );
      await this.store.insertDriverEvent(manager, {
        eventType: 'DOCK_ASSIGNMENT_PRINT_RETRIED',
        actorType: 'SYSTEM',
        actorId: SYSTEM_GUARD_ACTOR,
        truckVisitId: Number(row.truck_visit_id),
        packageId,
        itemId: String(row.item_id),
        details: { attemptNumber, idempotencyKey, requestedFrom: 'GUARD_UI' },
      });
      await this.store.insertVisitEvent(
        manager,
        Number(row.truck_visit_id),
        'DOCK_ASSIGNMENT_PRINT_RETRIED',
        SYSTEM_GUARD_ACTOR,
        `Dock Assignment Slip retry ${attemptNumber} requested for package ${packageId}.`,
        now,
      );
      await this.store.refreshPackageStatus(manager, packageId);
      return this.store.summaryByPackageId(manager, packageId);
    });
  }
}
