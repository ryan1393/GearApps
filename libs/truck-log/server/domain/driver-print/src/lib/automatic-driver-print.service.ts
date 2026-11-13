import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { SapDocumentStorageService } from '@truck-log/server/infrastructure/sap-documents';
import type { AuthenticatedPrintAgent } from '@truck-log/server/auth/print-agent';
import type { AuthenticatedTruckLogPrincipal } from '@truck-log/server/auth/access';
import type { ReprintRxoDocumentDto } from './dto/reprint-rxo-document.dto';
import type { PrintAgentJobResultDto } from './dto/print-agent-job-result.dto';
import type { PrintAgentDocumentDownload, DriverPrintPackageSummary } from './driver-print.service';
import { makeAutomaticDockPdf, dockPdfSha, DockSlipSnapshot } from './automatic-dock-slip';
import {
  MAX_PDF,
  SHA,
  UUID,
  required,
  text,
  type FrozenJob,
  type Queryable,
} from './automatic-driver-print.helpers';
import { AutomaticDriverPrintStore } from './automatic-driver-print.store';
import { AutomaticDriverPrintAgentJobs } from './automatic-driver-print-agent-jobs';
import { AutomaticDriverPrintRecovery } from './automatic-driver-print-recovery';
import type { RecoverQueuedPrintDto } from './dto/recover-queued-print.dto';
import { AutomaticDriverPrintRequests } from './automatic-driver-print-requests';

/**
 * Automatic (agent-printed) Driver Print packages for new check-ins.
 * Package creation and RXO attachment live here; shared identity/summary/
 * result/audit state is in AutomaticDriverPrintStore, the Print Agent wire in
 * AutomaticDriverPrintAgentJobs and guard retry / authorized reprint in
 * AutomaticDriverPrintRequests.
 */
