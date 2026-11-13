import { UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';
import { canonicalJsonSha256 as digest } from '@truck-log/server/data-access';
import { key, required, text, UUID } from './automatic-driver-print.helpers';
import { AutomaticDriverPrintStore } from './automatic-driver-print.store';
import type { RecoverQueuedPrintDto } from './dto/recover-queued-print.dto';

/** Explicit recovery is restricted to jobs whose bytes were never delivered under any lease. */
export class AutomaticDriverPrintRecovery {
  constructor(private readonly dataSource: DataSource, private readonly store: AutomaticDriverPrintStore) {}

  async recover(packageId: string, requestKey: string | undefined, guardKey: string | undefined, input: RecoverQueuedPrintDto) {
    key(requestKey);
    required(text(input.reason).length > 0 && text(input.reason).length <= 1000, 'Give a reason for cancelling or replacing the queued print.');
    return this.dataSource.transaction(async m => {
      // Authorized reprints serialize on the visit's original package. Use the
      // same lock before the job lock so recovery cannot queue a second copy.
      await m.query(`SELECT original.id FROM automatic_driver_print_packages original
        JOIN automatic_driver_print_packages requested ON requested.truck_visit_id=original.truck_visit_id
        WHERE requested.id=$1 AND original.request_kind='ORIGINAL' FOR UPDATE OF original`, [packageId]);
      const rows = await m.query(`SELECT j.*,p.gate,p.agent_id,p.route,p.printer,p.truck_visit_id,v.client_request_id
        FROM automatic_driver_print_jobs j JOIN automatic_driver_print_packages p ON p.id=j.package_id
        JOIN truck_visits v ON v.id=p.truck_visit_id WHERE p.id=$1 AND j.item_type=$2 FOR UPDATE OF j`, [packageId, input.itemType]);
      const r = rows[0];
      required(r, 'Automatic print job not found.');
      const supplied=text(guardKey).toLowerCase(), expected=text(r.client_request_id).toLowerCase();
      if (!UUID.test(supplied) || !UUID.test(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)))
        throw new UnauthorizedException('Original check-in action credentials are required.');
      const previous=await m.query('SELECT * FROM automatic_print_job_recoveries WHERE job_id=$1', [r.id]);
      if (previous.length) {
        required(previous[0].request_key===requestKey, 'This queued print was already cancelled or replaced.');
        const same = (previous[0].replacement_package_id !== null) === (input.action === 'REPLACE') && previous[0].reason === text(input.reason);
        required(same, 'Recovery key was reused with different content.');
        if (input.action === 'REPLACE') {
          const target=await m.query('SELECT gate FROM automatic_driver_print_packages WHERE id=$1',[previous[0].replacement_package_id]);
          required(target[0]?.gate === input.gate, 'Recovery key was reused with a different gate.');
        }
        return this.store.summary(m, previous[0].replacement_package_id || packageId);
      }
      const leased=await m.query('SELECT id FROM automatic_driver_print_attempts WHERE job_id=$1 AND leased_at IS NOT NULL LIMIT 1', [r.id]);
      required(['QUEUED','FAILED'].includes(r.status) && !r.leased_at && !leased.length,
        'This job has been delivered to a printer. Inspect its outcome and use the existing retry or authorized reprint workflow.');
      let replacement: string | null=null;
      if (input.action==='REPLACE') {
        if (r.item_type==='RXO_DOCUMENT') {
          const busy=await m.query(`SELECT id FROM automatic_driver_print_jobs
            WHERE visit_document_id=$1 AND id<>$2 AND status IN ('QUEUED','LEASED') LIMIT 1`,[r.visit_document_id,r.id]);
          required(!busy.length,'This RXO document already has an in-progress print. Resolve it before requesting another copy.');
        }
        required(input.gate==='EAST' || input.gate==='WEST', 'Choose the replacement East or West gate.');
        const identity=this.store.identity();
        const setting=await m.query('SELECT value FROM app_settings WHERE key=$1', [input.gate==='EAST'?'driver_print_east_printer':'driver_print_west_printer']);
        const printer=text(setting[0]?.value);
        required(printer.length>0 && printer.length<=255 && !/[\x00-\x1f\x7f]/.test(printer), 'Save the replacement gate printer first.');
        const online=await m.query(`SELECT agent_id FROM print_agents WHERE agent_id=$1 AND enabled=TRUE
          AND last_seen_at>=NOW()-($2::int*INTERVAL '1 second')
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(configured_routes) advertised(value) WHERE advertised.value->>'route'=$3 AND advertised.value->>'outputPrinter'=$4)`,
          [identity.agentId,this.store.offlineSeconds(),identity.route,printer]);
        if (!online.length) throw new ServiceUnavailableException('The replacement gate printer is not advertised online.');
        replacement=randomUUID();
        await m.query(`INSERT INTO automatic_driver_print_packages(id,truck_visit_id,gate,agent_id,route,printer,requested_by,request_kind,original_package_id,request_key,request_sha256)
          VALUES($1,$2,$3,$4,$5,$6,'GUARD','REPRINT',$7,$8,$9)`,
          [replacement,r.truck_visit_id,input.gate,identity.agentId,identity.route,printer,packageId,'recovery-'+digest({jobId:r.id,requestKey}),digest({input,jobId:r.id})]);
        const job=randomUUID();
        await m.query(`INSERT INTO automatic_driver_print_jobs(id,package_id,item_type,visit_document_id,pdf_bytes,file_name,file_size_bytes,sha256)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[job,replacement,r.item_type,r.visit_document_id,r.pdf_bytes,r.file_name,r.file_size_bytes,r.sha256]);
        await m.query('INSERT INTO automatic_driver_print_attempts(job_id,attempt_number,request_key) VALUES($1,1,$2)',[job,'original-'+job]);
      }
      if (r.status==='QUEUED') await this.store.failQueued(m,r,'Queued print cancelled before delivery to Windows.');
      await m.query('INSERT INTO automatic_print_job_recoveries(job_id,replacement_package_id,request_key,reason) VALUES($1,$2,$3,$4)',[r.id,replacement,requestKey,text(input.reason)]);
      await this.store.audit(m,r.truck_visit_id,'AUTO_PRINT_QUEUE_RECOVERED','GUARD',
        `Cancelled never-leased job ${r.id}, frozen printer ${r.printer}; replacement ${replacement || 'none (manual printing)'}; reason ${text(input.reason)}`);
      if (replacement && r.item_type==='RXO_DOCUMENT') await m.query("UPDATE visit_documents SET print_status='PENDING',print_error=NULL,updated_at=NOW() WHERE id=$1",[r.visit_document_id]);
      return this.store.summary(m,replacement || packageId);
    });
  }
}
