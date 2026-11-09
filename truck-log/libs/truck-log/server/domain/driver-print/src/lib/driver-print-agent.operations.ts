import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthenticatedPrintAgent } from '@truck-log/server/auth/print-agent';
import {
  SapDocumentStorageService,
  readVerifiedRxoPdf,
} from '@truck-log/server/infrastructure/sap-documents';
import { PrintAgentJobClaimDto } from './dto/print-agent-job-claim.dto';
import { PrintAgentJobResultDto } from './dto/print-agent-job-result.dto';
import { AutomaticDriverPrintService } from './automatic-driver-print.service';
import { DriverPrintAgentClaim } from './driver-print-agent-claim';
import { DriverPrintAgentLeases } from './driver-print-agent-leases';
import { DriverPrintAgentResults } from './driver-print-agent-results';
import { DriverPrintStore } from './driver-print.store';
import type { AgentClaimResponse, DriverPrintPackageSummary, PersistedAgentPrintJob, PrintAgentDocumentDownload } from './driver-print.types';
import {
  EXPIRED_LEASE_ERROR,
  MAX_CLOCK_SKEW_MS,
  SHA256_PATTERN,
} from './driver-print.types';
import { requestDigest, safeDigestEqual } from './driver-print.utils';
import { decideAgentResult, resultSubmittedWithinLease } from './print-agent-late-result';

/**
 * Print Agent wire operations for legacy Driver Print jobs: claim (delegated
 * to DriverPrintAgentClaim), immutable document download, result reporting,
 * and lease failure (delegated to DriverPrintAgentLeases).
 */
