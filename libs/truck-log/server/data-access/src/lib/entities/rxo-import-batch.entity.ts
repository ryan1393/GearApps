import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'rxo_import_batches' })
@Index('ux_rxo_import_batches_site_batch', ['siteKey', 'sourceBatchId'], { unique: true })
export class RxoImportBatch {
  @PrimaryGeneratedColumn({ type: 'int' }) id!: number;
  @Column({ name: 'source_batch_id', type: 'varchar', length: 80 }) sourceBatchId!: string;
  @Column({ name: 'source_manifest_version', type: 'varchar', length: 40, nullable: true }) sourceManifestVersion!: string | null;
  @Column({ name: 'source_completed_at', type: 'timestamptz', nullable: true }) sourceCompletedAt!: Date | null;
  @Column({ name: 'site_key', type: 'varchar', length: 80 }) siteKey!: string;
  @Column({ name: 'site_name', type: 'varchar', length: 200 }) siteName!: string;
  @Column({ type: 'varchar', length: 30 }) status!: 'IMPORTING' | 'COMPLETE' | 'FAILED';
  @Column({ name: 'dataset_count', type: 'int', default: 0 }) datasetCount!: number;
  @Column({ name: 'order_rows', type: 'int', default: 0 }) orderRows!: number;
  @Column({ name: 'shipment_rows', type: 'int', default: 0 }) shipmentRows!: number;
  @Column({ name: 'freight_rows', type: 'int', default: 0 }) freightRows!: number;
  @Column({ name: 'linked_order_rows', type: 'int', default: 0 }) linkedOrderRows!: number;
  @Column({ name: 'scheduled_load_rows', type: 'int', default: 0 }) scheduledLoadRows!: number;
  @Column({ name: 'deactivated_scheduled_load_rows', type: 'int', default: 0 }) deactivatedScheduledLoadRows!: number;
  @Column({ name: 'dataset_summary', type: 'jsonb', default: () => "'[]'::jsonb" }) datasetSummary!: Array<Record<string, unknown>>;
  @Column({ name: 'boundary_sha256', type: 'varchar', length: 64, nullable: true }) boundarySha256!: string | null;
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage!: string | null;
  @Column({ name: 'imported_at', type: 'timestamptz', nullable: true }) importedAt!: Date | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
