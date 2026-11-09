import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'rxo_freight_visibility' })
@Index('ux_rxo_freight_visibility_shipment_direction', ['siteKey', 'shipmentId', 'direction'], { unique: true })
export class RxoFreightVisibility {
  @PrimaryGeneratedColumn({ type: 'int' }) id!: number;
  @Column({ name: 'site_key', type: 'varchar', length: 80 }) siteKey!: string;
  @Column({ name: 'shipment_id', type: 'varchar', length: 120 }) shipmentId!: string;
  @Column({ type: 'varchar', length: 20 }) direction!: 'INBOUND' | 'OUTBOUND';
  @Column({ type: 'varchar', length: 120, nullable: true }) status!: string | null;
  @Column({ name: 'eta_status', type: 'varchar', length: 120, nullable: true }) etaStatus!: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) mode!: string | null;
  @Column({ name: 'carrier_name', type: 'varchar', length: 300, nullable: true }) carrierName!: string | null;
  @Column({ name: 'first_stop_address', type: 'text', nullable: true }) firstStopAddress!: string | null;
  @Column({ name: 'last_stop_address', type: 'text', nullable: true }) lastStopAddress!: string | null;
  @Column({ name: 'pickup_estimated_arrival_raw', type: 'varchar', length: 200, nullable: true }) pickupEstimatedArrivalRaw!: string | null;
  @Column({ name: 'pickup_appointment_arrival_raw', type: 'varchar', length: 200, nullable: true }) pickupAppointmentArrivalRaw!: string | null;
  @Column({ name: 'delivery_estimated_arrival_raw', type: 'varchar', length: 200, nullable: true }) deliveryEstimatedArrivalRaw!: string | null;
  @Column({ name: 'delivery_appointment_arrival_raw', type: 'varchar', length: 200, nullable: true }) deliveryAppointmentArrivalRaw!: string | null;
  @Column({ name: 'plant_scheduled_at', type: 'timestamptz', nullable: true }) plantScheduledAt!: Date | null;
  @Column({ name: 'pro_number', type: 'varchar', length: 200, nullable: true }) proNumber!: string | null;
  @Column({ name: 'trailer_number', type: 'varchar', length: 200, nullable: true }) trailerNumber!: string | null;
  @Column({ name: 'source_batch_id', type: 'varchar', length: 80 }) sourceBatchId!: string;
  @Column({ name: 'visible_in_latest', type: 'boolean', default: true }) visibleInLatest!: boolean;
  @Column({ name: 'last_seen_at', type: 'timestamptz' }) lastSeenAt!: Date;
  @Column({ name: 'raw_row', type: 'jsonb' }) rawRow!: Record<string, unknown>;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
