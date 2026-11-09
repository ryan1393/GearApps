import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'rxo_shipments' })
@Index('ux_rxo_shipments_shipment_direction', ['siteKey', 'shipmentId', 'direction'], { unique: true })
export class RxoShipment {
  @PrimaryGeneratedColumn({ type: 'int' }) id!: number;
  @Column({ name: 'site_key', type: 'varchar', length: 80 }) siteKey!: string;
  @Column({ name: 'shipment_id', type: 'varchar', length: 120 }) shipmentId!: string;
  @Column({ type: 'varchar', length: 20 }) direction!: 'INBOUND' | 'OUTBOUND';
  @Column({ type: 'varchar', length: 120, nullable: true }) status!: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) mode!: string | null;
  @Column({ name: 'carrier_name', type: 'varchar', length: 300, nullable: true }) carrierName!: string | null;
  @Column({ name: 'order_count', type: 'int', nullable: true }) orderCount!: number | null;
  @Column({ name: 'stop_count', type: 'int', nullable: true }) stopCount!: number | null;
  @Column({ name: 'first_stop_name', type: 'varchar', length: 300, nullable: true }) firstStopName!: string | null;
  @Column({ name: 'first_stop_address', type: 'text', nullable: true }) firstStopAddress!: string | null;
  @Column({ name: 'last_stop_name', type: 'varchar', length: 300, nullable: true }) lastStopName!: string | null;
  @Column({ name: 'last_stop_address', type: 'text', nullable: true }) lastStopAddress!: string | null;
  @Column({ name: 'plant_scheduled_at', type: 'timestamptz', nullable: true }) plantScheduledAt!: Date | null;
  @Column({ name: 'pro_number', type: 'varchar', length: 200, nullable: true }) proNumber!: string | null;
  @Column({ name: 'trailer_number', type: 'varchar', length: 200, nullable: true }) trailerNumber!: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) pieces!: string | null;
  @Column({ name: 'total_weight', type: 'varchar', length: 120, nullable: true }) totalWeight!: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) volume!: string | null;
  @Column({ type: 'boolean', nullable: true }) hazardous!: boolean | null;
  @Column({ name: 'source_batch_id', type: 'varchar', length: 80 }) sourceBatchId!: string;
  @Column({ name: 'visible_in_latest', type: 'boolean', default: true }) visibleInLatest!: boolean;
  @Column({ name: 'last_seen_at', type: 'timestamptz' }) lastSeenAt!: Date;
  @Column({ name: 'raw_row', type: 'jsonb' }) rawRow!: Record<string, unknown>;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
