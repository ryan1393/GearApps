import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SapDocumentEvent } from './sap-document-event.entity';
import { SapDocumentType } from './sap-document-type.entity';
import { TruckVisit } from './truck-visit.entity';

@Entity({ name: 'visit_documents' })
@Check(
  'ck_visit_documents_agent_capture_pair',
  `("source_agent_id" IS NULL AND "source_capture_id" IS NULL)
    OR (NULLIF(BTRIM("source_agent_id"), '') IS NOT NULL
        AND NULLIF(BTRIM("source_capture_id"), '') IS NOT NULL)`,
)
@Check('ck_visit_documents_sha256', `"sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'`)
@Check(
  'ck_visit_documents_confidence',
  `"confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)`,
)
@Check(
  'ck_visit_documents_validation_status',
  `"validation_status" IN ('NOT_APPLICABLE', 'VALIDATED', 'REVIEW_REQUIRED', 'REJECTED')`,
)
@Check(
  'ck_visit_documents_validated_id',
  `"validation_status" <> 'VALIDATED'
    OR ("sap_document_type_code" IS NOT NULL
        AND NULLIF(BTRIM("extracted_document_id"), '') IS NOT NULL)`,
)
@Check(
  'ck_visit_documents_review_status',
  `"review_status" IN ('NOT_APPLICABLE', 'NEEDS_REVIEW', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')`,
)
@Check(
  'ck_visit_documents_review_reason',
  `"review_status" NOT IN ('NEEDS_REVIEW', 'IN_REVIEW')
    OR NULLIF(BTRIM("review_reason"), '') IS NOT NULL`,
)
@Check(
  'ck_visit_documents_association_status',
  `"association_status" IN ('ASSOCIATED', 'UNMATCHED', 'ORPHANED')`,
)
@Check(
  'ck_visit_documents_association_consistency',
  `("association_status" = 'ASSOCIATED'
      AND "truck_visit_id" IS NOT NULL
      AND "associated_at" IS NOT NULL)
    OR ("association_status" = 'UNMATCHED'
        AND "truck_visit_id" IS NULL
        AND "associated_at" IS NULL)
    OR ("association_status" = 'ORPHANED'
        AND "truck_visit_id" IS NULL
        AND "associated_at" IS NOT NULL)`,
)
@Check(
  'ck_visit_documents_print_status',
  `"print_status" IN ('NOT_APPLICABLE', 'PENDING', 'PRINTED', 'FAILED', 'SKIPPED')`,
)
@Check(
  'ck_visit_documents_print_failure_reason',
  `"print_status" <> 'FAILED' OR NULLIF(BTRIM("print_error"), '') IS NOT NULL`,
)
@Check(
  'ck_visit_documents_storage_status',
  `"storage_status" IN ('PENDING', 'STORED', 'FAILED', 'QUARANTINED', 'DELETED')`,
)
@Check(
  'ck_visit_documents_retention_status',
  `"retention_status" IN ('ACTIVE', 'HOLD', 'ELIGIBLE_FOR_CLEANUP', 'PURGED')`,
)
@Check(
  'ck_visit_documents_supersession',
  `"supersedes_document_id" IS NULL OR "supersedes_document_id" <> "id"`,
)
@Check(
  'ck_visit_documents_print_agent_capture',
  `"source_kind" <> 'PRINT_AGENT'
    OR (NULLIF(BTRIM("source_agent_id"), '') IS NOT NULL
        AND NULLIF(BTRIM("source_capture_id"), '') IS NOT NULL
        AND "sha256" ~ '^[0-9a-f]{64}$'
        AND "mime_type" = 'application/pdf'
        AND "sap_document_type_code" IS NOT NULL
        AND "document_type" = "sap_document_type_code"
        AND "storage_status" IN ('STORED', 'QUARANTINED', 'DELETED'))`,
)
@Check(
  'ck_visit_documents_validated_packing_slip',
  `"source_kind" <> 'PRINT_AGENT'
    OR "sap_document_type_code" <> 'PACKING_SLIP'
    OR "validation_status" <> 'VALIDATED'
    OR ("extracted_document_id" ~ '^[0-9]{8}$'
        AND "reported_document_id" = "extracted_document_id"
        AND "validation_rule_version" = 'PACKING_SLIP_V1')`,
)
@Index('ix_visit_documents_visit', { synchronize: false })
@Index('ux_visit_documents_one_packing_slip', { synchronize: false })
@Index('ix_visit_documents_extracted_document_id', { synchronize: false })
@Index('ux_visit_documents_agent_capture', { synchronize: false })
@Index('ix_visit_documents_sha256', { synchronize: false })
@Index('ix_visit_documents_sap_id', { synchronize: false })
@Index('ix_visit_documents_review_queue', { synchronize: false })
@Index('ix_visit_documents_association', { synchronize: false })
@Index('ux_visit_documents_authoritative_sap_type', { synchronize: false })
@Index('ux_visit_documents_supersedes', { synchronize: false })
export class VisitDocument {
  /** response-only field; no TypeORM column/schema change. */
  fileAvailable?: boolean;
  @PrimaryGeneratedColumn({ type: 'int' }) id!: number;
  @Column({ name: 'truck_visit_id', type: 'int', nullable: true }) truckVisitId!: number | null;
  @Column({ name: 'file_name', type: 'varchar', length: 255 }) fileName!: string;
  @Column({ name: 'original_file_name', type: 'text', nullable: true }) originalFileName!: string | null;
  @Column({ name: 'stored_file_name', type: 'varchar', length: 255 }) storedFileName!: string;
  @Column({ name: 'relative_path', type: 'varchar', length: 700 }) relativePath!: string;
  @Column({ name: 'document_type', type: 'varchar', length: 100, nullable: true }) documentType!: string | null;
  @Column({ name: 'sap_document_type_code', type: 'varchar', length: 60, nullable: true }) sapDocumentTypeCode!: string | null;
  @Column({ name: 'mime_type', type: 'varchar', length: 150, nullable: true }) mimeType!: string | null;
  @Column({ name: 'file_size_bytes', type: 'int', nullable: true }) fileSizeBytes!: number | null;
  @Column({ name: 'page_count', type: 'int', nullable: true }) pageCount!: number | null;
  @Column({ name: 'extracted_document_id', type: 'varchar', length: 100, nullable: true }) extractedDocumentId!: string | null;
  @Column({ name: 'extraction_status', type: 'varchar', length: 30, default: 'NOT_APPLICABLE' }) extractionStatus!: string;
  @Column({ name: 'extraction_method', type: 'varchar', length: 80, nullable: true }) extractionMethod!: string | null;
  @Column({ name: 'extraction_message', type: 'text', nullable: true }) extractionMessage!: string | null;
  @Column({ name: 'scanned_at', type: 'timestamptz' }) scannedAt!: Date;
  @Column({ name: 'scanned_by', type: 'varchar', length: 120, nullable: true }) scannedBy!: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;

