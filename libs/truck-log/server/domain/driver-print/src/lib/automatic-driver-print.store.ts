import { returnedRows } from '@truck-log/server/data-access';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import type { DriverPrintPackageSummary } from './driver-print.service';
import {
  SHA,
  UNCERTAIN,
  iso,
  oneUpdated,
  required,
  text,
  updateRows,
  type Queryable,
} from './automatic-driver-print.helpers';
import { lateResultNote } from './print-agent-late-result';

const PRINTED_NOTE =
  'Print engine submission reported successful. Verify physical delivery when testing.';

interface FinishableJob {
  id: string;
  attempt_count: number;
  truck_visit_id: number;
  item_type: string;
  visit_document_id: number | null;
}

/**
 * Shared state of automatic Driver Print: configured agent identity and
 * timing, package summaries, final item results, lease expiry and visit audit.
 * A plain class constructed by AutomaticDriverPrintService (not a Nest provider).
 */
export class AutomaticDriverPrintStore {
  constructor(private readonly config: ConfigService) {}

  identity() {
    const agentId =
      text(this.config.get('TRUCK_LOG_DRIVER_PRINT_AGENT_ID', '')) || 'trucklog-print-pc-01';
    const route =
      text(this.config.get('TRUCK_LOG_DRIVER_PRINT_ROUTE', '')) || 'RXO_DRIVER_DOCUMENT';
    required(
      /^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(agentId) &&
        route.length <= 120 &&
        !/[\x00-\x1f\x7f]/.test(route),
      'Invalid automatic print identity.',
    );
    required(
      SHA.test(text(this.config.get('TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET', '')).toLowerCase()),
      'Print claim signing is not configured.',
    );
    return { agentId, route };
  }
  offlineSeconds(): number {
    const n = Number(this.config.get('TRUCK_LOG_PRINT_AGENT_OFFLINE_SECONDS', '90'));
    return Number.isInteger(n) && n >= 30 && n <= 3600 ? n : 90;
  }
  leaseSeconds(): number {
    const n = Number(this.config.get('TRUCK_LOG_PRINT_JOB_LEASE_SECONDS', '300'));
    return Number.isInteger(n) && n >= 60 && n <= 900 ? n : 300;
  }

  async summary(q: Queryable, packageId: string): Promise<DriverPrintPackageSummary> {
    const rows = await q.query(
      `SELECT p.id AS package_id,j.id,j.item_type,j.status,j.last_error,j.printed_at,j.visit_document_id,
      d.rxo_document_version,d.file_name,recovery.job_id IS NOT NULL AS cancelled,recovery.replacement_package_id,
      (j.status IN ('QUEUED','FAILED') AND j.leased_at IS NULL AND recovery.job_id IS NULL AND NOT EXISTS(SELECT 1 FROM automatic_driver_print_attempts a WHERE a.job_id=j.id AND a.leased_at IS NOT NULL)) AS recoverable FROM automatic_driver_print_packages p
      JOIN automatic_driver_print_jobs j ON j.package_id=p.id LEFT JOIN visit_documents d ON d.id=j.visit_document_id
      LEFT JOIN automatic_print_job_recoveries recovery ON recovery.job_id=j.id
      WHERE p.id=$1 ORDER BY CASE j.item_type WHEN 'DOCK_ASSIGNMENT' THEN 0 ELSE 1 END`,
      [packageId],
    );
    if (!rows.length) throw new NotFoundException('Automatic print package was not found.');
    const rxo = rows.find((r: { item_type: string }) => r.item_type === 'RXO_DOCUMENT');
    const printed = rows.filter((r: { status: string }) => r.status === 'PRINTED').length,
      failed = rows.filter((r: { status: string }) => r.status === 'FAILED').length;
    return {
      packageId,
      automaticDockAssignment: true,
      status:
        printed === rows.length
          ? 'COMPLETED'
          : failed === rows.length
            ? 'FAILED'
            : failed
              ? 'PARTIAL_FAILURE'
              : 'IN_PROGRESS',
      frozenRxoDocumentId: rxo ? Number(rxo.visit_document_id) : null,
      frozenRxoDocumentVersion: rxo ? Number(rxo.rxo_document_version) : null,
      frozenRxoDocumentFileName: rxo?.file_name ?? null,
      items: rows.map(
        (r: {
          id: string;
          item_type: 'DOCK_ASSIGNMENT' | 'RXO_DOCUMENT';
          status: 'QUEUED' | 'LEASED' | 'PRINTED' | 'FAILED';
          last_error: string | null;
          printed_at: unknown;
          recoverable: boolean; cancelled: boolean; replacement_package_id: string | null;
        }) => ({
          id: r.id,
          itemType: r.item_type,
          status: r.status,
          error: r.cancelled ? (r.replacement_package_id ? 'Cancelled; see replacement package ' + r.replacement_package_id : 'Cancelled before delivery. Print manually in the browser.') : r.last_error,
          recoverable: r.recoverable, cancelled: r.cancelled, replacementPackageId: r.replacement_package_id,
          printedAt: iso(r.printed_at),
        }),
      ),
    };
  }

