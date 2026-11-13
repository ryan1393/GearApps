import { returnedRows } from '@truck-log/server/data-access';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthenticatedPrintAgent } from '@truck-log/server/auth/print-agent';
import { PrintAgentJobClaimDto } from './dto/print-agent-job-claim.dto';
import { AutomaticDriverPrintService } from './automatic-driver-print.service';
import { DriverPrintAgentLeases } from './driver-print-agent-leases';
import { DriverPrintStore } from './driver-print.store';
import type { AgentClaimResponse, PersistedAgentPrintJob } from './driver-print.types';
import { requestDigest } from './driver-print.utils';

/**
 * Print Agent job claim: idempotent, one locked job per claim, with a hashed
 * short-lived lease token. Automatic packages are offered first.
 * A plain class constructed by DriverPrintAgentOperations (not a Nest provider).
 */
export class DriverPrintAgentClaim {
  constructor(
    private readonly dataSource: DataSource,
    private readonly automatic: AutomaticDriverPrintService,
    private readonly store: DriverPrintStore,
    private readonly leases: DriverPrintAgentLeases,
  ) {}

  async claimAgentJob(
    agent: AuthenticatedPrintAgent,
    idempotencyKey: string | undefined,
    input: PrintAgentJobClaimDto,
  ): Promise<AgentClaimResponse> {
    this.store.assertIdempotencyKey(idempotencyKey);
    if (!input.agentVersion.trim() || input.routes.some((route) => !route.trim())) {
      throw new BadRequestException(
        'agentVersion and every requested route must contain non-whitespace characters.',
      );
    }
    await this.leases.expireLeases();
    const routes = [...new Set(input.routes.map((route) => route.trim()))].sort();
    const digest = requestDigest({
      operation: 'PRINT_JOB_CLAIM',
      agentId: agent.agentId,
      routes,
      agentVersion: input.agentVersion.trim(),
    });

    const response = await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `${agent.agentId}:${idempotencyKey}`,
      ]);
      await manager.query(
        `DELETE FROM print_agent_idempotency
          WHERE ctid IN (
            SELECT ctid
              FROM print_agent_idempotency
             WHERE agent_id = $1 AND expires_at < NOW()
             ORDER BY expires_at
             LIMIT 1000
          )`,
        [agent.agentId],
      );
      const credential = returnedRows(await manager.query(
        `UPDATE print_agent_credentials
            SET last_used_at = NOW()
          WHERE key_id = $1 AND agent_id = $2 AND active = TRUE
            AND revoked_at IS NULL
            AND scopes @> '["print-jobs:poll"]'::jsonb
          RETURNING key_id`,
        [agent.keyId, agent.agentId],
      ));
      if (!credential[0]) {
        throw new UnauthorizedException('This Print Agent credential is no longer active.');
      }
      const touched = returnedRows(await manager.query(
        `UPDATE print_agents
            SET last_seen_at = NOW(), agent_version = $2, updated_at = NOW()
          WHERE agent_id = $1 AND enabled = TRUE
          RETURNING agent_id`,
        [agent.agentId, input.agentVersion.trim()],
      ));
      if (!touched[0]) {
        throw new UnauthorizedException('This Print Agent is disabled or no longer exists.');
      }
      const existing = await manager.query(
        `SELECT request_sha256, response_body
           FROM print_agent_idempotency
          WHERE agent_id = $1 AND idempotency_key = $2`,
        [agent.agentId, idempotencyKey],
      );
      if (existing[0]) {
        if (existing[0].request_sha256 !== digest) {
          throw new ConflictException(
            'This X-Idempotency-Key was already used with a different Print Agent request.',
          );
        }
        return this.store.restoreAgentClaimResponse(
          agent.agentId,
          idempotencyKey,
          digest,
          existing[0].response_body,
        );
      }

      const configured = this.store.driverPrintConfiguration();
      let body: AgentClaimResponse = await this.automatic.tryClaim(
        manager, agent, routes, idempotencyKey,
        job => this.store.deriveAgentClaimToken(agent.agentId, idempotencyKey, digest, job),
      ) || { job: null };
      if (
        !body.job && configured.valid &&
        configured.agentId === agent.agentId &&
        configured.route &&
        routes.includes(configured.route)
      ) {
        const queued = await manager.query(
          `SELECT item.id AS item_id, item.package_id, item.attempt_count,
                  item.route, item.printer, document.file_name,
                  document.file_size_bytes, document.sha256
             FROM driver_print_items item
             JOIN driver_print_packages package ON package.id = item.package_id
             JOIN visit_documents document ON document.id = item.visit_document_id
            WHERE item.item_type = 'RXO_DOCUMENT'
              AND item.status = 'QUEUED'
              AND item.assigned_agent_id = $1
              AND item.route = $2
              AND EXISTS (
                SELECT 1 FROM print_agents owner
                 WHERE owner.agent_id = $1 AND owner.enabled = TRUE
                   AND EXISTS (SELECT 1 FROM jsonb_array_elements(owner.configured_routes) r
                     WHERE r->>'route' = item.route AND r->>'outputPrinter' = item.printer)
              )
              AND document.document_type = 'RXO_DRIVER_DOCUMENT'
              AND document.source_kind = 'MATERIALS_UPLOAD'
              AND document.storage_status = 'STORED'
              AND document.mime_type = 'application/pdf'
              AND document.relative_path LIKE 'rxo/%'
            ORDER BY item.created_at, item.id
            LIMIT 1
            FOR UPDATE OF item SKIP LOCKED`,
          [agent.agentId, configured.route],
        );
        const job = queued[0];
        if (job) {
          const now = new Date();
          const leaseExpiresAt = new Date(now.getTime() + this.store.leaseSeconds() * 1000);
          const persistedJob: PersistedAgentPrintJob = {
            itemId: String(job.item_id),
            packageId: String(job.package_id),
            attemptNumber: Number(job.attempt_count),
            route: String(job.route),
            printer: String(job.printer),
            fileName: String(job.file_name),
            fileSizeBytes: Number(job.file_size_bytes),
            sha256: String(job.sha256),
            leaseExpiresAt: leaseExpiresAt.toISOString(),
            downloadUrl: `/api/v1/print-agents/jobs/${job.item_id}/document`,
          };
          const claimToken = this.store.deriveAgentClaimToken(
            agent.agentId,
            idempotencyKey,
            digest,
            persistedJob,
          );
          const tokenSha256 = createHash('sha256')
            .update(claimToken, 'utf8')
            .digest('hex');
          const itemUpdate = returnedRows(await manager.query(
            `UPDATE driver_print_items
                SET status = 'LEASED', lease_token_sha256 = $2,
                    leased_at = $3, lease_expires_at = $4, updated_at = $3
              WHERE id = $1 AND status = 'QUEUED'
              RETURNING id`,
            [job.item_id, tokenSha256, now, leaseExpiresAt],
          ));
          if (!itemUpdate[0]) {
            throw new ConflictException('The selected Print Agent job is no longer queued.');
          }
          const attemptUpdate = returnedRows(await manager.query(
            `UPDATE driver_print_attempts
                SET status = 'LEASED', agent_id = $3,
                    lease_token_sha256 = $4, leased_at = $5,
                    details = details || $6::jsonb
              WHERE item_id = $1 AND attempt_number = $2 AND status = 'REQUESTED'
              RETURNING id`,
            [
              job.item_id,
              Number(job.attempt_count),
              agent.agentId,
              tokenSha256,
              now,
              JSON.stringify({ agentVersion: input.agentVersion.trim() }),
            ],
          ));
          if (!attemptUpdate[0]) {
            throw new ConflictException('The Print Agent attempt is not available for leasing.');
          }
          await this.store.refreshPackageStatus(manager, String(job.package_id));
          body = {
            job: {
              ...persistedJob,
              claimToken,
            },
          };
        }
      }

      const persistedResponse = this.store.agentClaimResponseForPersistence(body);
      await manager.query(
        `INSERT INTO print_agent_idempotency(
           agent_id, idempotency_key, request_sha256, response_status,
           response_body, expires_at
         ) VALUES ($1, $2, $3, 200, $4::jsonb, NOW() + INTERVAL '30 minutes')`,
        [agent.agentId, idempotencyKey, digest, JSON.stringify(persistedResponse)],
      );
      return body;
    });
    return response;
  }
}
