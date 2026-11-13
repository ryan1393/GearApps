import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TruckVisit } from './truck-visit.entity';

@Entity({ name: 'visit_events' })
export class VisitEvent {
  @PrimaryGeneratedColumn({ type: 'int' }) id!: number;
  @Column({ name: 'truck_visit_id', type: 'int' }) truckVisitId!: number;
  @Column({ name: 'event_type', type: 'varchar', length: 60 }) eventType!: string;
  @Column({ name: 'occurred_at', type: 'timestamptz' }) occurredAt!: Date;
  @Column({ type: 'varchar', length: 120, nullable: true }) actor!: string | null;
  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @ManyToOne(() => TruckVisit, (visit) => visit.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'truck_visit_id' }) visit!: TruckVisit;
}
