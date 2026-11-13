import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { canonicalJson } from '@truck-log/server/data-access';
import { AuthenticatedPrintAgent } from '@truck-log/server/auth/print-agent';
import { PrintAgentHeartbeatDto } from './dto/print-agent-heartbeat.dto';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function parseAgentDate(value: string | undefined, field: string, now: Date): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new BadRequestException(`${field} is invalid.`);
  if (parsed.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw new BadRequestException(`${field} cannot be more than five minutes in the future.`);
  }
  return parsed;
}

/** TypeORM PostgreSQL UPDATE returns [rows, affectedCount], unlike SELECT.
 * Validate BOTH supported raw row forms. In particular, [[], 0] is not one row.
 * No identity is invented from the caller when the UPDATE returned no matching row.
 */
function printAgentReturningRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error('Unexpected Print Agent UPDATE result.');
  let rows: unknown[] = value;
  if (value.length === 2 && Array.isArray(value[0])) {
    if (!Number.isSafeInteger(value[1]) || value[1] < 0 || value[1] !== value[0].length) {
      throw new Error('Inconsistent Print Agent UPDATE row count.');
    }
    rows = value[0];
  }
  if (!rows.every(row => row !== null && typeof row === 'object' && !Array.isArray(row))) {
    throw new Error('Unexpected Print Agent UPDATE row shape.');
  }
  return rows as Array<Record<string, unknown>>;
}

@Injectable()
export class PrintAgentsService {
  private lastCleanupAt = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async heartbeat(
    agent: AuthenticatedPrintAgent,
    idempotencyKey: string | undefined,
    heartbeat: PrintAgentHeartbeatDto,
  ) {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException(
        'X-Idempotency-Key is required and must be 16-128 safe characters.',
      );
    }

    const requestSha256 = createHash('sha256')
      .update(canonicalJson({ agentId: agent.agentId, heartbeat }))
      .digest('hex');
    const now = new Date();
    const captureAt = parseAgentDate(heartbeat.lastSuccessfulCaptureAt, 'lastSuccessfulCaptureAt', now);
    const printAt = parseAgentDate(heartbeat.lastSuccessfulPrintAt, 'lastSuccessfulPrintAt', now);

