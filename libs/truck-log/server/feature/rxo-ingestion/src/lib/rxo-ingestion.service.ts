import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { rxoImportHealth } from './rxo-import-health';
import { RxoSnapshotReader, type Direction } from './rxo-snapshot-reader';
import { RxoSnapshotWriter } from './rxo-snapshot-writer';
import { RxoIngestionQueries } from './rxo-ingestion.queries';
import { rxoBoundaryPath, rxoLatestRoot, rxoPlantTimeZone } from './rxo-ingestion-paths';

/**
 * RXO ingestion: importLatest() orchestrates one atomic import of the verified
 * latest snapshot (reader -> writer inside one locked transaction); read
 * endpoints are delegated to RxoIngestionQueries.
 */
@Injectable()
export class RxoIngestionService {
  private readonly snapshotReader: RxoSnapshotReader;
  private readonly writer: RxoSnapshotWriter;
  private readonly queries: RxoIngestionQueries;

  constructor(private readonly dataSource: DataSource, private readonly config: ConfigService) {
    this.snapshotReader = new RxoSnapshotReader(this.latestRoot(), this.plantTimeZone());
    this.writer = new RxoSnapshotWriter(this.snapshotReader);
    this.queries = new RxoIngestionQueries(this.dataSource, this.config, this.snapshotReader);
  }

  private latestRoot() {
    return rxoLatestRoot(this.config);
  }

  private plantTimeZone() {
    return rxoPlantTimeZone(this.config);
  }

  private boundaryPath() {
    return rxoBoundaryPath(this.config);
  }

  async status() {
    return this.queries.status();
  }

  /** On-demand, read-only trace. Never imports, rescans, changes filters, or returns order/driver identifiers. */
  async ordersDiagnostics(site?: string) {
    return this.queries.ordersDiagnostics(site);
  }

  async listDataPage(
    kind?: string,
    site?: string,
    direction?: string,
    q?: string,
    page = 1,
    pageSize = 100,
  ) {
    return this.queries.listDataPage(kind, site, direction, q, page, pageSize);
  }

  async listShipments(site?: string, direction?: string, limit = 200) {
    return this.queries.listShipments(site, direction, limit);
  }

  async listOrders(site?: string, shipmentId?: string, direction?: string, limit = 500) {
    return this.queries.listOrders(site, shipmentId, direction, limit);
  }

  async lookupShipment(shipmentId?: string, site?: string) {
    return this.queries.lookupShipment(shipmentId, site);
  }