  async finish(
    m: EntityManager,
    r: FinishableJob,
    status: 'PRINTED' | 'FAILED',
    error: string | null,
    when: Date,
    actor: string,
    resultKey: string | null,
  ): Promise<void> {
    const u = returnedRows(await m.query(
      `UPDATE automatic_driver_print_jobs SET status=$2::varchar(30),last_error=$3,
      printed_at=CASE WHEN $2::varchar(30)='PRINTED' THEN $4::timestamptz ELSE NULL END,updated_at=NOW()
      WHERE id=$1 AND status='LEASED' RETURNING id`,
      [r.id, status, error, when],
    ));
    oneUpdated(u, r.id);
    const a = returnedRows(await m.query(
      `UPDATE automatic_driver_print_attempts SET status=$3::varchar(30),completed_at=NOW(),error_message=$4,result_key=$5
      WHERE job_id=$1 AND attempt_number=$2 AND status='LEASED' RETURNING id`,
      [r.id, r.attempt_count, status, error, resultKey],
    ));
    required(updateRows(a).length === 1, 'Automatic print attempt result was not saved.');
    await this.recordOutcome(
      m,
      r,
      status,
      error,
      actor,
      'AUTO_' + r.item_type + '_PRINT_' + status,
      `Job ${r.id}, attempt ${r.attempt_count}: ${error || PRINTED_NOTE}`,
    );
  }

  /**
   * True when the job is FAILED only because the lease monitor expired it:
   * last_error is the UNCERTAIN marker and the attempt has no agent result key.
   * Locks the attempt row. A FAILED reported by the agent (result_key set) or
   * written by anyone else is never treated as replaceable.
   */
  async expiredByMonitor(
    m: EntityManager,
    r: { id: string; attempt_count: number; status: string; last_error: string | null },
  ): Promise<boolean> {
    if (r.status !== 'FAILED' || r.last_error !== UNCERTAIN) return false;
    const rows = await m.query(
      `SELECT result_key FROM automatic_driver_print_attempts
      WHERE job_id=$1 AND attempt_number=$2 AND status='FAILED' FOR UPDATE`,
      [r.id, r.attempt_count],
    );
    return rows.length === 1 && rows[0].result_key === null;
  }

  /**
   * Replace the lease monitor's uncertain FAILED with the Print Agent's own
   * result, which was submitted within the lease but delivered late. Guarded
   * UPDATEs: exactly one job and one attempt row must still carry the monitor
   * marker (and migration 0003 allows only this one transition).
   */
  async replaceMonitorFailure(
    m: EntityManager,
    r: FinishableJob,
    status: 'PRINTED' | 'FAILED',
    error: string | null,
    submittedAt: Date,
    actor: string,
    resultKey: string,
  ): Promise<void> {
    const u = returnedRows(await m.query(
      `UPDATE automatic_driver_print_jobs SET status=$2::varchar(30),last_error=$3,
      printed_at=CASE WHEN $2::varchar(30)='PRINTED' THEN $4::timestamptz ELSE NULL END,updated_at=NOW()
      WHERE id=$1 AND status='FAILED' AND last_error=$5 AND attempt_count=$6 RETURNING id`,
      [r.id, status, error, submittedAt, UNCERTAIN, r.attempt_count],
    ));
    oneUpdated(u, r.id);
    const a = returnedRows(await m.query(
      `UPDATE automatic_driver_print_attempts SET status=$3::varchar(30),completed_at=NOW(),error_message=$4,result_key=$5
      WHERE job_id=$1 AND attempt_number=$2 AND status='FAILED' AND result_key IS NULL AND error_message=$6 RETURNING id`,
      [r.id, r.attempt_count, status, error, resultKey, UNCERTAIN],
    ));
    required(updateRows(a).length === 1, 'Automatic print attempt late result was not saved.');
    await this.recordOutcome(
      m,
      r,
      status,
      error,
      actor,
      'AUTO_' + r.item_type + '_PRINT_' + status + '_LATE_RESULT',
      `Job ${r.id}, attempt ${r.attempt_count}: ` +
        lateResultNote(submittedAt, error || PRINTED_NOTE),
    );
  }