  @Column({ name: 'source_kind', type: 'varchar', length: 40, default: 'VISIT_UPLOAD' }) sourceKind!: string;
  @Column({ name: 'source_agent_id', type: 'varchar', length: 120, nullable: true }) sourceAgentId!: string | null;
  @Column({ name: 'source_capture_id', type: 'varchar', length: 120, nullable: true }) sourceCaptureId!: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) sha256!: string | null;
  @Column({ name: 'captured_at', type: 'timestamptz', default: () => 'NOW()' }) capturedAt!: Date;
  @Column({ type: 'varchar', length: 120, nullable: true }) route!: string | null;
  @Column({ name: 'source_queue', type: 'varchar', length: 255, nullable: true }) sourceQueue!: string | null;
  @Column({ name: 'output_printer', type: 'varchar', length: 255, nullable: true }) outputPrinter!: string | null;
  @Column({ name: 'print_status', type: 'varchar', length: 40, default: 'NOT_APPLICABLE' }) printStatus!: string;
  @Column({ name: 'print_error', type: 'text', nullable: true }) printError!: string | null;
  @Column({ name: 'reported_document_id', type: 'varchar', length: 100, nullable: true }) reportedDocumentId!: string | null;
  @Column({ name: 'validation_status', type: 'varchar', length: 40, default: 'NOT_APPLICABLE' }) validationStatus!: string;
  @Column({ name: 'validation_rule_version', type: 'varchar', length: 60, nullable: true }) validationRuleVersion!: string | null;
  @Column({ type: 'double precision', nullable: true }) confidence!: number | null;
  @Column({ name: 'review_status', type: 'varchar', length: 40, default: 'NOT_APPLICABLE' }) reviewStatus!: string;
  @Column({ name: 'review_reason', type: 'text', nullable: true }) reviewReason!: string | null;
  @Column({ name: 'association_status', type: 'varchar', length: 40, default: 'ASSOCIATED' }) associationStatus!: string;
  @Column({ name: 'association_method', type: 'varchar', length: 40, nullable: true }) associationMethod!: string | null;
  @Column({ name: 'associated_at', type: 'timestamptz', nullable: true, default: () => 'NOW()' }) associatedAt!: Date | null;
  @Column({ name: 'associated_by', type: 'varchar', length: 120, nullable: true }) associatedBy!: string | null;
  @Column({ name: 'association_reason', type: 'text', nullable: true }) associationReason!: string | null;
  @Column({ name: 'is_authoritative', type: 'boolean', default: false }) isAuthoritative!: boolean;
  @Column({ name: 'supersedes_document_id', type: 'int', nullable: true }) supersedesDocumentId!: number | null;
  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true }) supersededAt!: Date | null;
  @Column({ name: 'storage_status', type: 'varchar', length: 40, default: 'STORED' }) storageStatus!: string;
  @Column({ name: 'retention_status', type: 'varchar', length: 40, default: 'ACTIVE' }) retentionStatus!: string;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' }) updatedAt!: Date;
  @Column({ name: 'rxo_site_key', type: 'varchar', length: 80, nullable: true }) rxoSiteKey!: string | null;
  @Column({ name: 'rxo_shipment_id', type: 'varchar', length: 120, nullable: true }) rxoShipmentId!: string | null;
  @Column({ name: 'rxo_direction', type: 'varchar', length: 20, nullable: true }) rxoDirection!: string | null;
  @Column({ name: 'rxo_document_version', type: 'int', nullable: true }) rxoDocumentVersion!: number | null;
  @Column({ name: 'rxo_is_active', type: 'boolean', default: false }) rxoIsActive!: boolean;
  @Column({ name: 'uploaded_by_key_id', type: 'varchar', length: 16, nullable: true }) uploadedByKeyId!: string | null;

  @ManyToOne(() => TruckVisit, (visit) => visit.documents, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'truck_visit_id',
    foreignKeyConstraintName: 'fk_visit_documents_truck_visit',
  })
  visit!: TruckVisit | null;

  @ManyToOne(() => SapDocumentType, (documentType) => documentType.documents, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'sap_document_type_code',
    foreignKeyConstraintName: 'fk_visit_documents_sap_document_type',
  })
  sapDocumentType!: SapDocumentType | null;

  @ManyToOne(() => VisitDocument, (document) => document.supersededByDocuments, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'supersedes_document_id',
    foreignKeyConstraintName: 'fk_visit_documents_supersedes',
  })
  supersedesDocument!: VisitDocument | null;

  @OneToMany(() => VisitDocument, (document) => document.supersedesDocument)
  supersededByDocuments!: VisitDocument[];

  @OneToMany(() => SapDocumentEvent, (event) => event.visitDocument)
  sapEvents!: SapDocumentEvent[];
}