    const response = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${agent.agentId}:${idempotencyKey}`],
      );

      const credentialUse = printAgentReturningRows(await manager.query(
        `UPDATE print_agent_credentials
            SET last_used_at = $2
          WHERE key_id = $1 AND agent_id = $3 AND active = TRUE
            AND revoked_at IS NULL
            AND scopes @> '["heartbeat"]'::jsonb
            AND EXISTS (SELECT 1 FROM print_agents owner
                         WHERE owner.agent_id = $3 AND owner.enabled = TRUE)
          RETURNING key_id`,
        [agent.keyId, now, agent.agentId],
      ));
      if (credentialUse.length !== 1 || credentialUse[0].key_id !== agent.keyId) {
        throw new UnauthorizedException('This Print Agent credential is no longer active.');
      }

      const existing = await manager.query(
        `SELECT request_sha256, response_body
           FROM print_agent_idempotency
          WHERE agent_id = $1 AND idempotency_key = $2`,
        [agent.agentId, idempotencyKey],
      );
      if (existing[0]) {
        if (existing[0].request_sha256 !== requestSha256) {
          throw new ConflictException(
            'This X-Idempotency-Key was already used with a different heartbeat.',
          );
        }
        const previous = existing[0].response_body;
        // A malformed acknowledgement saved by the old raw-result bug is not success.
        // Preserve the old record. A new heartbeat key is required; do not rewrite history.
        if (!previous || previous.accepted !== true || previous.agentId !== agent.agentId
          || typeof previous.serverReceivedAt !== 'string'
          || !Number.isFinite(Date.parse(previous.serverReceivedAt))) {
          throw new ConflictException('Stored heartbeat acknowledgement is incomplete. Send a new heartbeat idempotency key.');
        }
        return previous;
      }

      const updated = printAgentReturningRows(await manager.query(
        `UPDATE print_agents
            SET last_seen_at = $2,
                agent_version = $3,
                configured_routes = $4::jsonb,
                last_successful_capture_at = CASE
                  WHEN $5::timestamptz IS NULL THEN last_successful_capture_at
                  ELSE GREATEST(last_successful_capture_at, $5::timestamptz)
                END,
                last_successful_print_at = CASE
                  WHEN $6::timestamptz IS NULL THEN last_successful_print_at
                  ELSE GREATEST(last_successful_print_at, $6::timestamptz)
                END,
                last_error_at = CASE WHEN $7::text IS NULL THEN last_error_at ELSE $2 END,
                last_error = COALESCE($7::text, last_error),
                updated_at = $2
          WHERE agent_id = $1 AND enabled = TRUE
          RETURNING agent_id, display_name, last_seen_at`,
        [
          agent.agentId,
          now,
          heartbeat.agentVersion.trim(),
          JSON.stringify(heartbeat.configuredRoutes),
          captureAt,
          printAt,
          heartbeat.lastError?.trim() ?? null,
        ],
      ));
      if (updated.length !== 1 || updated[0].agent_id !== agent.agentId
        || typeof updated[0].display_name !== 'string' || !updated[0].display_name.trim()) {
        throw new UnauthorizedException('This Print Agent is disabled or no longer exists.');
      }

      const body = {
        accepted: true,
        agentId: updated[0].agent_id,
        agentName: updated[0].display_name,
        serverReceivedAt: now.toISOString(),
        nextHeartbeatSeconds: Math.max(10, Math.floor(this.offlineSeconds() / 3)),
      };
      await manager.query(
        `INSERT INTO print_agent_idempotency(
           agent_id, idempotency_key, request_sha256, response_status, response_body
         ) VALUES ($1, $2, $3, 200, $4::jsonb)`,
        [agent.agentId, idempotencyKey, requestSha256, JSON.stringify(body)],
      );
      return body;
    });

    void this.cleanupExpiredIdempotency();
    return response;
  }

  async status() {
    const offlineSeconds = this.offlineSeconds();
    const agents = await this.dataSource.query(
      `SELECT agent_id, display_name, enabled, last_seen_at, agent_version,
              configured_routes, last_successful_capture_at,
              last_successful_print_at, last_error_at, last_error,
              CASE
                WHEN enabled = FALSE THEN 'DISABLED'
                WHEN last_seen_at >= NOW() - ($1::int * INTERVAL '1 second') THEN 'ONLINE'
                ELSE 'OFFLINE'
              END AS status
         FROM print_agents
        ORDER BY display_name, agent_id`,
      [offlineSeconds],
    );
    return {
      heartbeatResponseContract: 'truck-log-heartbeat-rows-v1',
      offlineAfterSeconds: offlineSeconds,
      checkedAt: new Date().toISOString(),
      agents: agents.map((row: Record<string, unknown>) => ({
        agentId: row.agent_id,
        agentName: row.display_name,
        status: row.status,
        enabled: row.enabled,
        lastSeen: row.last_seen_at,
        agentVersion: row.agent_version,
        configuredRoutes: row.configured_routes,
        lastSuccessfulCapture: row.last_successful_capture_at,
        lastSuccessfulPrint: row.last_successful_print_at,
        lastErrorAt: row.last_error_at,
        lastError: row.last_error,
      })),
    };
  }

  private offlineSeconds(): number {
    const configured = Number(this.config.get('TRUCK_LOG_PRINT_AGENT_OFFLINE_SECONDS', '90'));
    return Number.isInteger(configured) && configured >= 30 && configured <= 3600
      ? configured
      : 90;
  }

  private async cleanupExpiredIdempotency(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanupAt < 60 * 60 * 1000) return;
    this.lastCleanupAt = now;
    try {
      await this.dataSource.query(
        `DELETE FROM print_agent_idempotency
          WHERE ctid IN (
            SELECT ctid FROM print_agent_idempotency
             WHERE expires_at < NOW()
             ORDER BY expires_at
             LIMIT 5000
          )`,
      );
    } catch {
      // Cleanup is bounded housekeeping and must not turn a valid heartbeat into a failure.
    }
  }
}
