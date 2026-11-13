import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { withExpediteDriverDocumentState } from './rxo-expedite-driver-documents';
import { expediteDirection } from './rxo-expedite-identity';
import {
  EXPEDITE_CHECK_IN_SITE,
  rxoLoadAvailableSql,
} from '@truck-log/server/domain/rxo';

/*
 * PostgreSQL mirror of verified RXO Expedite batches: import bookkeeping,
 * batch/shipment reads, driver-document state and check-in availability.
 * PostgreSQL is a mirror for querying and check-in, never the source of RXO
 * login state.
 */

/** A plain class constructed by RxoExpediteService (not a Nest provider). */
export class RxoExpediteDatabaseMirror {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async databaseSchemaReady(): Promise<boolean> {
    try {
      const rows = await this.dataSource.query(
        `SELECT to_regclass('public.rxo_expedite_import_batches') AS batches,
                to_regclass('public.rxo_expedite_shipment_snapshots') AS shipments`,
      ) as Array<{ batches: string | null; shipments: string | null }>;
      return !!rows[0]?.batches && !!rows[0]?.shipments;
    } catch {
      return false;
    }
  }

  snapshotHash(snapshot: {
    sourceBatchId: string;
    completedAt: string;
    shipments: Array<Record<string, unknown>>;
  }) {
    const shipments = [...snapshot.shipments]
      .sort((a, b) => String(a.shipmentId ?? '').localeCompare(String(b.shipmentId ?? '')));
    return createHash('sha256').update(JSON.stringify({
      sourceBatchId: snapshot.sourceBatchId,
      completedAt: snapshot.completedAt,
      shipments,
    })).digest('hex');
  }

  async withDriverDocumentState(rows: Array<Record<string, any>>) {
    return withExpediteDriverDocumentState(this.dataSource, this.config, rows);
  }

  async batchAlreadyImported(sourceBatchId: string): Promise<boolean> {
    if (!await this.databaseSchemaReady()) return false;
    const rows = await this.dataSource.query(
      `SELECT 1
         FROM rxo_expedite_import_batches
        WHERE source_batch_id=$1 AND status='COMPLETE'
        LIMIT 1`,
      [sourceBatchId],
    ) as Array<Record<string, unknown>>;
    return rows.length > 0;
  }

  async recordImportFailure(
    sourceBatchId: string,
    sourceCompletedAt: string,
    sourceSha256: string,
    rowCount: number,
    message: string,
  ) {
    if (!await this.databaseSchemaReady()) return;
    try {
      await this.dataSource.query(
        `INSERT INTO rxo_expedite_import_batches(
           source_batch_id,source_completed_at,source_sha256,status,row_count,
           linked_order_rows,error_message,imported_at,created_at,updated_at
         ) VALUES($1,$2,$3,'FAILED',$4,0,$5,NULL,NOW(),NOW())
         ON CONFLICT(source_batch_id) DO UPDATE SET
           status=CASE WHEN rxo_expedite_import_batches.status='COMPLETE'
                       THEN rxo_expedite_import_batches.status ELSE 'FAILED' END,
           error_message=CASE WHEN rxo_expedite_import_batches.status='COMPLETE'
                              THEN rxo_expedite_import_batches.error_message ELSE EXCLUDED.error_message END,
           updated_at=NOW()
         WHERE rxo_expedite_import_batches.status <> 'COMPLETE'`,
        [sourceBatchId, sourceCompletedAt, sourceSha256, rowCount, message.slice(0, 8000)],
      );
    } catch {
      // Preserve the original import failure.
    }
  }

