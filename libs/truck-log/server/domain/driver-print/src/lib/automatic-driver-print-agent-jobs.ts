import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { DataSource, EntityManager } from 'typeorm';
import {
  canonicalJsonSha256 as digest,
  safeDigestEqual as equalHash, returnedRows } from '@truck-log/server/data-access';
import { SapDocumentStorageService, readVerifiedRxoPdf } from '@truck-log/server/infrastructure/sap-documents';
import type { AuthenticatedPrintAgent } from '@truck-log/server/auth/print-agent';
import type { PrintAgentJobResultDto } from './dto/print-agent-job-result.dto';
import type { PrintAgentDocumentDownload, DriverPrintPackageSummary } from './driver-print.service';
import { dockPdfSha } from './automatic-dock-slip';
import {
  MAX_PDF,
  SHA,
  UNCERTAIN,
  automaticRxoReadError,
  key,
  oneUpdated,
  required,
  text,
  updateRows,
  type FrozenJob,
} from './automatic-driver-print.helpers';
import { AutomaticDriverPrintStore } from './automatic-driver-print.store';
import { MAX_CLOCK_SKEW_MS } from './driver-print.types';
import { decideAgentResult, resultSubmittedWithinLease } from './print-agent-late-result';

/**
 * Print Agent side of automatic Driver Print: claim the next frozen job with a
 * hashed lease token, serve its verified bytes, and record the reported result.
 * A plain class constructed by AutomaticDriverPrintService (not a Nest provider).
 */
