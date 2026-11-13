import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'rxo_order_shipment_links' })
@Index('ux_rxo_order_shipment_links', ['siteKey', 'orderNumber', 'shipmentId', 'direction'], { unique: true })
export class RxoOrderShipmentLink {
  @PrimaryGeneratedColumn({ type: 'int' }) id!: number;
  @Column({ name: 'site_key', type: 'varchar', length: 80 }) siteKey!: string;
  @Column({ name: 'order_number', type: 'varchar', length: 120 }) orderNumber!: string;
  @Column({ name: 'shipment_id', type: 'varchar', length: 120 }) shipmentId!: string;
  @Column({ type: 'varchar', length: 20 }) direction!: 'INBOUND' | 'OUTBOUND';
  @Column({ name: 'source_batch_id', type: 'varchar', length: 80 }) sourceBatchId!: string;
  @Column({ name: 'visible_in_latest', type: 'boolean', default: true }) visibleInLatest!: boolean;
  @Column({ name: 'last_seen_at', type: 'timestamptz' }) lastSeenAt!: Date;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
