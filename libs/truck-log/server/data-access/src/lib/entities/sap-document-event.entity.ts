import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TruckVisit } from './truck-visit.entity';
import { VisitDocument } from './visit-document.entity';

@Entity({ name: 'sap_document_events' })
@Check('ck_sap_document_events_event_type', `NULLIF(BTRIM("event_type"), '') IS NOT NULL`)
@Check('ck_sap_document_events_details', `jsonb_typeof("details") = 'object'`)
@Index('ix_sap_document_events_document_time', { synchronize: false })
@Index('ix_sap_document_events_from_visit_time', { synchronize: false })
@Index('ix_sap_document_events_to_visit_time', { synchronize: false })
export class SapDocumentEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: string;
  @Column({ name: 'visit_document_id', type: 'int' }) visitDocumentId!: number;
  @Column({ name: 'event_type', type: 'varchar', length: 60 }) eventType!: string;
  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'NOW()' }) occurredAt!: Date;
  @Column({ name: 'actor_type', type: 'varchar', length: 40, nullable: true }) actorType!: string | null;
  @Column({ name: 'actor_id', type: 'varchar', length: 120, nullable: true }) actorId!: string | null;
  @Column({ name: 'from_visit_id', type: 'int', nullable: true }) fromVisitId!: number | null;
  @Column({ name: 'to_visit_id', type: 'int', nullable: true }) toVisitId!: number | null;
  @Column({ type: 'text', nullable: true }) reason!: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) details!: Record<string, unknown>;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }) createdAt!: Date;

  @ManyToOne(() => VisitDocument, (document) => document.sapEvents, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'visit_document_id',
    foreignKeyConstraintName: 'fk_sap_document_events_document',
  })
  visitDocument!: VisitDocument;

  @ManyToOne(() => TruckVisit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'from_visit_id',
    foreignKeyConstraintName: 'fk_sap_document_events_from_visit',
  })
  fromVisit!: TruckVisit | null;

  @ManyToOne(() => TruckVisit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'to_visit_id',
    foreignKeyConstraintName: 'fk_sap_document_events_to_visit',
  })
  toVisit!: TruckVisit | null;
}