export class AutomaticDriverPrintAgentJobs {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: SapDocumentStorageService,
    private readonly store: AutomaticDriverPrintStore,
  ) {}

  async tryClaim(
    manager: EntityManager,
    agent: AuthenticatedPrintAgent,
    routes: string[],
    idempotencyKey: string,
    derive: (job: FrozenJob) => string,
  ): Promise<{ job: FrozenJob & { claimToken: string } } | null> {
    const { agentId, route } = this.store.identity();
    if (agent.agentId !== agentId || !routes.includes(route)) return null;
    const credentials = await manager.query(
      `SELECT key_id FROM print_agent_credentials WHERE key_id=$1 AND agent_id=$2
      AND active=TRUE AND revoked_at IS NULL AND scopes @> '["print-jobs:poll"]'::jsonb FOR SHARE`,
      [agent.keyId, agent.agentId],
    );
    if (credentials.length !== 1)
      throw new UnauthorizedException('Active Print Agent polling permission is required.');
    await this.store.expire(manager);
    const rows = await manager.query(
      `SELECT j.*,p.agent_id,p.route,p.printer FROM automatic_driver_print_jobs j
      JOIN automatic_driver_print_packages p ON p.id=j.package_id JOIN print_agents a ON a.agent_id=p.agent_id
      WHERE j.status='QUEUED' AND p.agent_id=$1 AND p.route=$2 AND a.enabled=TRUE
      AND a.last_seen_at>=NOW()-($3::int*INTERVAL '1 second')
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.configured_routes) r WHERE r->>'route'=p.route AND r->>'outputPrinter'=p.printer)
      AND (j.item_type='DOCK_ASSIGNMENT' OR NOT EXISTS(SELECT 1 FROM automatic_driver_print_jobs dock WHERE dock.package_id=p.id AND dock.item_type='DOCK_ASSIGNMENT' AND dock.status IN ('QUEUED','LEASED')))
      ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
      [agentId, route, this.store.offlineSeconds()],
    );
    if (!rows.length) return null;
    const r = rows[0],
      now = new Date(),
      expires = new Date(now.getTime() + this.store.leaseSeconds() * 1000);
    const job: FrozenJob = {
      itemId: r.id,
      packageId: r.package_id,
      attemptNumber: Number(r.attempt_count),
      route: r.route,
      printer: r.printer,
      fileName: r.file_name,
      fileSizeBytes: Number(r.file_size_bytes),
      sha256: r.sha256,
      leaseExpiresAt: expires.toISOString(),
      downloadUrl: `/api/v1/print-agents/jobs/${r.id}/document`,
    };
    const token = derive(job);
    required(SHA.test(token), 'Invalid generated print lease token.');
    const hash = createHash('sha256').update(token).digest('hex');
    const changed = returnedRows(await manager.query(
      `UPDATE automatic_driver_print_jobs SET status='LEASED',lease_token_sha256=$2,leased_at=$3,lease_expires_at=$4,updated_at=$3 WHERE id=$1 AND status='QUEUED' RETURNING id`,
      [r.id, hash, now, expires],
    ));
    oneUpdated(changed, r.id);
    const attempt = returnedRows(await manager.query(
      `UPDATE automatic_driver_print_attempts SET status='LEASED',lease_token_sha256=$3,leased_at=$4,claim_key=$5
      WHERE job_id=$1 AND attempt_number=$2 AND status='REQUESTED' RETURNING id`,
      [r.id, r.attempt_count, hash, now, idempotencyKey],
    ));
    required(updateRows(attempt).length === 1, 'Automatic print attempt could not be leased.');
    return { job: { ...job, claimToken: token } };
  }

  async downloadIfOwned(
    agent: AuthenticatedPrintAgent,
    itemId: string,
    token: string | undefined,
  ): Promise<PrintAgentDocumentDownload | null> {
    const rows = await this.dataSource.query(
      `SELECT j.*,p.agent_id,p.truck_visit_id,d.relative_path FROM automatic_driver_print_jobs j
      JOIN automatic_driver_print_packages p ON p.id=j.package_id LEFT JOIN visit_documents d ON d.id=j.visit_document_id WHERE j.id=$1`,
      [itemId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    this.checkClaim(r, agent, token);
    if (r.status !== 'LEASED' || new Date(r.lease_expires_at).getTime() <= Date.now())
      throw new ConflictException('Automatic print lease expired or is not active.');
    let bytes: Buffer,
      absolutePath = '';
    if (r.item_type === 'DOCK_ASSIGNMENT') {
      required(Buffer.isBuffer(r.pdf_bytes), 'Frozen Dock Assignment bytes are missing.');
      bytes = r.pdf_bytes;
    } else {
      const rel = text(r.relative_path);
      required(
        rel.startsWith('rxo/') && !isAbsolute(rel) && !rel.split(/[\\/]/).includes('..'),
        'Invalid RXO document path.',
      );
      await this.storage.ensureRxoNamespace();
      // Shared confined, no-follow, descriptor-anchored reader; the SHA-256 and
      // PDF-shape checks below keep this route's own error messages.
      try {
        const verified = await readVerifiedRxoPdf(this.storage, rel, Number(r.file_size_bytes));
        bytes = verified.buffer;
        absolutePath = verified.canonicalPath;
      } catch (error) {
        throw automaticRxoReadError(error);
      }
    }
    required(
      bytes.length === Number(r.file_size_bytes) &&
        bytes.length <= MAX_PDF &&
        bytes.subarray(0, 5).toString() === '%PDF-' &&
        bytes.subarray(-2048).includes(Buffer.from('%%EOF')) &&
        equalHash(dockPdfSha(bytes), r.sha256),
      'Frozen PDF integrity validation failed.',
    );
    // Recheck the lease after storage IO; a late response must not start a new print.
    if (new Date(r.lease_expires_at).getTime() <= Date.now())
      throw new ConflictException('Automatic print lease expired during download.');
    return {
      absolutePath,
      fileName: r.file_name,
      fileSizeBytes: bytes.length,
      sha256: r.sha256,
      stream: Readable.from([bytes]),
    };
  }
  private checkClaim(
    r: { agent_id: string; lease_token_sha256: string | null },
    agent: AuthenticatedPrintAgent,
    token: unknown,
  ): void {
    if (
      typeof token !== 'string' ||
      !SHA.test(token) ||
      r.agent_id !== agent.agentId ||
      !equalHash(createHash('sha256').update(token).digest('hex'), text(r.lease_token_sha256))
    )
      throw new UnauthorizedException('Invalid automatic print job claim.');
  }

  async reportIfOwned(
    agent: AuthenticatedPrintAgent,
    itemId: string,
    idempotencyKey: string | undefined,
    input: PrintAgentJobResultDto,
  ): Promise<DriverPrintPackageSummary | null> {
    const exists = await this.dataSource.query(
      'SELECT id FROM automatic_driver_print_jobs WHERE id=$1',
      [itemId],
    );
    if (!exists.length) return null;
    key(idempotencyKey);
    const submitted = new Date(input.submittedAt);
    if (!Number.isFinite(submitted.getTime()) || submitted.getTime() > Date.now() + MAX_CLOCK_SKEW_MS)
      throw new BadRequestException('Invalid print result time.');
    const hash = digest({
      operation: 'AUTO_PRINT_RESULT_V1',
      agentId: agent.agentId,
      itemId,
      input,
    });
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        agent.agentId + ':' + idempotencyKey,
      ]);
      const previous = await m.query(
        'SELECT request_sha256,response_body FROM print_agent_idempotency WHERE agent_id=$1 AND idempotency_key=$2',
        [agent.agentId, idempotencyKey],
      );
      if (previous.length) {
        required(
          previous[0].request_sha256 === hash,
          'Print result key was reused with different content.',
        );
        return previous[0].response_body;
      }
      const rows = await m.query(
        `SELECT j.*,p.agent_id,p.route,p.printer,p.truck_visit_id FROM automatic_driver_print_jobs j JOIN automatic_driver_print_packages p ON p.id=j.package_id WHERE j.id=$1 FOR UPDATE OF j`,
        [itemId],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Automatic print job not found.');
      this.checkClaim(r, agent, input.claimToken);
      required(
        r.printer === input.printer.trim(),
        'Result printer does not match the frozen gate printer.',
      );
      if (r.status === 'LEASED')
        required(
          submitted.getTime() >= new Date(r.leased_at).getTime() - MAX_CLOCK_SKEW_MS,
          'Print result predates the lease.',
        );
      // A result finished inside its lease is recorded as reported even when it
      // arrives late (durable agent outbox); see print-agent-late-result.ts.
      const decision = decideAgentResult({
        status: r.status,
        leaseExpired: new Date(r.lease_expires_at).getTime() <= Date.now(),
        inTime: resultSubmittedWithinLease({
          leasedAt: r.leased_at,
          leaseExpiresAt: r.lease_expires_at,
          submittedAtMs: submitted.getTime(),
          skewMs: MAX_CLOCK_SKEW_MS,
        }),
        expiredByMonitor: r.status === 'FAILED' && (await this.store.expiredByMonitor(m, r)),
        success: input.success,
      });
      required(decision !== 'CONFLICT_FINAL', 'A different final print result is already recorded.');
      required(decision !== 'NOT_LEASED', 'Automatic print item is not leased.');
      const state = input.success ? 'PRINTED' : 'FAILED';
      const error = input.success
        ? null
        : text(input.error) || 'Agent reported a failed print before submission.';
      if (decision === 'EXPIRE_UNCERTAIN')
        await this.store.finish(m, r, 'FAILED', UNCERTAIN, new Date(), agent.agentId, idempotencyKey);
      else if (decision === 'RECORD')
        await this.store.finish(m, r, state, error, submitted, agent.agentId, idempotencyKey);
      else if (decision === 'REPLACE_MONITOR_FAILURE')
        await this.store.replaceMonitorFailure(m, r, state, error, submitted, agent.agentId, idempotencyKey);
      const response = await this.store.summary(m, r.package_id);
      await m.query(
        `INSERT INTO print_agent_idempotency(agent_id,idempotency_key,request_sha256,response_status,response_body)
        VALUES($1,$2,$3,200,$4::jsonb)`,
        [agent.agentId, idempotencyKey, hash, JSON.stringify(response)],
      );
      return response;
    });
  }
}
