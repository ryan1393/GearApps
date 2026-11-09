import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';
import { canonicalJsonSha256 as digest, returnedRows } from '@truck-log/server/data-access';
import type { AuthenticatedTruckLogPrincipal } from '@truck-log/server/auth/access';
import type { ReprintRxoDocumentDto } from './dto/reprint-rxo-document.dto';
import type { DriverPrintPackageSummary } from './driver-print.service';
import {
  MAX_PDF,
  SHA,
  UUID,
  key,
  oneUpdated,
  required,
  text,
  updateRows,
} from './automatic-driver-print.helpers';
import { AutomaticDriverPrintStore } from './automatic-driver-print.store';

/**
 * Human-initiated requests on automatic packages: the guard's explicit retry of
 * a failed item and an authorized RXO reprint as a separate audited package.
 * A plain class constructed by AutomaticDriverPrintService (not a Nest provider).
 */
export class AutomaticDriverPrintRequests {
  constructor(
    private readonly dataSource: DataSource,
    private readonly store: AutomaticDriverPrintStore,
  ) {}

  async retryIfOwned(
    packageId: string,
    itemType: 'DOCK_ASSIGNMENT' | 'RXO_DOCUMENT',
    idempotencyKey: string | undefined,
    guardKey: string | undefined,
  ): Promise<DriverPrintPackageSummary | null> {
    const exists = await this.dataSource.query(
      'SELECT id FROM automatic_driver_print_packages WHERE id=$1',
      [packageId],
    );
    if (!exists.length) return null;
    key(idempotencyKey);
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'automatic-retry:' + packageId + ':' + itemType,
      ]);
      const rows = await m.query(
        `SELECT j.*,p.agent_id,p.route,p.printer,p.truck_visit_id,v.client_request_id FROM automatic_driver_print_packages p
        JOIN automatic_driver_print_jobs j ON j.package_id=p.id JOIN truck_visits v ON v.id=p.truck_visit_id WHERE p.id=$1 AND j.item_type=$2 FOR UPDATE OF j`,
        [packageId, itemType],
      );
      const r = rows[0];
      required(r, 'Automatic print item not found.');
      const supplied = text(guardKey).toLowerCase(),
        expected = text(r.client_request_id).toLowerCase();
      if (
        !UUID.test(supplied) ||
        !UUID.test(expected) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        throw new UnauthorizedException('Original check-in action credentials are required.');
      const cancelled = await m.query('SELECT job_id FROM automatic_print_job_recoveries WHERE job_id=$1', [r.id]);
      required(!cancelled.length, 'This print job was cancelled or replaced and cannot be retried.');
      const prior = await m.query(
        'SELECT id FROM automatic_driver_print_attempts WHERE job_id=$1 AND request_key=$2',
        [r.id, idempotencyKey],
      );
      if (prior.length) return this.store.summary(m, packageId);
      required(
        r.status === 'FAILED',
        'Only an explicitly failed item can be retried. Check the physical printer before retrying an uncertain result.',
      );
      const identity = this.store.identity();
      required(
        identity.agentId === r.agent_id && identity.route === r.route,
        'Frozen agent/route changed; no automatic reroute.',
      );
      const online = await m.query(
        `SELECT agent_id FROM print_agents WHERE agent_id=$1 AND enabled=TRUE AND last_seen_at>=NOW()-($2::int*INTERVAL '1 second')
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(configured_routes) x WHERE x->>'route'=$3 AND x->>'outputPrinter'=$4)`,
        [r.agent_id, this.store.offlineSeconds(), r.route, r.printer],
      );
      if (online.length !== 1)
        throw new ServiceUnavailableException(
          'The exact frozen printer is not currently advertised online.',
        );
      const n = Number(r.attempt_count) + 1;
      const u = returnedRows(await m.query(
        `UPDATE automatic_driver_print_jobs SET status='QUEUED',attempt_count=$2,last_error=NULL,printed_at=NULL,
        lease_token_sha256=NULL,leased_at=NULL,lease_expires_at=NULL,updated_at=NOW() WHERE id=$1 AND status='FAILED' RETURNING id`,
        [r.id, n],
      ));
      oneUpdated(u, r.id);
      await m.query(
        'INSERT INTO automatic_driver_print_attempts(job_id,attempt_number,request_key) VALUES($1,$2,$3)',
        [r.id, n, idempotencyKey],
      );
      if (itemType === 'RXO_DOCUMENT')
        await m.query(
          "UPDATE visit_documents SET print_status='PENDING',print_error=NULL,updated_at=NOW() WHERE id=$1",
          [r.visit_document_id],
        );
      await this.store.audit(
        m,
        r.truck_visit_id,
        'AUTO_PRINT_RETRY_REQUESTED',
        'GUARD',
        `Explicit retry for ${itemType}; job ${r.id}; attempt ${n}; frozen printer ${r.printer}.`,
      );
      return this.store.summary(m, packageId);
    });
  }

  /** Authorized reprints are separate audited packages. Original history is immutable. */
  async reprintIfOwned(
    visitId: number,
    principal: AuthenticatedTruckLogPrincipal,
    idempotencyKey: string | undefined,
    input: ReprintRxoDocumentDto,
  ): Promise<DriverPrintPackageSummary | null> {
    const packets = await this.dataSource.query(
      "SELECT * FROM automatic_driver_print_packages WHERE truck_visit_id=$1 AND request_kind='ORIGINAL'",
      [visitId],
    );
    if (!packets.length) return null;
    key(idempotencyKey);
    const requestHash = digest({
      operation: 'AUTO_RXO_REPRINT_V1',
      keyId: principal.keyId,
      visitId,
      documentId: input.documentId,
      reason: text(input.reason),
    });
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        principal.keyId + ':' + idempotencyKey,
      ]);
      const touched = returnedRows(await m.query(
        `UPDATE truck_log_access_credentials SET last_used_at=NOW()
        WHERE key_id=$1 AND active=TRUE AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())
        AND scopes @> '["rxo-documents:reprint"]'::jsonb RETURNING subject_id,display_name`,
        [principal.keyId],
      ));
      const people = updateRows<{ subject_id: string; display_name: string }>(touched);
      if (people.length !== 1)
        throw new UnauthorizedException('Active RXO reprint credentials are required.');
      // Serialize separate explicit requests for this original visit before the in-progress check.
      const packetLock = await m.query(
        'SELECT id FROM automatic_driver_print_packages WHERE id=$1 FOR UPDATE',
        [packets[0].id],
      );
      required(packetLock.length === 1, 'The original automatic print package is missing.');
      const requestKey =
        'reprint-' + digest({ keyId: principal.keyId, idempotencyKey }).slice(0, 64);
      const durable = await m.query(
        'SELECT id,request_sha256 FROM automatic_driver_print_packages WHERE request_key=$1',
        [requestKey],
      );
      if (durable.length) {
        required(
          durable[0].request_sha256 === requestHash,
          'Reprint key was used with different content.',
        );
        return this.store.summary(m, durable[0].id);
      }
      const original = packets[0],
        identity = this.store.identity();
      required(
        identity.agentId === original.agent_id && identity.route === original.route,
        'Frozen agent or route changed. Reprint cannot select a different printer.',
      );
      const live = await m.query(
        `SELECT agent_id FROM print_agents WHERE agent_id=$1 AND enabled=TRUE AND last_seen_at>=NOW()-($2::int*INTERVAL '1 second')
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(configured_routes) x WHERE x->>'route'=$3 AND x->>'outputPrinter'=$4)`,
        [original.agent_id, this.store.offlineSeconds(), original.route, original.printer],
      );
      if (live.length !== 1)
        throw new ServiceUnavailableException('The exact frozen printer is unavailable.');
      const docs = await m.query(
        `SELECT * FROM visit_documents WHERE id=$1 AND truck_visit_id=$2
        AND document_type='RXO_DRIVER_DOCUMENT' AND source_kind='MATERIALS_UPLOAD'
        AND storage_status='STORED' AND mime_type='application/pdf' FOR SHARE`,
        [input.documentId, visitId],
      );
      const doc = docs[0];
      required(
        doc &&
          SHA.test(text(doc.sha256)) &&
          Number(doc.file_size_bytes) > 8 &&
          Number(doc.file_size_bytes) <= MAX_PDF &&
          text(doc.file_name).length <= 255,
        'The requested RXO document is not associated with this visit or cannot be printed.',
      );
      const busy = await m.query(
        "SELECT id FROM automatic_driver_print_jobs WHERE visit_document_id=$1 AND status IN ('QUEUED','LEASED')",
        [input.documentId],
      );
      required(
        !busy.length,
        'This RXO document already has an in-progress print. Resolve it before requesting another copy.',
      );
      const packageId = randomUUID(),
        jobId = randomUUID();
      await m.query(
        `INSERT INTO automatic_driver_print_packages(id,truck_visit_id,gate,agent_id,route,printer,requested_by,request_kind,original_package_id,request_key,request_sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7,'REPRINT',$8,$9,$10)`,
        [
          packageId,
          visitId,
          original.gate,
          original.agent_id,
          original.route,
          original.printer,
          people[0].subject_id,
          original.id,
          requestKey,
          requestHash,
        ],
      );
      await m.query(
        `INSERT INTO automatic_driver_print_jobs(id,package_id,item_type,visit_document_id,file_name,file_size_bytes,sha256)
        VALUES($1,$2,'RXO_DOCUMENT',$3,$4,$5,$6)`,
        [
          jobId,
          packageId,
          input.documentId,
          doc.file_name,
          Number(doc.file_size_bytes),
          doc.sha256,
        ],
      );
      await m.query(
        'INSERT INTO automatic_driver_print_attempts(job_id,attempt_number,request_key) VALUES($1,1,$2)',
        [jobId, 'original-' + jobId],
      );
      await this.store.audit(
        m,
        visitId,
        'AUTO_RXO_REPRINT_REQUESTED',
        people[0].subject_id,
        `Authorized reprint package ${packageId}; original ${original.id}; frozen printer ${original.printer}; reason ${text(input.reason).slice(0, 1000)}.`,
      );
      return this.store.summary(m, packageId);
    });
  }

}
