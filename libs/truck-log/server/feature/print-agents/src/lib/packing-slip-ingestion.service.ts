import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { canonicalJson, returnedRows } from '@truck-log/server/data-access';
import {
  SapDocumentFileValidationError,
  StoredSapDocumentPdf, removeIfUncommitted } from '@truck-log/server/infrastructure/sap-documents';
import { SapDocumentStorageService } from '@truck-log/server/infrastructure/sap-documents';
import { AuthenticatedPrintAgent } from '@truck-log/server/auth/print-agent';
import { PackingSlipIngestionDto } from './dto/packing-slip-ingestion.dto';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const DELIVERY_NUMBER_PATTERN = /^[0-9]{8}$/;
const ACCEPTED_MARKERS = new Set(['packing list', 'packing slip']);

export interface UploadedPackingSlipFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size?: number;
}

function normalizedMarker(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function validationFor(metadata: PackingSlipIngestionDto): {
  extractedId: string | null;
  status: 'VALIDATED' | 'REVIEW_REQUIRED';
  extractionStatus: 'DETECTED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'MISMATCH';
  reason: string;
} {
  const hasMarker = metadata.positiveMarkersFound
    .map(normalizedMarker)
    .some((marker) => ACCEPTED_MARKERS.has(marker));
  if (!hasMarker) {
    throw new UnprocessableEntityException(
      'Packing Slip ingestion requires a positive Packing List or Packing Slip marker.',
    );
  }

  const validCandidates = [...new Set(
    metadata.identifierCandidates.map((candidate) => candidate.trim()).filter((candidate) => DELIVERY_NUMBER_PATTERN.test(candidate)),
  )];
  const malformedCandidate = metadata.identifierCandidates.some(
    (candidate) => !DELIVERY_NUMBER_PATTERN.test(candidate.trim()),
  );
  const reportedId = metadata.sapDocumentId?.trim();
  if (validCandidates.length === 1 && !malformedCandidate && reportedId === validCandidates[0]) {
    return {
      extractedId: validCandidates[0],
      status: 'VALIDATED',
      // Same vocabulary as the Dock Board extractor, which only offers DETECTED slips for a visit.
      extractionStatus: 'DETECTED',
      reason: 'Validated Packing Slip is awaiting deterministic Truck Log visit association.',
    };
  }
  if (validCandidates.length > 1) {
    return {
      extractedId: null,
      status: 'REVIEW_REQUIRED',
      extractionStatus: 'AMBIGUOUS',
      reason: 'Multiple valid 8-digit Delivery Number candidates were reported; Truck Log did not guess.',
    };
  }
  if (validCandidates.length === 0 || malformedCandidate) {
    return {
      extractedId: null,
      status: 'REVIEW_REQUIRED',
      extractionStatus: 'NOT_FOUND',
      reason: 'Exactly one valid 8-digit Delivery Number was not reported; Truck Log did not guess.',
    };
  }
  return {
    extractedId: null,
    status: 'REVIEW_REQUIRED',
    extractionStatus: 'MISMATCH',
    reason: 'The reported SAP document ID did not match the sole Delivery Number candidate; Truck Log did not guess.',
  };
}

function mapStorageError(error: unknown): never {
  if (!(error instanceof SapDocumentFileValidationError)) throw error;
  if (error.code === 'FILE_TOO_LARGE') throw new PayloadTooLargeException(error.message);
  if (error.code === 'INVALID_MIME_TYPE') throw new UnsupportedMediaTypeException(error.message);
  if (error.code === 'INVALID_PDF_HEADER') throw new UnprocessableEntityException(error.message);
  throw new BadRequestException(error.message);
}

@Injectable()
export class PackingSlipIngestionService {
  private readonly logger = new Logger(PackingSlipIngestionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: SapDocumentStorageService,
  ) {}

  async ingest(
    agent: AuthenticatedPrintAgent,
    idempotencyKey: string | undefined,
    metadata: PackingSlipIngestionDto,
    file: UploadedPackingSlipFile | undefined,
  ) {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException('X-Idempotency-Key is required and must be 16-128 safe characters.');
    }
    if (!file?.buffer || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BadRequestException('One non-empty PDF file is required in the file field.');
    }
    const validation = validationFor(metadata);
    const pdfTail = file.buffer.subarray(Math.max(0, file.buffer.length - 4096));
    if (!pdfTail.includes(Buffer.from('%%EOF', 'ascii'))) {
      throw new UnprocessableEntityException('The uploaded file does not contain a PDF end-of-file marker.');
    }
    const pdfSha256 = createHash('sha256').update(file.buffer).digest('hex');
    if (metadata.clientReportedSha256 && metadata.clientReportedSha256 !== pdfSha256) {
      throw new UnprocessableEntityException('clientReportedSha256 does not match the uploaded PDF.');
    }
    const requestSha256 = createHash('sha256')
      .update(canonicalJson({ agentId: agent.agentId, endpoint: 'packing-slip', metadata, pdfSha256 }))
      .digest('hex');
    const capturedAt = new Date(metadata.capturedAt);
    const now = new Date();
    // Assigned inside the transaction callback, so the catch block must not narrow it to null.
    let stored = null as StoredSapDocumentPdf | null;

    try {
      const response = await this.dataSource.transaction(async (manager) => {
        await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `${agent.agentId}:packing-slip:${metadata.sourceCaptureId}`,
        ]);
        await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `${agent.agentId}:idempotency:${idempotencyKey}`,
        ]);

        const credentialUse = returnedRows(await manager.query(
          `UPDATE print_agent_credentials
              SET last_used_at = $2
            WHERE key_id = $1 AND agent_id = $3 AND active = TRUE
              AND scopes @> '["documents:upload"]'::jsonb
            RETURNING key_id`,
          [agent.keyId, now, agent.agentId],
        ));
        if (!credentialUse[0]) {
          throw new UnauthorizedException('This Print Agent credential is no longer active.');
        }

        const priorRequest = await manager.query(
          `SELECT request_sha256, response_body
             FROM print_agent_idempotency
            WHERE agent_id = $1 AND idempotency_key = $2`,
          [agent.agentId, idempotencyKey],
        );
        if (priorRequest[0]) {
          if (priorRequest[0].request_sha256 !== requestSha256) {
            throw new ConflictException('This X-Idempotency-Key was already used with a different request.');
          }
          return priorRequest[0].response_body;
        }

        const priorCapture = await manager.query(
          `SELECT id, sha256, document_type, extraction_method, route, source_queue,
                  output_printer, print_status, print_error, captured_at, validation_status,
                  extracted_document_id, reported_document_id, confidence,
                  review_status, association_status
             FROM visit_documents
            WHERE source_agent_id = $1 AND source_capture_id = $2`,
          [agent.agentId, metadata.sourceCaptureId],
        );
        if (priorCapture[0]) {
          const prior = priorCapture[0];
          const sameCapture = prior.sha256 === pdfSha256
            && prior.document_type === 'PACKING_SLIP'
            && prior.extraction_method === metadata.detectionMethod
            && prior.route === metadata.route
            && prior.source_queue === metadata.sourceQueue
            && prior.output_printer === metadata.outputPrinter
            && prior.print_status === metadata.printStatus
            && prior.print_error === (metadata.printError ?? null)
            && prior.reported_document_id === (metadata.sapDocumentId ?? null)
            && prior.extracted_document_id === validation.extractedId
            && prior.validation_status === validation.status
            && (prior.confidence === null ? metadata.confidence === undefined : prior.confidence === metadata.confidence)
            && new Date(prior.captured_at).toISOString() === metadata.capturedAt;
          if (!sameCapture) {
            throw new ConflictException(
              'This sourceCaptureId already identifies a different capture for this Print Agent.',
            );
          }
          const body = {
            accepted: true,
            duplicate: true,
            documentId: prior.id,
            documentType: 'PACKING_SLIP',
            sapDocumentId: prior.extracted_document_id,
            validationStatus: prior.validation_status,
            reviewStatus: prior.review_status,
            associationStatus: prior.association_status,
            sha256: prior.sha256,
          };
          await manager.query(
            `INSERT INTO print_agent_idempotency(
               agent_id, idempotency_key, request_sha256, response_status, response_body
             ) VALUES ($1, $2, $3, 200, $4::jsonb)`,
            [agent.agentId, idempotencyKey, requestSha256, JSON.stringify(body)],
          );
          return body;
        }

        const activeType = await manager.query(
          `SELECT code FROM sap_document_types WHERE code = 'PACKING_SLIP' AND active = TRUE`,
        );
        if (!activeType[0]) {
          throw new ConflictException('PACKING_SLIP is not active in the SAP document registry.');
        }

        try {
          stored = await this.storage.storePdf({
            buffer: file.buffer,
            originalName: file.originalname,
            mimeType: file.mimetype,
            capturedAt,
          });
        } catch (error) {
          mapStorageError(error);
        }
        if (!stored) throw new Error('SAP document storage did not return a stored PDF.');

        const reviewReason = [validation.reason, metadata.reviewReason].filter(Boolean).join(' ');
        const inserted = await manager.query(
          `INSERT INTO visit_documents(
             truck_visit_id, file_name, stored_file_name, relative_path, document_type,
             sap_document_type_code, mime_type, file_size_bytes, extracted_document_id,
             extraction_status, extraction_method, extraction_message, scanned_at, scanned_by,
             created_at, source_kind, source_agent_id, source_capture_id, sha256, captured_at,
             route, source_queue, output_printer, print_status, print_error, reported_document_id,
             validation_status, validation_rule_version, confidence, review_status, review_reason,
             association_status, association_method, associated_at, associated_by,
             association_reason, is_authoritative, storage_status, retention_status, updated_at
           ) VALUES (
             NULL, $1, $2, $3, 'PACKING_SLIP', 'PACKING_SLIP', 'application/pdf', $4, $5,
             $6, $7, $8, $9, $10, $11, 'PRINT_AGENT', $10, $12, $13, $9,
             $14, $15, $16, $17, $18, $19, $20, 'PACKING_SLIP_V1', $21,
             'NEEDS_REVIEW', $22, 'UNMATCHED', NULL, NULL, NULL, NULL, FALSE,
             'STORED', 'ACTIVE', $11
           ) RETURNING id`,
          [
            stored.fileName, stored.storedFileName, stored.relativePath, stored.fileSizeBytes,
            validation.extractedId, validation.extractionStatus, metadata.detectionMethod,
            reviewReason, capturedAt, agent.agentId, now, metadata.sourceCaptureId, stored.sha256,
            metadata.route, metadata.sourceQueue, metadata.outputPrinter, metadata.printStatus,
            metadata.printError ?? null, metadata.sapDocumentId ?? null,
            validation.status, metadata.confidence ?? null, reviewReason,
          ],
        );
        const documentId = inserted[0].id;
        await manager.query(
          `INSERT INTO sap_document_events(
             visit_document_id, event_type, actor_type, actor_id, reason, details
           ) VALUES ($1, 'PRINT_AGENT_DOCUMENT_INGESTED', 'PRINT_AGENT', $2, $3, $4::jsonb)`,
          [
            documentId,
            agent.agentId,
            reviewReason,
            JSON.stringify({
              sourceCaptureId: metadata.sourceCaptureId,
              documentType: 'PACKING_SLIP',
              sapDocumentId: validation.extractedId,
              detectionMethod: metadata.detectionMethod,
              validationStatus: validation.status,
              route: metadata.route,
              sourceQueue: metadata.sourceQueue,
              outputPrinter: metadata.outputPrinter,
              capturedAt: metadata.capturedAt,
              printStatus: metadata.printStatus,
              sha256: stored.sha256,
            }),
          ],
        );
        await manager.query(
          `UPDATE print_agents
              SET last_seen_at = $2,
                  last_successful_capture_at = GREATEST(COALESCE(last_successful_capture_at, $3), $3),
                  last_successful_print_at = CASE WHEN $4 = 'PRINTED'
                    THEN GREATEST(COALESCE(last_successful_print_at, $3), $3) ELSE last_successful_print_at END,
                  last_error_at = CASE WHEN $4 = 'FAILED' THEN $2 ELSE last_error_at END,
                  last_error = CASE WHEN $4 = 'FAILED' THEN $5 ELSE last_error END,
                  updated_at = $2
            WHERE agent_id = $1 AND enabled = TRUE`,
          [agent.agentId, now, capturedAt, metadata.printStatus, metadata.printError ?? null],
        );
        const body = {
          accepted: true,
          duplicate: false,
          documentId,
          documentType: 'PACKING_SLIP',
          sapDocumentId: validation.extractedId,
          validationStatus: validation.status,
          reviewStatus: 'NEEDS_REVIEW',
          associationStatus: 'UNMATCHED',
          sha256: stored.sha256,
        };
        await manager.query(
          `INSERT INTO print_agent_idempotency(
             agent_id, idempotency_key, request_sha256, response_status, response_body
             ) VALUES ($1, $2, $3, 200, $4::jsonb)`,
          [agent.agentId, idempotencyKey, requestSha256, JSON.stringify(body)],
        );
        return body;
      });
      return response;
    } catch (error) {
      if (stored) {
        const file = stored;
        await removeIfUncommitted(this.dataSource, file.relativePath, () => this.storage.deletePdf(file.relativePath), this.logger);
      }
      throw error;
    }
  }
}