export class DriverPrintAgentOperations {
  private readonly leases: DriverPrintAgentLeases;
  private readonly claim: DriverPrintAgentClaim;
  private readonly results: DriverPrintAgentResults;

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: SapDocumentStorageService,
    private readonly automatic: AutomaticDriverPrintService,
    private readonly store: DriverPrintStore,
  ) {
    this.leases = new DriverPrintAgentLeases(this.dataSource, this.store);
    this.claim = new DriverPrintAgentClaim(this.dataSource, this.automatic, this.store, this.leases);
    this.results = new DriverPrintAgentResults(this.store);
  }

  async claimAgentJob(
    agent: AuthenticatedPrintAgent,
    idempotencyKey: string | undefined,
    input: PrintAgentJobClaimDto,
  ): Promise<AgentClaimResponse> {
    return this.claim.claimAgentJob(agent, idempotencyKey, input);
  }

  async documentForAgent(
    agent: AuthenticatedPrintAgent,
    itemId: string,
    claimToken: string | undefined,
  ): Promise<PrintAgentDocumentDownload> {
    const automaticDocument = await this.automatic.downloadIfOwned(agent, itemId, claimToken);
    if (automaticDocument) return automaticDocument;

    if (!claimToken || !SHA256_PATTERN.test(claimToken)) {
      throw new UnauthorizedException('A valid X-Print-Claim-Token is required.');
    }
    await this.expireLeases();
    const rows = await this.dataSource.query(
      `SELECT item.id, item.status, item.assigned_agent_id,
              item.lease_token_sha256, item.lease_expires_at,
              document.file_name, document.relative_path, document.mime_type,
              document.file_size_bytes, document.sha256
         FROM driver_print_items item
         JOIN visit_documents document ON document.id = item.visit_document_id
        WHERE item.id = $1
          AND item.item_type = 'RXO_DOCUMENT'
          AND document.document_type = 'RXO_DRIVER_DOCUMENT'
          AND document.source_kind = 'MATERIALS_UPLOAD'
          AND document.storage_status = 'STORED'`,
      [itemId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Print Agent document job was not found.');
    const suppliedDigest = createHash('sha256').update(claimToken, 'utf8').digest('hex');
    if (
      row.assigned_agent_id !== agent.agentId ||
      row.status !== 'LEASED' ||
      !safeDigestEqual(suppliedDigest, String(row.lease_token_sha256 ?? '')) ||
      new Date(row.lease_expires_at).getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('This Print Agent claim is not valid for the document.');
    }

    const fileName = String(row.file_name ?? 'rxo-driver-document.pdf');
    const relativePath = String(row.relative_path ?? '');
    const expectedSize = Number(row.file_size_bytes);
    const expectedSha256 = String(row.sha256 ?? '');
    if (
      row.mime_type !== 'application/pdf' ||
      !relativePath.startsWith('rxo/') ||
      !Number.isSafeInteger(expectedSize) ||
      expectedSize <= 0 ||
      expectedSize > this.storage.maxBytes() ||
      !SHA256_PATTERN.test(expectedSha256)
    ) {
      const message = 'The frozen RXO document metadata failed secure download validation.';
      await this.failLeasedItemFromServer(itemId, agent.agentId, message);
      throw new ConflictException(message);
    }

    let absolutePath: string;
    let pdfBuffer: Buffer;
    try {
      // Confined, no-follow, descriptor-anchored read with size and SHA-256 checks
      // (resolveRxoPath + canonical namespace + O_NOFOLLOW + /proc/self/fd).
      const verified = await readVerifiedRxoPdf(
        this.storage,
        relativePath,
        expectedSize,
        expectedSha256,
      );
      pdfBuffer = verified.buffer;
      absolutePath = verified.canonicalPath;
    } catch {
      const message = 'The frozen RXO document failed immutable storage integrity validation.';
      await this.failLeasedItemFromServer(itemId, agent.agentId, message);
      throw new ConflictException(message);
    }

    return {
      absolutePath,
      fileName,
      fileSizeBytes: expectedSize,
      sha256: expectedSha256,
      stream: Readable.from([pdfBuffer]),
    };
  }

  async recordAgentResult(
    agent: AuthenticatedPrintAgent,
    itemId: string,
    idempotencyKey: string | undefined,
    input: PrintAgentJobResultDto,
  ): Promise<DriverPrintPackageSummary> {
    const automaticResult = await this.automatic.reportIfOwned(agent, itemId, idempotencyKey, input);
    if (automaticResult) return automaticResult;

    this.store.assertIdempotencyKey(idempotencyKey);
    const now = new Date();
    const submittedAt = new Date(input.submittedAt);
    if (!Number.isFinite(submittedAt.getTime())) {
      throw new BadRequestException('submittedAt is invalid.');
    }
    if (submittedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
      throw new BadRequestException('submittedAt cannot be more than five minutes in the future.');
    }
    await this.expireLeases();
    const digest = requestDigest({
      operation: 'PRINT_JOB_RESULT',
      agentId: agent.agentId,
      itemId,
      result: input,
    });

    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `${agent.agentId}:${idempotencyKey}`,
      ]);
      const previous = await manager.query(
        `SELECT request_sha256, response_body
           FROM print_agent_idempotency
          WHERE agent_id = $1 AND idempotency_key = $2`,
        [agent.agentId, idempotencyKey],
      );
      if (previous[0]) {
        if (previous[0].request_sha256 !== digest) {
          throw new ConflictException(
            'This X-Idempotency-Key was already used with a different Print Agent result.',
          );
        }
        return previous[0].response_body as DriverPrintPackageSummary;
      }

      const rows = await manager.query(
        `SELECT item.id AS item_id, item.package_id, item.status,
                item.assigned_agent_id, item.lease_token_sha256,
                item.leased_at, item.lease_expires_at, item.attempt_count,
                item.printer, item.route, item.last_error,
                package.truck_visit_id, package.request_kind,
                item.visit_document_id
           FROM driver_print_items item
           JOIN driver_print_packages package ON package.id = item.package_id
          WHERE item.id = $1 AND item.item_type = 'RXO_DOCUMENT'
          FOR UPDATE OF item`,
        [itemId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException('Print Agent job was not found.');
      const suppliedTokenSha256 = createHash('sha256')
        .update(input.claimToken, 'utf8')
        .digest('hex');
      if (
        row.assigned_agent_id !== agent.agentId ||
        !safeDigestEqual(suppliedTokenSha256, String(row.lease_token_sha256 ?? ''))
      ) {
        throw new UnauthorizedException('This Print Agent claim is not valid for the job.');
      }
      if (String(row.printer) !== input.printer.trim()) {
        throw new BadRequestException(
          'The reported printer does not match the server-owned frozen print job.',
        );
      }

      // A result finished inside its lease is recorded as reported even when it
      // arrives late (durable agent outbox); see print-agent-late-result.ts.
      const decisionAt = new Date();
      const leaseExpired = new Date(row.lease_expires_at).getTime() <= decisionAt.getTime();
      const decision = decideAgentResult({
        status: String(row.status),
        leaseExpired,
        inTime: resultSubmittedWithinLease({
          leasedAt: row.leased_at,
          leaseExpiresAt: row.lease_expires_at,
          submittedAtMs: submittedAt.getTime(),
          skewMs: MAX_CLOCK_SKEW_MS,
        }),
        expiredByMonitor: await this.results.expiredByMonitor(manager, row),
        success: input.success,
      });
      if (decision === 'CONFLICT_FINAL') {
        throw new ConflictException('The Print Agent job already has a different final result.');
      }
      if (decision === 'NOT_LEASED') {
        throw new ConflictException('The Print Agent job is not leased.');
      }
      if (decision === 'REPLAY_FINAL' || decision === 'EXPIRE_UNCERTAIN') {
        if (decision === 'EXPIRE_UNCERTAIN') {
          await this.failLockedLeasedItem(
            manager,
            row,
            EXPIRED_LEASE_ERROR,
            'SYSTEM',
            'TRUCK_LOG_LEASE_MONITOR',
            decisionAt,
          );
        }
        const final = await this.store.summaryByPackageId(manager, String(row.package_id));
        await this.store.insertAgentIdempotency(
          manager,
          agent.agentId,
          idempotencyKey,
          digest,
          final,
        );
        return final;
      }
      if (
        decision === 'RECORD' &&
        row.leased_at &&
        submittedAt.getTime() < new Date(row.leased_at).getTime() - MAX_CLOCK_SKEW_MS
      ) {
        throw new BadRequestException('submittedAt predates this print-job lease.');
      }
      return this.results.record(
        manager,
        agent,
        row,
        String(idempotencyKey),
        digest,
        input,
        submittedAt,
        now,
        decision === 'REPLACE_MONITOR_FAILURE'
          ? 'REPLACES_MONITOR_FAILURE'
          : leaseExpired
            ? 'AFTER_EXPIRY'
            : 'IN_LEASE',
      );
    });
  }

  async expireLeases(): Promise<void> {
    await this.leases.expireLeases();
  }

  async failLeasedItemFromServer(
    itemId: string,
    agentId: string,
    error: string,
  ): Promise<void> {
    await this.leases.failLeasedItemFromServer(itemId, agentId, error);
  }

  async failLockedLeasedItem(
    manager: EntityManager,
    row: Record<string, unknown>,
    error: string,
    actorType: 'HUMAN' | 'PRINT_AGENT' | 'SYSTEM',
    actorId: string,
    now: Date,
  ): Promise<void> {
    await this.leases.failLockedLeasedItem(manager, row, error, actorType, actorId, now);
  }
}
