import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'rxo_orders' })
@Index('ux_rxo_orders_order_direction', ['siteKey', 'orderNumber', 'direction'], { unique: true })
export class RxoOrder {
  @PrimaryGeneratedColumn({ type: 'int' }) id!: number;
  @Column({ name: 'site_key', type: 'varchar', length: 80 }) siteKey!: string;
  @Column({ name: 'order_number', type: 'varchar', length: 120 }) orderNumber!: string;
  @Column({ type: 'varchar', length: 20 }) direction!: 'INBOUND' | 'OUTBOUND';
  @Column({ name: 'shipment_id', type: 'varchar', length: 120, nullable: true }) shipmentId!: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) status!: string | null;
  @Column({ name: 'origin_name', type: 'varchar', length: 300, nullable: true }) originName!: string | null;
  @Column({ name: 'origin_address', type: 'text', nullable: true }) originAddress!: string | null;
  @Column({ name: 'destination_name', type: 'varchar', length: 300, nullable: true }) destinationName!: string | null;
  @Column({ name: 'destination_address', type: 'text', nullable: true }) destinationAddress!: string | null;
  @Column({ name: 'pickup_at', type: 'timestamptz', nullable: true }) pickupAt!: Date | null;
  @Column({ name: 'delivery_at', type: 'timestamptz', nullable: true }) deliveryAt!: Date | null;
  @Column({ name: 'customer_order_number', type: 'varchar', length: 200, nullable: true }) customerOrderNumber!: string | null;
  @Column({ name: 'tracking_number', type: 'varchar', length: 200, nullable: true }) trackingNumber!: string | null;
  @Column({ name: 'source_batch_id', type: 'varchar', length: 80 }) sourceBatchId!: string;
  @Column({ name: 'visible_in_latest', type: 'boolean', default: true }) visibleInLatest!: boolean;
  @Column({ name: 'last_seen_at', type: 'timestamptz' }) lastSeenAt!: Date;
  @Column({ name: 'raw_row', type: 'jsonb' }) rawRow!: Record<string, unknown>;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
