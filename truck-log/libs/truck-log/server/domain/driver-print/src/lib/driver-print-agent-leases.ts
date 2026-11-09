import { returnedRows } from '@truck-log/server/data-access';
import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DriverPrintStore } from './driver-print.store';
import { EXPIRED_LEASE_ERROR } from './driver-print.types';

/**
 * Lease failure paths for legacy Print Agent jobs: expire ambiguous leases and
 * fail a leased item from the server. Failure is explicit and audited; nothing
 * here requeues or retries a physical print.
 * A plain class constructed by DriverPrintAgentOperations (not a Nest provider).
 */
export class DriverPrintAgentLeases {
  constructor(
    private readonly dataSource: DataSource,
    private readonly store: DriverPrintStore,
  ) {}

  async expireLeases(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const expired = await manager.query(
        `SELECT item.id AS item_id, item.package_id, item.status, item.attempt_count,
                item.assigned_agent_id, item.route, item.printer,
                item.visit_document_id, package.truck_visit_id,
                package.request_kind
           FROM driver_print_items item
           JOIN driver_print_packages package ON package.id = item.package_id
          WHERE item.item_type = 'RXO_DOCUMENT'
            AND item.status = 'LEASED'
            AND item.lease_expires_at <= NOW()
          ORDER BY item.lease_expires_at, item.id
          LIMIT 100
          FOR UPDATE OF item SKIP LOCKED`,
      );
      const now = new Date();
      for (const row of expired) {
        await this.failLockedLeasedItem(
          manager,
          row,
          EXPIRED_LEASE_ERROR,
          'SYSTEM',
          'TRUCK_LOG_LEASE_MONITOR',
          now,
        );
      }
    });
  }

  async failLeasedItemFromServer(
    itemId: string,
    agentId: string,
    error: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT item.id AS item_id, item.package_id, item.status, item.attempt_count,
                item.assigned_agent_id, item.route, item.printer,
                item.visit_document_id, package.truck_visit_id,
                package.request_kind
           FROM driver_print_items item
           JOIN driver_print_packages package ON package.id = item.package_id
          WHERE item.id = $1 AND item.item_type = 'RXO_DOCUMENT'
          FOR UPDATE OF item`,
        [itemId],
      );
      const row = rows[0];
      if (row?.status === 'LEASED' && row.assigned_agent_id === agentId) {
        await this.failLockedLeasedItem(
          manager,
          row,
          error,
          'SYSTEM',
          'TRUCK_LOG_DOCUMENT_STORAGE',
          new Date(),
        );
      }
    });
  }

  async failLockedLeasedItem(
    manager: EntityManager,
    row: Record<string, unknown>,
    error: string,
    actorType: 'HUMAN' | 'PRINT_AGENT' | 'SYSTEM',
    actorId: string,
    now: Date,
  ): Promise<void> {
    const updated = returnedRows(await manager.query(
      `UPDATE driver_print_items
          SET status = 'FAILED', last_error = $2,
              printed_at = NULL, updated_at = $3
        WHERE id = $1 AND status = 'LEASED'
        RETURNING id`,
      [row.item_id, error, now],
    ));
    if (!updated[0]) return;
    const attempt = returnedRows(await manager.query(
      `UPDATE driver_print_attempts
          SET status = 'FAILED', completed_at = $3, error_message = $4,
              details = details || $5::jsonb
        WHERE item_id = $1 AND attempt_number = $2 AND status = 'LEASED'
        RETURNING id`,
      [
        row.item_id,
        Number(row.attempt_count),
        now,
        error,
        JSON.stringify({ outcomeAmbiguous: error === EXPIRED_LEASE_ERROR }),
      ],
    ));
    if (!attempt[0]) {
      throw new ConflictException('The leased Print Agent attempt is missing or final.');
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
      actorType,
      actorId,
      truckVisitId: Number(row.truck_visit_id),
      packageId: String(row.package_id),
      itemId: String(row.item_id),
      document,
      route: row.route === null ? null : String(row.route),
      printer: row.printer === null ? null : String(row.printer),
      error,
      details: {
        attemptNumber: Number(row.attempt_count),
        outcomeAmbiguous: error === EXPIRED_LEASE_ERROR,
        retryRequired: true,
      },
    });
    await this.store.insertVisitEvent(
      manager,
      Number(row.truck_visit_id),
      'RXO_DOCUMENT_PRINT_FAILED',
      actorId,
      error,
      now,
    );
    await this.store.refreshPackageStatus(manager, String(row.package_id));
  }
}