@Injectable()
export class AutomaticDriverPrintService {
  private readonly store: AutomaticDriverPrintStore;
  private readonly agentJobs: AutomaticDriverPrintAgentJobs;
  private readonly requests: AutomaticDriverPrintRequests;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly storage: SapDocumentStorageService,
  ) {
    this.store = new AutomaticDriverPrintStore(this.config);
    this.agentJobs = new AutomaticDriverPrintAgentJobs(this.dataSource, this.storage, this.store);
    this.requests = new AutomaticDriverPrintRequests(this.dataSource, this.store);
  }

  async onModuleInit(): Promise<void> {
    // The baseline migration creates the automatic-print tables; tools/truck-log/migrate.mjs records it.
    const schema = await this.dataSource.query(
      "SELECT 1 FROM public.truck_log_schema_migrations WHERE version='0001'",
    );
    if (!schema.length)
      throw new ServiceUnavailableException(
        'Database migrations have not run. Start the server through its container entrypoint.',
      );
  }
  async create(
    manager: EntityManager,
    visitId: number,
    gate: 'EAST' | 'WEST',
    actor: string | null,
  ): Promise<void> {
    required(
      gate === 'EAST' || gate === 'WEST',
      'Select East or West on this workstation before automatic printing.',
    );
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'automatic-driver-print:' + visitId,
    ]);
    const existing = await manager.query(
      "SELECT id FROM automatic_driver_print_packages WHERE truck_visit_id=$1 AND request_kind='ORIGINAL'",
      [visitId],
    );
    required(
      !existing.length,
      'An automatic package already exists; do not create another check-in.',
    );
    const legacy = await manager.query(
      "SELECT id FROM driver_print_packages WHERE truck_visit_id=$1 AND request_kind='ORIGINAL'",
      [visitId],
    );
    required(
      !legacy.length,
      'An existing legacy visit cannot be converted into an automatic print package.',
    );
    const rows = await manager.query('SELECT * FROM truck_visits WHERE id=$1', [visitId]);
    const v = rows[0];
    required(
      v && UUID.test(text(v.client_request_id)),
      'Automatic printing requires the original check-in request identity.',
    );
    const s = await manager.query(
      "SELECT key,value FROM app_settings WHERE key IN ('driver_print_east_printer','driver_print_west_printer','site_name','slip_footer','plant_location_name')",
    );
    const settings = new Map<string, string>(
      s.map((r: { key: string; value: string | null }) => [r.key, text(r.value)]),
    );
    const printer =
      settings.get(gate === 'EAST' ? 'driver_print_east_printer' : 'driver_print_west_printer') ||
      '';
    required(
      printer.length > 0 && printer.length <= 255 && !/[\x00-\x1f\x7f]/.test(printer),
      'Save this gate printer in Administration > Printing first.',
    );
    const { agentId, route } = this.store.identity();
    const agent = await manager.query(
      'SELECT agent_id FROM print_agents WHERE agent_id=$1 AND enabled=TRUE',
      [agentId],
    );
    required(agent.length === 1, 'The configured Print Agent identity is missing or disabled.');
    const plant = settings.get('plant_location_name') || 'Fort Wayne',
      site = settings.get('site_name');
    const snapshot: DockSlipSnapshot = {
      id: visitId,
      dockCode: v.dock_code,
      loadNumber: v.load_number,
      direction: v.direction,
      driverName: v.driver_name,
      driverPhone: v.driver_phone,
      carrierName: v.carrier_name,
      tractorId: v.tractor_id,
      trailerId: v.trailer_id,
      isDropTrailer: v.is_drop_trailer,
      originName: v.origin_name,
      destinationName: v.destination_name,
      scheduledAt: v.scheduled_at,
      guardCheckInAt: v.guard_check_in_at,
      dockAssignedAt: v.dock_assigned_at,
      notes: v.notes,
      gate,
      timeZone: text(this.config.get('TZ', '')) || 'America/Indiana/Indianapolis',
      siteName:
        site && site.toLowerCase() !== 'truck log'
          ? site
          : /^dana\b/i.test(plant)
            ? plant
            : 'Dana ' + plant,
      footer:
        settings.get('slip_footer') ||
        'Return to the guard shack for final checkout before leaving the site.',
    };
    const pdf = makeAutomaticDockPdf(snapshot),
      packageId = randomUUID(),
      jobId = randomUUID();
    await manager.query(
      `INSERT INTO automatic_driver_print_packages(id,truck_visit_id,gate,agent_id,route,printer,requested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [packageId, visitId, gate, agentId, route, printer, text(actor).slice(0, 120) || 'Guard'],
    );
    await manager.query(
      `INSERT INTO automatic_driver_print_jobs(id,package_id,item_type,pdf_bytes,file_name,file_size_bytes,sha256)
      VALUES($1,$2,'DOCK_ASSIGNMENT',$3,$4,$5,$6)`,
      [
        jobId,
        packageId,
        pdf,
        'TL-' + String(visitId).padStart(6, '0') + '-Dock-Assignment.pdf',
        pdf.length,
        dockPdfSha(pdf),
      ],
    );
    await manager.query(
      `INSERT INTO automatic_driver_print_attempts(job_id,attempt_number,request_key)
      VALUES($1,1,$2)`,
      [jobId, 'original-' + jobId],
    );
    await this.store.audit(
      manager,
      visitId,
      'AUTO_DRIVER_PRINT_REQUESTED',
      text(actor) || 'Guard',
      `Package ${packageId}; ${gate}; ${printer}; immutable Dock Assignment ${dockPdfSha(pdf)}.`,
    );
  }

  async assertRequest(
    manager: EntityManager,
    visitId: number,
    enabled: boolean,
    gate: unknown,
  ): Promise<void> {
    const rows = await manager.query(
      "SELECT gate FROM automatic_driver_print_packages WHERE truck_visit_id=$1 AND request_kind='ORIGINAL'",
      [visitId],
    );
    if (enabled !== Boolean(rows.length) || (enabled && rows[0]?.gate !== gate))
      throw new ConflictException(
        'This check-in request already belongs to a different printing mode or gate.',
      );
  }

  async attachRxoIfOwned(
    manager: EntityManager,
    visitId: number,
    documentId: number,
  ): Promise<DriverPrintPackageSummary | null> {
    const packets = await manager.query(
      "SELECT * FROM automatic_driver_print_packages WHERE truck_visit_id=$1 AND request_kind='ORIGINAL' FOR UPDATE",
      [visitId],
    );
    if (!packets.length) return null;
    const p = packets[0];
    const prior = await manager.query(
      "SELECT visit_document_id FROM automatic_driver_print_jobs WHERE package_id=$1 AND item_type='RXO_DOCUMENT'",
      [p.id],
    );
    if (prior.length) {
      required(
        Number(prior[0].visit_document_id) === documentId,
        'Automatic package is already frozen to another RXO document version.',
      );
      return this.store.summary(manager, p.id);
    }
    const docs = await manager.query(
      `SELECT * FROM visit_documents WHERE id=$1 AND truck_visit_id=$2
      AND document_type='RXO_DRIVER_DOCUMENT' AND source_kind='MATERIALS_UPLOAD'
      AND storage_status='STORED' AND mime_type='application/pdf' FOR SHARE`,
      [documentId, visitId],
    );
    const d = docs[0];
    required(
      d &&
        text(d.file_name).length > 0 &&
        text(d.file_name).length <= 255 &&
        !/[\x00-\x1f\x7f]/.test(d.file_name) &&
        SHA.test(text(d.sha256)) &&
        Number.isSafeInteger(Number(d.file_size_bytes)) &&
        Number(d.file_size_bytes) > 8 &&
        Number(d.file_size_bytes) <= MAX_PDF &&
        String(d.relative_path).startsWith('rxo/'),
      'The associated RXO PDF is not valid for automatic printing.',
    );
    const job = randomUUID();
    await manager.query(
      `INSERT INTO automatic_driver_print_jobs(id,package_id,item_type,visit_document_id,file_name,file_size_bytes,sha256)
      VALUES($1,$2,'RXO_DOCUMENT',$3,$4,$5,$6)`,
      [job, p.id, documentId, d.file_name, Number(d.file_size_bytes), d.sha256],
    );
    await manager.query(
      'INSERT INTO automatic_driver_print_attempts(job_id,attempt_number,request_key) VALUES($1,1,$2)',
      [job, 'original-' + job],
    );
    await manager.query(
      "UPDATE visit_documents SET print_status='PENDING',print_error=NULL,updated_at=NOW() WHERE id=$1",
      [documentId],
    );
    await this.store.audit(
      manager,
      visitId,
      'AUTO_RXO_PRINT_REQUESTED',
      'TRUCK_LOG',
      `Package ${p.id}; frozen document ${documentId}; ${p.gate}; ${p.printer}.`,
    );
    return this.store.summary(manager, p.id);
  }

  async forVisit(visitId: number): Promise<DriverPrintPackageSummary | null> {
    const r = await this.dataSource.query(
      "SELECT id FROM automatic_driver_print_packages WHERE truck_visit_id=$1 AND request_kind='ORIGINAL'",
      [visitId],
    );
    return r.length ? this.store.summary(this.dataSource.manager, r[0].id) : null;
  }
  async summary(q: Queryable, packageId: string): Promise<DriverPrintPackageSummary> {
    return this.store.summary(q, packageId);
  }

  async tryClaim(
    manager: EntityManager,
    agent: AuthenticatedPrintAgent,
    routes: string[],
    idempotencyKey: string,
    derive: (job: FrozenJob) => string,
  ): Promise<{ job: FrozenJob & { claimToken: string } } | null> {
    return this.agentJobs.tryClaim(manager, agent, routes, idempotencyKey, derive);
  }

  async downloadIfOwned(
    agent: AuthenticatedPrintAgent,
    itemId: string,
    token: string | undefined,
  ): Promise<PrintAgentDocumentDownload | null> {
    return this.agentJobs.downloadIfOwned(agent, itemId, token);
  }

  async reportIfOwned(
    agent: AuthenticatedPrintAgent,
    itemId: string,
    idempotencyKey: string | undefined,
    input: PrintAgentJobResultDto,
  ): Promise<DriverPrintPackageSummary | null> {
    return this.agentJobs.reportIfOwned(agent, itemId, idempotencyKey, input);
  }

  async expire(m: EntityManager): Promise<void> {
    return this.store.expire(m);
  }

  async retryIfOwned(
    packageId: string,
    itemType: 'DOCK_ASSIGNMENT' | 'RXO_DOCUMENT',
    idempotencyKey: string | undefined,
    guardKey: string | undefined,
  ): Promise<DriverPrintPackageSummary | null> {
    return this.requests.retryIfOwned(packageId, itemType, idempotencyKey, guardKey);
  }

  /** Authorized reprints are separate audited packages. Original history is immutable. */
  async reprintIfOwned(
    visitId: number,
    principal: AuthenticatedTruckLogPrincipal,
    idempotencyKey: string | undefined,
    input: ReprintRxoDocumentDto,
  ): Promise<DriverPrintPackageSummary | null> {
    return this.requests.reprintIfOwned(visitId, principal, idempotencyKey, input);
  }

  async recoverQueued(packageId: string, requestKey: string | undefined, guardKey: string | undefined, input: RecoverQueuedPrintDto) {
    return new AutomaticDriverPrintRecovery(this.dataSource,this.store).recover(packageId,requestKey,guardKey,input);
  }

  async reconcileQueued(manager: EntityManager): Promise<number> {
    return this.store.reconcileQueued(manager);
  }

  async ownsPackage(packageId: string): Promise<boolean> {
    return (
      (
        await this.dataSource.query('SELECT id FROM automatic_driver_print_packages WHERE id=$1', [
          packageId,
        ])
      ).length === 1
    );
  }}