  async importSnapshot(snapshot: {
    contractVersion: 1;
    source: 'RXO_EXPEDITE';
    sourceBatchId: string;
    completedAt: string;
    rowCount: number;
    shipments: Array<Record<string, any>>;
  }) {
    if (!await this.databaseSchemaReady()) return null;
    const sourceSha256 = this.snapshotHash(snapshot);
    const prior = await this.dataSource.query(
      `SELECT status,source_sha256,imported_at,row_count,linked_order_rows
         FROM rxo_expedite_import_batches
        WHERE source_batch_id=$1`,
      [snapshot.sourceBatchId],
    ) as Array<Record<string, any>>;
    if (prior[0]?.source_sha256 && String(prior[0].source_sha256).toLowerCase() !== sourceSha256) {
      throw new ServiceUnavailableException('The verified Expedite batch was already recorded with different contents.');
    }
    if (prior[0]?.status === 'COMPLETE') {
      return { alreadyImported: true, sourceBatchId: snapshot.sourceBatchId, ...prior[0] };
    }

    try {
      return await this.dataSource.transaction(async (manager: EntityManager) => {
        await manager.query(`SET LOCAL lock_timeout='15s'`);
        await manager.query(`SET LOCAL statement_timeout='90s'`);
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext('truck-log-rxo-expedite-ingestion'))`);

        const concurrent = await manager.query(
          `SELECT status,source_sha256,imported_at,row_count,linked_order_rows
             FROM rxo_expedite_import_batches
            WHERE source_batch_id=$1`,
          [snapshot.sourceBatchId],
        ) as Array<Record<string, any>>;
        if (concurrent[0]?.source_sha256 && String(concurrent[0].source_sha256).toLowerCase() !== sourceSha256) {
          throw new ServiceUnavailableException('The verified Expedite batch was already recorded with different contents.');
        }
        if (concurrent[0]?.status === 'COMPLETE') {
          return { alreadyImported: true, sourceBatchId: snapshot.sourceBatchId, ...concurrent[0] };
        }

        await manager.query(
          `INSERT INTO rxo_expedite_import_batches(
             source_batch_id,source_completed_at,source_sha256,status,row_count,
             linked_order_rows,error_message,imported_at,created_at,updated_at
           ) VALUES($1,$2,$3,'IMPORTING',$4,0,NULL,NULL,NOW(),NOW())
           ON CONFLICT(source_batch_id) DO UPDATE SET
             source_completed_at=EXCLUDED.source_completed_at,
             source_sha256=EXCLUDED.source_sha256,
             status='IMPORTING',row_count=EXCLUDED.row_count,
             linked_order_rows=0,error_message=NULL,imported_at=NULL,updated_at=NOW()`,
          [snapshot.sourceBatchId, snapshot.completedAt, sourceSha256, snapshot.rowCount],
        );

        await manager.query(
          `DELETE FROM rxo_expedite_shipment_snapshots WHERE source_batch_id=$1`,
          [snapshot.sourceBatchId],
        );

        const rows = snapshot.shipments.map((row) => ({
          shipment_id: row.shipmentId,
          direction: expediteDirection(row),
          critical: row.critical,
          auth_code: row.authCode,
          origin_name: row.originName,
          origin: row.origin,
          destination: row.destination,
          scac: row.scac,
          commodity: row.commodity,
          mode: row.mode,
          current_location: row.currentLocation,
          next_stop: row.nextStop,
          eta_next_stop: row.etaNextStop,
          eta_status: row.etaStatus,
          raw_row: row,
        }));

        if (rows.length) {
          await manager.query(
            `INSERT INTO rxo_expedite_shipment_snapshots(
               source_batch_id,shipment_id,direction,critical,auth_code,origin_name,origin,
               destination,scac,commodity,mode,current_location,next_stop,eta_next_stop,
               eta_status,raw_row,created_at
             )
             SELECT $1,
                    record.shipment_id,
                    record.direction,
                    record.critical,
                    record.auth_code,
                    record.origin_name,
                    record.origin,
                    record.destination,
                    record.scac,
                    record.commodity,
                    record.mode,
                    record.current_location,
                    record.next_stop,
                    record.eta_next_stop,
                    record.eta_status,
                    record.raw_row,
                    NOW()
               FROM jsonb_to_recordset($2::jsonb) AS record(
                 shipment_id text,
                 direction text,
                 critical boolean,
                 auth_code text,
                 origin_name text,
                 origin text,
                 destination text,
                 scac text,
                 commodity text,
                 mode text,
                 current_location text,
                 next_stop text,
                 eta_next_stop jsonb,
                 eta_status text,
                 raw_row jsonb
               )`,
            [snapshot.sourceBatchId, JSON.stringify(rows)],
          );
        }

        const inserted = await manager.query(
          `SELECT COUNT(*)::int AS count
             FROM rxo_expedite_shipment_snapshots
            WHERE source_batch_id=$1`,
          [snapshot.sourceBatchId],
        ) as Array<{ count: number }>;
        if (Number(inserted[0]?.count ?? -1) !== snapshot.rowCount) {
          throw new Error(`Expedite PostgreSQL row-count verification failed: expected ${snapshot.rowCount}, found ${inserted[0]?.count ?? 'unknown'}.`);
        }

        const shipmentIds = snapshot.shipments.map((row) => String(row.shipmentId));
        const linked = shipmentIds.length
          ? await manager.query(
              `SELECT COUNT(DISTINCT (link.site_key,link.order_number,link.direction))::int AS count
                 FROM rxo_order_shipment_links link
                WHERE link.visible_in_latest=TRUE
                  AND link.shipment_id=ANY($1::text[])`,
              [shipmentIds],
            ) as Array<{ count: number }>
          : [{ count: 0 }];
        const linkedOrderRows = Number(linked[0]?.count ?? 0);

        await manager.query(
          `UPDATE rxo_expedite_import_batches
              SET status='COMPLETE',row_count=$2,linked_order_rows=$3,error_message=NULL,
                  imported_at=NOW(),updated_at=NOW()
            WHERE source_batch_id=$1`,
          [snapshot.sourceBatchId, snapshot.rowCount, linkedOrderRows],
        );

        return {
          alreadyImported: false,
          sourceBatchId: snapshot.sourceBatchId,
          rowCount: snapshot.rowCount,
          linkedOrderRows,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordImportFailure(
        snapshot.sourceBatchId,
        snapshot.completedAt,
        sourceSha256,
        snapshot.rowCount,
        message,
      );
      throw error;
    }
  }

  async databaseStatus(latestVerifiedBatch: string | null) {
    if (!await this.databaseSchemaReady()) {
      return {
        enabled: false,
        state: 'MIGRATION_REQUIRED',
        latestVerifiedBatch,
        lastImportedBatch: null,
        importedAt: null,
        sourceCompletedAt: null,
        rowCount: null,
        linkedOrders: null,
        pendingBatch: latestVerifiedBatch,
        errorMessage: null,
      };
    }

    const complete = await this.dataSource.query(
      `SELECT source_batch_id,source_completed_at,row_count,linked_order_rows,imported_at
         FROM rxo_expedite_import_batches
        WHERE status='COMPLETE'
        ORDER BY imported_at DESC NULLS LAST,updated_at DESC
        LIMIT 1`,
    ) as Array<Record<string, any>>;

    const current = latestVerifiedBatch
      ? await this.dataSource.query(
          `SELECT source_batch_id,status,source_completed_at,row_count,linked_order_rows,
                  imported_at,error_message,updated_at
             FROM rxo_expedite_import_batches
            WHERE source_batch_id=$1
            LIMIT 1`,
          [latestVerifiedBatch],
        ) as Array<Record<string, any>>
      : [];

    const latestComplete = complete[0] ?? null;
    const latestCurrent = current[0] ?? null;
    let state = 'WAITING';
    if (latestVerifiedBatch) {
      if (latestCurrent?.status === 'COMPLETE') state = 'COMPLETE';
      else if (latestCurrent?.status === 'FAILED') state = 'FAILED';
      else if (latestCurrent?.status === 'IMPORTING') state = 'IMPORTING';
      else state = 'PENDING';
    } else if (latestComplete) {
      state = 'COMPLETE';
    }

    return {
      enabled: true,
      state,
      latestVerifiedBatch,
      lastImportedBatch: latestComplete?.source_batch_id ?? null,
      importedAt: latestComplete?.imported_at ? new Date(latestComplete.imported_at).toISOString() : null,
      sourceCompletedAt: latestComplete?.source_completed_at ? new Date(latestComplete.source_completed_at).toISOString() : null,
      rowCount: latestComplete == null ? null : Number(latestComplete.row_count ?? 0),
      linkedOrders: latestComplete == null ? null : Number(latestComplete.linked_order_rows ?? 0),
      pendingBatch: latestVerifiedBatch && latestComplete?.source_batch_id !== latestVerifiedBatch ? latestVerifiedBatch : null,
      errorMessage: typeof latestCurrent?.error_message === 'string' ? latestCurrent.error_message : null,
    };
  }

  async databaseShipments(sourceBatchId: string) {
    const batchRows = await this.dataSource.query(
      `SELECT source_batch_id,source_completed_at,row_count,imported_at
         FROM rxo_expedite_import_batches
        WHERE source_batch_id=$1 AND status='COMPLETE'
        LIMIT 1`,
      [sourceBatchId],
    ) as Array<Record<string, any>>;
    if (!batchRows.length) return null;

    const rows = await this.dataSource.query(
      `SELECT shipment_id,critical,auth_code,origin_name,origin,destination,scac,commodity,
              mode,current_location,next_stop,eta_next_stop,eta_status
         FROM rxo_expedite_shipment_snapshots
        WHERE source_batch_id=$1
        ORDER BY shipment_id`,
      [sourceBatchId],
    ) as Array<Record<string, any>>;
    const expectedRows = Number(batchRows[0].row_count ?? -1);
    if (!Number.isSafeInteger(expectedRows) || expectedRows < 0 || rows.length !== expectedRows) return null;

    return {
      contractVersion: 1 as const,
      source: 'RXO_EXPEDITE' as const,
      sourceBatchId,
      completedAt: new Date(batchRows[0].source_completed_at).toISOString(),
      rowCount: rows.length,
      storage: 'POSTGRESQL' as const,
      databaseImportedAt: batchRows[0].imported_at ? new Date(batchRows[0].imported_at).toISOString() : null,
      shipments: await this.withDriverDocumentState(rows.map((row) => ({
        shipmentId: String(row.shipment_id),
        critical: row.critical == null ? null : row.critical === true,
        authCode: row.auth_code ?? null,
        originName: row.origin_name ?? null,
        origin: row.origin ?? null,
        destination: row.destination ?? null,
        scac: row.scac ?? null,
        commodity: row.commodity ?? null,
        mode: row.mode ?? null,
        currentLocation: row.current_location ?? null,
        nextStop: row.next_stop ?? null,
        etaNextStop: row.eta_next_stop ?? null,
        etaStatus: row.eta_status ?? null,
      }))),
    };
  }

  async availableShipmentResponse<T extends { shipments: Array<Record<string, any>>; rowCount: number }>(snapshot: T) {
    if (!snapshot.shipments.length) return { ...snapshot, importedRowCount: snapshot.rowCount };
    const requested = snapshot.shipments.map((row) => ({
      shipment_id: String(row.shipmentId).trim().toUpperCase(),
      direction: expediteDirection(row),
    }));
    const availableRows = await this.dataSource.query(
      `SELECT requested.shipment_id, requested.direction
       FROM jsonb_to_recordset($1::jsonb) AS requested(shipment_id text, direction text)
       WHERE ${rxoLoadAvailableSql('$2::text', 'requested.shipment_id', 'requested.direction')}`,
      [JSON.stringify(requested), EXPEDITE_CHECK_IN_SITE],
    ) as Array<{ shipment_id: string; direction: string }>;
    const keys = new Set(availableRows.map((row) => `${row.shipment_id}|${row.direction}`));
    const shipments = snapshot.shipments.filter((row) => keys.has(
      `${String(row.shipmentId).trim().toUpperCase()}|${expediteDirection(row)}`,
    ));
    return { ...snapshot, importedRowCount: snapshot.rowCount, rowCount: shipments.length, shipments };
  }
}