  private async recordOutcome(
    m: EntityManager,
    r: FinishableJob,
    status: 'PRINTED' | 'FAILED',
    error: string | null,
    actor: string,
    event: string,
    notes: string,
  ): Promise<void> {
    if (r.item_type === 'RXO_DOCUMENT')
      await m.query(
        'UPDATE visit_documents SET print_status=$2,print_error=$3,updated_at=NOW() WHERE id=$1',
        [r.visit_document_id, status, error],
      );
    await this.audit(m, r.truck_visit_id, event, actor, notes);
  }
  async failQueued(m: EntityManager, r: FinishableJob, error: string): Promise<void> {
    const changed = returnedRows(await m.query(`UPDATE automatic_driver_print_jobs SET status='FAILED',last_error=$2,updated_at=NOW()
      WHERE id=$1 AND status='QUEUED' AND leased_at IS NULL RETURNING id`, [r.id,error]));
    oneUpdated(changed,r.id);
    const attempt=returnedRows(await m.query(`UPDATE automatic_driver_print_attempts SET status='FAILED',completed_at=NOW(),error_message=$3
      WHERE job_id=$1 AND attempt_number=$2 AND status='REQUESTED' RETURNING id`,[r.id,r.attempt_count,error]));
    required(attempt.length===1,'The queued print attempt is missing.');
    await this.recordOutcome(m,r,'FAILED',error,'TRUCK_LOG_AGENT_MONITOR','AUTO_PRINT_QUEUE_FAILED',`Job ${r.id}: ${error}`);
  }

  async reconcileQueued(m: EntityManager): Promise<number> {
    const rows=await m.query(`SELECT j.*,p.truck_visit_id FROM automatic_driver_print_jobs j
      JOIN automatic_driver_print_packages p ON p.id=j.package_id WHERE j.status='QUEUED'
      AND NOT EXISTS(SELECT 1 FROM print_agents a WHERE a.agent_id=p.agent_id AND a.enabled=TRUE
        AND a.last_seen_at>=NOW()-($1::int*INTERVAL '1 second')
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.configured_routes) advertised(value) WHERE advertised.value->>'route'=p.route AND advertised.value->>'outputPrinter'=p.printer))
      ORDER BY j.created_at,j.id LIMIT 100 FOR UPDATE OF j SKIP LOCKED`,[this.offlineSeconds()]);
    for(const r of rows) await this.failQueued(m,r,'The frozen gate printer is unavailable. Restore it and retry, or explicitly cancel/replace this never-leased job.');
    return rows.length;
  }

  async expire(m: EntityManager): Promise<void> {
    const rows =
      await m.query(`SELECT j.*,p.truck_visit_id FROM automatic_driver_print_jobs j JOIN automatic_driver_print_packages p ON p.id=j.package_id
      WHERE j.status='LEASED' AND j.lease_expires_at<=NOW() ORDER BY j.lease_expires_at LIMIT 100 FOR UPDATE OF j SKIP LOCKED`);
    for (const r of rows)
      await this.finish(m, r, 'FAILED', UNCERTAIN, new Date(), 'TRUCK_LOG_LEASE_MONITOR', null);
  }

  async audit(
    m: EntityManager,
    visitId: number,
    event: string,
    actor: string,
    notes: string,
  ): Promise<void> {
    await m.query(
      'INSERT INTO visit_events(truck_visit_id,event_type,occurred_at,actor,notes) VALUES($1,$2,NOW(),$3,$4)',
      [visitId, event, actor.trim().slice(0, 120), notes],
    );
  }
}
