# SAP document foundation

Truck Log uses the existing `visit_documents` table and `truck-log-documents` persistent volume as the document system of record. SAP document support is additive; it does not create a competing storage system.

## Current model

The foundation provides:

- `sap_document_types`, an extensible document-type and validation-rule registry;
- capture, validation, review, association, SHA-256, idempotency, supersession, storage, and retention metadata on `visit_documents`;
- nullable visit association so an unmatched PDF can be retained without guessing a Load ID or Visit ID;
- `sap_document_events`, an append-only audit history for ingestion, review, and association activity;
- indexes and uniqueness constraints for agent retries and authoritative per-visit/type documents.

### Packing slips

`PACKING_SLIP` recognizes Packing List / Packing Slip markers and uses Delivery Number as the authoritative identifier. A valid identifier is exactly eight digits. Delivery Number alone is not treated as a Truck Log Load ID or Visit ID, so association remains explicit and auditable.

The Windows Print Agent remains the reference capture/OCR path. The Dock Board upload remains supported for compatibility. Server-side SHA-256 and audit events protect stored-document integrity.

### Goods receipts

`GOODS_RECEIPT` is registered for review, but automatic extraction and association remain disabled until a real production sample proves the exact identifier format.

## Storage contract

`SapDocumentStorageService` stores PDFs under:

`sap/YYYY/MM/DD/<uuid>.pdf`

It validates configured size limits, PDF MIME/header, safe names, traversal/symlink boundaries, atomic publication, server-side SHA-256, and restrictive directory/file permissions.

## Association and audit safety

- Agent capture IDs are protected against duplicate retries.
- SHA-256 is indexed for investigation but is not globally unique.
- Associated rows require a real visit and association time.
- Unmatched rows remain unassociated and reviewable.
- Removing an associated visit moves the document to an orphan/review state instead of deleting its record.
- Validated SAP rows require a registered type and nonblank extracted identifier.
- SAP document events are append-only except for controlled referential behavior.
- Broad reference-data tools refuse unsafe operations when SAP document metadata would be put at risk.

## Migration and startup

The SAP document schema is part of `database/truck-log/migrations/0001_baseline.sql` (originally 0.1 migration 004) and is applied by `tools/truck-log/migrate.mjs` at server start.

`TRUCK_LOG_DATABASE_SYNCHRONIZE=false` is mandatory. Numbered migrations are the supported schema-change path.

Useful commands:

```text
npm run db:sap-document-foundation:preflight
npm run db:sap-document-foundation
npm run db:verify:sap-documents
```

Fresh Docker setup applies the complete numbered migration chain before the API is declared ready.

## Protected behavior

The document foundation is designed to preserve existing Truck Log data, RXO ingestion/export behavior, external volumes, credentials, Check-In, Dock Board, Records/History, and driver-slip printing. There is no destructive automatic rollback for document metadata once business records exist.
