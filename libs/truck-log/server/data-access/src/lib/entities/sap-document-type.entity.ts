import { Check, Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { VisitDocument } from './visit-document.entity';

@Entity({ name: 'sap_document_types' })
@Check('ck_sap_document_types_code', `"code" ~ '^[A-Z][A-Z0-9_]*$'`)
@Check(
  'ck_sap_document_types_positive_markers',
  `jsonb_typeof("positive_markers") = 'array'`,
)
@Check(
  'ck_sap_document_types_routing_policy',
  `jsonb_typeof("routing_policy") = 'object'`,
)
@Check(
  'ck_sap_document_types_retention_policy',
  `jsonb_typeof("retention_policy") = 'object'`,
)
export class SapDocumentType {
  @PrimaryColumn({ type: 'varchar', length: 60 }) code!: string;
  @Column({ name: 'display_name', type: 'varchar', length: 120 }) displayName!: string;
  @Column({ name: 'positive_markers', type: 'jsonb', default: () => "'[]'::jsonb" }) positiveMarkers!: string[];
  @Column({ name: 'authoritative_id_label', type: 'varchar', length: 120 }) authoritativeIdLabel!: string;
  @Column({ name: 'identifier_pattern', type: 'varchar', length: 250, nullable: true }) identifierPattern!: string | null;
  @Column({ name: 'rule_version', type: 'varchar', length: 60 }) ruleVersion!: string;
  @Column({ name: 'auto_extract_enabled', type: 'boolean', default: false }) autoExtractEnabled!: boolean;
  @Column({ name: 'review_only', type: 'boolean', default: true }) reviewOnly!: boolean;
  @Column({ name: 'auto_associate_enabled', type: 'boolean', default: false }) autoAssociateEnabled!: boolean;
  @Column({ name: 'routing_policy', type: 'jsonb', default: () => "'{}'::jsonb" }) routingPolicy!: Record<string, unknown>;
  @Column({ name: 'retention_policy', type: 'jsonb', default: () => "'{}'::jsonb" }) retentionPolicy!: Record<string, unknown>;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' }) updatedAt!: Date;

  @OneToMany(() => VisitDocument, (document) => document.sapDocumentType)
  documents!: VisitDocument[];
}
