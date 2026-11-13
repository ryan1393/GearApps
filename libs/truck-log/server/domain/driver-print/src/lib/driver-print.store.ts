import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { EntityManager } from 'typeorm';
import {
  derivePrintAgentClaimToken,
  redactPrintAgentClaimResponseForPersistence,
} from './print-agent-claim-token';
import type {
  AgentAvailability,
  AgentClaimResponse,
  DocumentSnapshot,
  DriverEventInput,
  DriverPrintConfiguration,
  DriverPrintEventType,
  DriverPrintVisitEventType,
  DriverPrintItemStatus,
  DriverPrintPackageSummary,
  PersistedAgentClaimResponse,
  PersistedAgentPrintJob,
} from './driver-print.types';
import {
  CLAIM_TOKEN_SECRET_PATTERN,
  IDEMPOTENCY_KEY_PATTERN,
  SHA256_PATTERN,
  UUID_PATTERN,
} from './driver-print.types';
import { boundedAuditActor, cleanOptional, iso } from './driver-print.utils';

export class DriverPrintStore {
  constructor(private readonly config: ConfigService) {}

  agentClaimResponseForPersistence(
    response: AgentClaimResponse,
  ): PersistedAgentClaimResponse {
    return redactPrintAgentClaimResponseForPersistence(response);
  }