  async importLatest() {
    const boundary = this.snapshotReader.readBoundary();
    const batchId = boundary.sourceBatchId.trim();
    const boundaryHash = this.snapshotReader.boundarySourceHash(boundary);
    const completed = boundary.sourceCompletedAt && !Number.isNaN(new Date(boundary.sourceCompletedAt).getTime())
      ? new Date(boundary.sourceCompletedAt).toISOString() : null;
    const siteKey = boundary.site!.key!.trim().toLowerCase();
    const siteName = boundary.site!.name!.trim();

    const prior = await this.dataSource.query(
      `SELECT source_batch_id,status,boundary_sha256,order_rows,shipment_rows,freight_rows,
              linked_order_rows,scheduled_load_rows,deactivated_scheduled_load_rows,imported_at,dataset_summary
         FROM rxo_import_batches WHERE site_key=$1 AND source_batch_id=$2 AND status='COMPLETE'`,
      [siteKey,batchId],
    );
    if (prior.length) {
      if (prior[0].boundary_sha256 && String(prior[0].boundary_sha256).toLowerCase() !== boundaryHash.toLowerCase()) {
        throw new BadRequestException(`RXO batch ${batchId} was already imported with a different source-boundary digest.`);
      }
      const health = rxoImportHealth(prior[0]);
      return { alreadyImported: true, batchId, ...prior[0], datasets: health.datasets, warnings: health.warnings, partial: health.partial, importHealth: health };
    }

    try {
      // Parse and validate all six XLSX datasets before opening the database
      // transaction. The database lock is held only for the atomic write phase.
      const snapshot = await this.snapshotReader.parseSnapshot(boundary);

      return await this.dataSource.transaction(async (manager) => {
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext('truck-log-rxo-ingestion'))`);

        const concurrent = await manager.query(
          `SELECT source_batch_id,status,boundary_sha256,order_rows,shipment_rows,freight_rows,
                  linked_order_rows,scheduled_load_rows,deactivated_scheduled_load_rows,imported_at,dataset_summary
             FROM rxo_import_batches WHERE site_key=$1 AND source_batch_id=$2 AND status='COMPLETE'`,
          [siteKey,batchId],
        );
        if (concurrent.length) {
          if (concurrent[0].boundary_sha256 && String(concurrent[0].boundary_sha256).toLowerCase() !== boundaryHash.toLowerCase()) {
            throw new BadRequestException(`RXO batch ${batchId} was already imported with a different source-boundary digest.`);
          }
          const health = rxoImportHealth(concurrent[0]);
          return { alreadyImported: true, batchId, ...concurrent[0], datasets: health.datasets, warnings: health.warnings, partial: health.partial, importHealth: health };
        }

        await manager.query(
          `INSERT INTO rxo_import_batches(
             source_batch_id,source_manifest_version,source_completed_at,site_key,site_name,
             status,dataset_count,boundary_sha256,error_message,created_at,updated_at
           ) VALUES($1,$2,$3,$4,$5,'IMPORTING',$6,$7,NULL,NOW(),NOW())
           ON CONFLICT(site_key,source_batch_id) DO UPDATE SET
             source_manifest_version=EXCLUDED.source_manifest_version,
             source_completed_at=EXCLUDED.source_completed_at,
             site_key=EXCLUDED.site_key,site_name=EXCLUDED.site_name,
             status='IMPORTING',dataset_count=EXCLUDED.dataset_count,
             boundary_sha256=EXCLUDED.boundary_sha256,error_message=NULL,updated_at=NOW()`,
          [batchId,boundary.sourceManifestVersion ?? null,completed,siteKey,siteName,boundary.datasetCount,boundaryHash],
        );

        const { orders, shipments, freight, datasets, warnings, completeDirections, cancelledOrderKeys } = snapshot;

        await this.writer.upsertOrders(manager, orders, batchId, siteKey, completeDirections.orders);
        await this.writer.upsertShipments(manager, shipments, batchId, siteKey, completeDirections.shipments);
        await this.writer.upsertFreight(manager, freight, batchId, siteKey, completeDirections['freight-on-the-move']);

        const linkRefreshDirections = new Set<Direction>([
          ...completeDirections.orders,
          ...completeDirections.shipments,
        ]);
        const linkedOrderRows = await this.writer.syncLinks(
          manager, orders, shipments, batchId, siteKey, linkRefreshDirections, cancelledOrderKeys,
        );
        const schedule = await this.writer.syncScheduledLoads(manager, orders, shipments, freight, batchId, siteKey);

        const summary = {
          orderRows: orders.length,
          shipmentRows: shipments.length,
          freightRows: freight.length,
          linkedOrderRows,
          scheduledLoadRows: schedule.scheduledLoadRows,
          deactivatedScheduledLoadRows: schedule.deactivatedScheduledLoadRows,
        };

        await manager.query(
          `UPDATE rxo_import_batches
              SET status='COMPLETE',order_rows=$3,shipment_rows=$4,freight_rows=$5,
                  linked_order_rows=$6,scheduled_load_rows=$7,deactivated_scheduled_load_rows=$8,
                  dataset_summary=$9::jsonb,imported_at=NOW(),error_message=NULL,updated_at=NOW()
            WHERE site_key=$1 AND source_batch_id=$2`,
          [siteKey,batchId,summary.orderRows,summary.shipmentRows,summary.freightRows,summary.linkedOrderRows,
           summary.scheduledLoadRows,summary.deactivatedScheduledLoadRows,JSON.stringify(datasets)],
        );

        return {
          alreadyImported: false,
          batchId,
          sourceCompletedAt: boundary.sourceCompletedAt ?? null,
          site: boundary.site,
          datasets,
          warnings,
          partial: warnings.length > 0,
          importHealth: rxoImportHealth({ status: 'COMPLETE', source_batch_id: batchId, dataset_summary: datasets }),
          ...summary,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.dataSource.query(
          `INSERT INTO rxo_import_batches(
             source_batch_id,source_manifest_version,source_completed_at,site_key,site_name,
             status,dataset_count,boundary_sha256,error_message,created_at,updated_at
           ) VALUES($1,$2,$3,$4,$5,'FAILED',$6,$7,$8,NOW(),NOW())
           ON CONFLICT(site_key,source_batch_id) DO UPDATE SET
             status='FAILED',boundary_sha256=EXCLUDED.boundary_sha256,error_message=EXCLUDED.error_message,updated_at=NOW()
           WHERE rxo_import_batches.status <> 'COMPLETE'`,
          [batchId,boundary.sourceManifestVersion ?? null,completed,siteKey,siteName,boundary.datasetCount,boundaryHash,message.slice(0, 8000)],
        );
      } catch {
        // Preserve the original import error even if failure-audit recording is unavailable.
      }
      throw error;
    }
  }

}