  restoreAgentClaimResponse(
    agentId: string,
    idempotencyKey: string,
    requestSha256: string,
    storedResponse: unknown,
  ): AgentClaimResponse {
    let parsed: unknown = storedResponse;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        throw new ConflictException(
          'The stored Print Agent claim response failed integrity validation.',
        );
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ConflictException(
        'The stored Print Agent claim response failed integrity validation.',
      );
    }
    const rawJob = (parsed as Record<string, unknown>).job;
    if (rawJob === null) return { job: null };
    if (!rawJob || typeof rawJob !== 'object' || Array.isArray(rawJob)) {
      throw new ConflictException(
        'The stored Print Agent claim response failed integrity validation.',
      );
    }
    const candidate = rawJob as Record<string, unknown>;
    const itemId = String(candidate.itemId ?? '');
    const packageId = String(candidate.packageId ?? '');
    const attemptNumber = Number(candidate.attemptNumber);
    const route = String(candidate.route ?? '');
    const printer = String(candidate.printer ?? '');
    const fileName = String(candidate.fileName ?? '');
    const fileSizeBytes = Number(candidate.fileSizeBytes);
    const sha256 = String(candidate.sha256 ?? '');
    const leaseExpiresAt = String(candidate.leaseExpiresAt ?? '');
    const downloadUrl = String(candidate.downloadUrl ?? '');
    const leaseExpiry = new Date(leaseExpiresAt);
    if (
      !UUID_PATTERN.test(itemId) ||
      !UUID_PATTERN.test(packageId) ||
      !Number.isSafeInteger(attemptNumber) ||
      attemptNumber <= 0 ||
      !route ||
      !printer ||
      !fileName ||
      !Number.isSafeInteger(fileSizeBytes) ||
      fileSizeBytes <= 0 ||
      !SHA256_PATTERN.test(sha256) ||
      !Number.isFinite(leaseExpiry.getTime()) ||
      leaseExpiry.toISOString() !== leaseExpiresAt ||
      downloadUrl !== `/api/v1/print-agents/jobs/${itemId}/document`
    ) {
      throw new ConflictException(
        'The stored Print Agent claim response failed integrity validation.',
      );
    }
    const persistedJob: PersistedAgentPrintJob = {
      itemId,
      packageId,
      attemptNumber,
      route,
      printer,
      fileName,
      fileSizeBytes,
      sha256,
      leaseExpiresAt,
      downloadUrl,
    };
    return {
      job: {
        ...persistedJob,
        claimToken: this.deriveAgentClaimToken(
          agentId,
          idempotencyKey,
          requestSha256,
          persistedJob,
        ),
      },
    };
  }

  deriveAgentClaimToken(
    agentId: string,
    idempotencyKey: string,
    requestSha256: string,
    job: PersistedAgentPrintJob,
  ): string {
    const secretHex = this.claimTokenSecretHex();
    if (!secretHex) {
      throw new ServiceUnavailableException(
        'Driver Print Agent claim-token signing is not securely configured.',
      );
    }
    return derivePrintAgentClaimToken(secretHex, {
      agentId,
      idempotencyKey,
      requestSha256,
      job,
    });
  }

  claimTokenSecretHex(): string | null {
    const configured = String(
      this.config.get<string>('TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET', ''),
    ).trim();
    return CLAIM_TOKEN_SECRET_PATTERN.test(configured)
      ? configured.toLowerCase()
      : null;
  }

  driverPrintConfiguration(): DriverPrintConfiguration {
    // identity/route may be configured; a global printer must NOT limit gate jobs.
    const agentId = cleanOptional(this.config.get<string>('TRUCK_LOG_DRIVER_PRINT_AGENT_ID', '')) || 'trucklog-print-pc-01';
    const route = cleanOptional(this.config.get<string>('TRUCK_LOG_DRIVER_PRINT_ROUTE', '')) || 'RXO_DRIVER_DOCUMENT';
    const printer = cleanOptional(this.config.get<string>('TRUCK_LOG_DRIVER_PRINT_PRINTER', ''));
    const valid = /^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(agentId)
      && route.length <= 120 && !/[\u0000-\u001f\u007f]/.test(route)
      && !!this.claimTokenSecretHex();
    return { agentId, route, printer, valid,
      error: valid ? null : 'Driver Print Agent identity, route, or claim signing is invalid.' };
  }

  async gatePrinterSetting(manager: EntityManager, guardGate: 'EAST' | 'WEST' | null): Promise<string | null> {
    // No gate, missing saved value or corrupt value must never select the opposite gate.
    if (guardGate !== 'EAST' && guardGate !== 'WEST') return null;
    const key = guardGate === 'EAST' ? 'driver_print_east_printer' : 'driver_print_west_printer';
    const rows = await manager.query('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', [key]) as Array<{value: string | null}>;
    const printer = typeof rows[0]?.value === 'string' ? rows[0].value.trim() : '';
    return printer && printer.length <= 255 && !/[\u0000-\u001f\u007f]/.test(printer) ? printer : null;
  }

  async agentAvailability(
    manager: EntityManager,
    lockAgent = false,
    printerOverride: string | null = null,
  ): Promise<AgentAvailability> {
    const configured = this.driverPrintConfiguration();
    const printer = cleanOptional(printerOverride ?? '');
    const base = { ...configured, printer, available: false, agentExists: false };
    if (!configured.valid || !configured.agentId) return base;
    if (!printer || printer.length > 255 || /[\u0000-\u001f\u007f]/.test(printer)) {
      return { ...base, valid: false, error: 'An exact saved or frozen gate printer is required. No default-printer fallback is allowed.' };
    }
    const rows = await manager.query(
      `SELECT agent_id, enabled, last_seen_at, configured_routes,
              last_seen_at >= NOW() - ($2::int * INTERVAL '1 second') AS online
         FROM print_agents WHERE agent_id = $1 ${lockAgent ? 'FOR SHARE' : ''}`,
      [configured.agentId, this.offlineSeconds()],
    );
    const row = rows[0];
    if (!row) return { ...base, error: 'The configured Print Agent is not registered.' };
    if (row.enabled !== true) return { ...base, agentExists: true, error: 'The configured Print Agent is disabled.' };
    if (row.online !== true) return { ...base, agentExists: true, error: 'The configured Print Agent is offline.' };
    const routes: Array<Record<string, unknown>> = Array.isArray(row.configured_routes) ? row.configured_routes : [];
    const exact = routes.some(r => r.route === configured.route && r.outputPrinter === printer);
    return { ...base, agentExists: true, available: exact, error: exact ? null : 'The service has not advertised this exact gate printer and route.' };
  }

  async requireRxoDocument(
    manager: EntityManager,
    visitId: number,
    documentId: number,
    requireActive: boolean,
  ): Promise<DocumentSnapshot> {
    const rows = await manager.query(
      `SELECT id, truck_visit_id, file_name, relative_path, mime_type,
              file_size_bytes, sha256, rxo_site_key, rxo_shipment_id,
              rxo_direction, rxo_document_version
         FROM visit_documents document
        WHERE id = $1
          AND truck_visit_id = $2
          AND document_type = 'RXO_DRIVER_DOCUMENT'
          AND source_kind = 'MATERIALS_UPLOAD'
          AND storage_status = 'STORED'
          AND association_status = 'ASSOCIATED'
          AND ($3::boolean = FALSE OR rxo_is_active = TRUE)
        FOR SHARE OF document`,
      [documentId, visitId, requireActive],
    );
    const row = rows[0];
    if (!row) {
      throw new ConflictException(
        'The RXO driver-document version is not safely associated with this visit.',
      );
    }
    const snapshot: DocumentSnapshot = {
      id: Number(row.id),
      truckVisitId: Number(row.truck_visit_id),
      fileName: String(row.file_name),
      relativePath: String(row.relative_path),
      mimeType: String(row.mime_type),
      fileSizeBytes: Number(row.file_size_bytes),
      sha256: String(row.sha256),
      rxoSiteKey: String(row.rxo_site_key),
      rxoShipmentId: String(row.rxo_shipment_id),
      rxoDirection: String(row.rxo_direction),
      documentVersion: Number(row.rxo_document_version),
    };
    if (
      snapshot.mimeType !== 'application/pdf' ||
      !snapshot.relativePath.startsWith('rxo/') ||
      !Number.isSafeInteger(snapshot.fileSizeBytes) ||
      snapshot.fileSizeBytes <= 0 ||
      !SHA256_PATTERN.test(snapshot.sha256) ||
      !snapshot.rxoSiteKey ||
      !snapshot.rxoShipmentId ||
      !['INBOUND', 'OUTBOUND'].includes(snapshot.rxoDirection) ||
      !Number.isSafeInteger(snapshot.documentVersion) ||
      snapshot.documentVersion <= 0
    ) {
      throw new ConflictException('The RXO driver-document metadata is not valid for printing.');
    }
    return snapshot;
  }

  async documentSnapshotForAudit(
    manager: EntityManager,
    visitId: number,
    documentId: number,
  ): Promise<DocumentSnapshot> {
    const rows = await manager.query(
      `SELECT id, truck_visit_id, file_name, relative_path, mime_type,
              file_size_bytes, sha256, rxo_site_key, rxo_shipment_id,
              rxo_direction, rxo_document_version
         FROM visit_documents document
        WHERE id = $1
          AND truck_visit_id = $2
          AND document_type = 'RXO_DRIVER_DOCUMENT'
          AND source_kind = 'MATERIALS_UPLOAD'
          AND association_status = 'ASSOCIATED'
        FOR SHARE OF document`,
      [documentId, visitId],
    );
    const row = rows[0];
    if (!row) {
      throw new ConflictException(
        'The frozen RXO document audit snapshot is no longer associated with this visit.',
      );
    }
    return {
      id: Number(row.id),
      truckVisitId: Number(row.truck_visit_id),
      fileName: String(row.file_name),
      relativePath: String(row.relative_path),
      mimeType: String(row.mime_type),
      fileSizeBytes: Number(row.file_size_bytes),
      sha256: String(row.sha256),
      rxoSiteKey: String(row.rxo_site_key),
      rxoShipmentId: String(row.rxo_shipment_id),
      rxoDirection: String(row.rxo_direction),
      documentVersion: Number(row.rxo_document_version),
    };
  }

  async summaryByPackageId(
    manager: EntityManager,
    packageId: string,
  ): Promise<DriverPrintPackageSummary> {
    const rows = await manager.query(
      `SELECT package.id AS package_id, package.status AS package_status,
              package.frozen_document_id,
              document.rxo_document_version,
              document.file_name,
              item.id AS item_id, item.item_type, item.status AS item_status,
              item.last_error, item.printed_at
         FROM driver_print_packages package
         LEFT JOIN visit_documents document
           ON document.id = package.frozen_document_id
         LEFT JOIN driver_print_items item
           ON item.package_id = package.id
        WHERE package.id = $1
        ORDER BY CASE item.item_type
          WHEN 'DOCK_ASSIGNMENT' THEN 1
          WHEN 'RXO_DOCUMENT' THEN 2
          ELSE 3
        END`,
      [packageId],
    );
    if (!rows[0]) throw new NotFoundException('Driver Print Package was not found.');
    const first = rows[0];
    return {
      packageId: String(first.package_id),
      status: String(first.package_status),
      frozenRxoDocumentId:
        first.frozen_document_id === null ? null : Number(first.frozen_document_id),
      frozenRxoDocumentVersion:
        first.rxo_document_version === null
          ? null
          : Number(first.rxo_document_version),
      frozenRxoDocumentFileName:
        first.file_name === null ? null : String(first.file_name),
      items: rows
        .filter((row: Record<string, unknown>) => row.item_id !== null)
        .map((row: Record<string, unknown>) => ({
          id: String(row.item_id),
          itemType: String(row.item_type) as 'DOCK_ASSIGNMENT' | 'RXO_DOCUMENT',
          status: String(row.item_status) as DriverPrintItemStatus,
          error: row.last_error === null ? null : String(row.last_error),
          printedAt: iso(row.printed_at),
        })),
    };
  }

  async refreshPackageStatus(
    manager: EntityManager,
    packageId: string,
  ): Promise<void> {
    await manager.query(
      `WITH state AS (
         SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'PRINTED')::int AS printed,
                COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
                COUNT(*) FILTER (WHERE status IN ('PRINTED', 'FAILED'))::int AS terminal
           FROM driver_print_items
          WHERE package_id = $1
       )
       UPDATE driver_print_packages package
          SET status = CASE
                WHEN state.total = 0 THEN 'REQUESTED'
                WHEN state.printed = state.total THEN 'COMPLETED'
                WHEN state.failed = state.total THEN 'FAILED'
                WHEN state.failed > 0 THEN 'PARTIAL_FAILURE'
                ELSE 'IN_PROGRESS'
              END,
              updated_at = NOW()
         FROM state
        WHERE package.id = $1`,
      [packageId],
    );
  }

  async insertDriverEvent(
    manager: EntityManager,
    input: DriverEventInput,
  ): Promise<void> {
    const document = input.document ?? null;
    await manager.query(
      `INSERT INTO driver_print_events(
         event_type, occurred_at, actor_type, actor_id, actor_key_id,
         truck_visit_id, visit_document_id, package_id, item_id,
         rxo_site_key, rxo_shipment_id, rxo_direction, document_version,
         route, printer, error_message, details
       ) VALUES (
         $1, NOW(), $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15, $16::jsonb
       )`,
      [
        input.eventType,
        input.actorType,
        input.actorId.trim().slice(0, 120),
        input.actorKeyId ?? null,
        input.truckVisitId,
        document?.id ?? null,
        input.packageId,
        input.itemId ?? null,
        document?.rxoSiteKey ?? null,
        document?.rxoShipmentId ?? null,
        document?.rxoDirection ?? null,
        document?.documentVersion ?? null,
        input.route ?? null,
        input.printer ?? null,
        input.error ?? null,
        JSON.stringify(input.details ?? {}),
      ],
    );
  }

  async insertVisitEvent(
    manager: EntityManager,
    visitId: number,
    eventType: DriverPrintVisitEventType,
    actor: string,
    notes: string,
    occurredAt: Date,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO visit_events(truck_visit_id, event_type, occurred_at, actor, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [visitId, eventType, occurredAt, actor.trim().slice(0, 120), notes],
    );
  }

  assertIdempotencyKey(
    idempotencyKey: string | undefined,
  ): asserts idempotencyKey is string {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException(
        'X-Idempotency-Key is required and must be 16-128 safe characters.',
      );
    }
  }

  assertGuardActionKey(
    supplied: string | undefined,
    expected: unknown,
  ): void {
    const suppliedKey = String(supplied ?? '').trim().toLowerCase();
    const expectedKey = String(expected ?? '').trim().toLowerCase();
    const suppliedValid = UUID_PATTERN.test(suppliedKey);
    const expectedValid = UUID_PATTERN.test(expectedKey);
    const actual = suppliedValid ? suppliedKey : '0'.repeat(36);
    const wanted = expectedValid ? expectedKey : '1'.repeat(36);
    if (
      !suppliedValid ||
      !expectedValid ||
      !timingSafeEqual(Buffer.from(actual, 'ascii'), Buffer.from(wanted, 'ascii'))
    ) {
      throw new UnauthorizedException('Valid guard action credentials are required.');
    }
  }

  async lockAction(manager: EntityManager, key: string): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
  }

  async insertAgentIdempotency(
    manager: EntityManager,
    agentId: string,
    idempotencyKey: string,
    digest: string,
    response: DriverPrintPackageSummary,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO print_agent_idempotency(
         agent_id, idempotency_key, request_sha256, response_status, response_body
       ) VALUES ($1, $2, $3, 200, $4::jsonb)`,
      [agentId, idempotencyKey, digest, JSON.stringify(response)],
    );
  }

  offlineSeconds(): number {
    const value = Number(
      this.config.get('TRUCK_LOG_PRINT_AGENT_OFFLINE_SECONDS', '90'),
    );
    return Number.isInteger(value) && value >= 30 && value <= 3600 ? value : 90;
  }

  leaseSeconds(): number {
    const value = Number(
      this.config.get('TRUCK_LOG_PRINT_JOB_LEASE_SECONDS', '300'),
    );
    return Number.isInteger(value) && value >= 60 && value <= 900 ? value : 300;
  }
}
