import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CoaterManifest, CoaterShipment, CoaterPackingSlip, CoaterShipmentList, CoaterAvailableContainer } from '@meshforge/manufacturing/shared/util-types';
import { lockCoaterInventory } from '@meshforge/manufacturing/server/data-access';
import { availableCoaterContainers, coaterContentHash, readCoaterManifest } from './coater-manifest';
import { CoaterRpaService } from './coater-rpa.service';

const dateText = (date: any): string => new Date(date).toISOString();

@Injectable()
export class CoaterShipmentsService {
  constructor(@InjectDataSource() private readonly source: DataSource, private readonly rpa: CoaterRpaService) {}

  private async transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction(async manager => {
      await lockCoaterInventory(manager);
      return work(manager);
    }).catch(error => {
      if (['23505','55P03','40P01','40001'].includes(error?.driverError?.code ?? error?.code)) throw new ConflictException('Inventory or shipment changed. Refresh before trying again.');
      throw error;
    });
  }

  private async row(manager: EntityManager, id: string) {
    const [row] = await manager.query('SELECT * FROM dana_coater_shipments_v1 WHERE id=$1', [id]);
    if (!row) throw new NotFoundException('Shipment not found.');
    return row;
  }
  private draft(row: any, revision: number) {
    if (row.status !== 'DRAFT') throw new ConflictException('Dispatched or canceled shipment contents are locked.');
    if (row.revision !== revision) throw new ConflictException('Shipment revision changed. Refresh before continuing.');
  }
  private async ids(manager: EntityManager, id: string): Promise<string[]> {
    return (await manager.query('SELECT container_id FROM dana_coater_shipment_containers_v1 WHERE shipment_id=$1 ORDER BY container_id', [id])).map((r: any) => r.container_id);
  }
  private async actor(manager: EntityManager, user: string): Promise<string> {
    const [row] = await manager.query(`SELECT COALESCE(NULLIF(trim(concat_ws(' ',"firstName","lastName")),''),"employeeNumber",'User') AS name FROM users WHERE id::text=$1`, [user]);
    return row?.name || 'User';
  }
  private async event(manager: EntityManager, row: any, kind: string, user: string, detail = '', document: unknown = null) {
    await manager.query(`INSERT INTO dana_coater_shipment_events_v1(id,shipment_id,revision,kind,actor,detail,document,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [randomUUID(),row.id,row.revision,kind,await this.actor(manager,user),detail,document === null ? null : JSON.stringify(document),user]);
  }
  private clean(destination: string, notes: string) {
    const d = destination.trim(), n = notes.trim();
    // eslint-disable-next-line no-control-regex -- Reject command control bytes while allowing ordinary multiline notes.
    if (!d || d.length > 120 || n.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(d+n)) throw new BadRequestException('Enter a destination (1–120 characters) and notes up to 1000 characters.');
    return { destination: d, notes: n };
  }
  private async view(manager: EntityManager, row: any, live?: CoaterManifest): Promise<CoaterShipment> {
    const manifest = live ?? row.manifest;
    const changed = row.status === 'DRAFT' && coaterContentHash(row.destination,row.notes,manifest) !== row.content_hash;
    const events = await manager.query('SELECT kind,revision,at,actor,detail FROM dana_coater_shipment_events_v1 WHERE shipment_id=$1 ORDER BY at,id', [row.id]);
    return { id: row.id, number: row.number, status: row.status, revision: row.revision, destination: row.destination, notes: row.notes, created_at: dateText(row.created_at), created_by: events.find((e: any) => e.kind==='STARTED')?.actor ?? await this.actor(manager,row.created_by), dispatched_at: row.dispatched_at ? dateText(row.dispatched_at) : null, dispatched_by: row.dispatched_by ? (events.find((e: any) => e.kind==='DISPATCHED')?.actor ?? await this.actor(manager,row.dispatched_by)) : null, manifest, changed, reviewed: !changed && row.reviewed_revision === row.revision, print_requested: !changed && row.printed_revision === row.revision, events: events.map((e: any) => ({...e,at:dateText(e.at)})), rpa: await this.rpa.state(manager,row.id,row.revision) };
  }
  private async saveRevision(manager: EntityManager, row: any, user: string, kind: string, detail: string) {
    const manifest = await readCoaterManifest(manager,await this.ids(manager,row.id));
    const hash = coaterContentHash(row.destination,row.notes,manifest);
    await manager.query(`UPDATE dana_coater_shipments_v1 SET destination=$2,notes=$3,manifest=$4::jsonb,content_hash=$5,revision=revision+1,reviewed_revision=NULL,printed_revision=NULL,updated_at=clock_timestamp() WHERE id=$1`, [row.id,row.destination,row.notes,JSON.stringify(manifest),hash]);
    const saved = await this.row(manager,row.id);
    await this.event(manager,saved,kind,user,detail);
    return this.view(manager,saved);
  }
  async create(id: string, destination: string, notes: string, user: string) {
    return this.transaction(async m => {
      const [existing] = await m.query('SELECT * FROM dana_coater_shipments_v1 WHERE id=$1',[id]);
      if (existing) return this.view(m,existing); // Safe retry after an uncertain response.
      const data = this.clean(destination,notes);
      const [{ sequence }] = await m.query("SELECT nextval('dana_coater_shipment_number_v1')::text AS sequence");
      const number = `CS-${sequence.padStart(8,'0')}`;
      const manifest = await readCoaterManifest(m,[]);
      await m.query(`INSERT INTO dana_coater_shipments_v1(id,number,destination,notes,manifest,content_hash,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`, [id,number,data.destination,data.notes,JSON.stringify(manifest),coaterContentHash(data.destination,data.notes,manifest),user]);
      const row = await this.row(m,id); await this.event(m,row,'STARTED',user);
      return this.view(m,row);
    });
  }
  async list(history: boolean, query: string, page: number): Promise<CoaterShipmentList> {
    if (!Number.isInteger(page) || page < 1 || page > 100000 || query.length > 80) throw new BadRequestException('Invalid shipment search or page.');
    return this.source.transaction('REPEATABLE READ',async m => {
      const term = '%'+query.trim().replace(/[\\%_]/g,'\\$&')+'%';
      const where = `WHERE (status <> 'DRAFT')=$1 AND (number ILIKE $2 OR destination ILIKE $2 OR manifest::text ILIKE $2)`;
      const [count] = await m.query('SELECT count(*)::int AS total FROM dana_coater_shipments_v1 '+where,[history,term]);
      const rows = await m.query('SELECT id,number,status,revision,destination,created_at,manifest FROM dana_coater_shipments_v1 '+where+' ORDER BY created_at DESC,id LIMIT 25 OFFSET $3',[history,term,(page-1)*25]);
      return { rows: rows.map((r: any) => ({id:r.id,number:r.number,status:r.status,revision:r.revision,destination:r.destination,created_at:dateText(r.created_at),totals:r.manifest.totals})),total:count.total,page,page_size:25 };
    });
  }
  async available(id: string, query: string): Promise<CoaterAvailableContainer[]> {
    if (query.length > 80) throw new BadRequestException('Invalid container search.');
    return this.source.transaction('REPEATABLE READ', async m => {
      const row=await this.row(m,id);
      if (row.status !== 'DRAFT') return [];
      const term='%'+query.trim().toUpperCase().replace(/[%_\\]/g,'\\$&')+'%';
      const candidates=await m.query(`SELECT c.id,c.serial_number FROM containers c
        WHERE c.enabled AND c."deletedAt" IS NULL AND c.serial_number ILIKE $1
          AND (EXISTS (SELECT 1 FROM container_tray ct WHERE ct.container_id=c.id AND ct.enabled)
            OR EXISTS (SELECT 1 FROM container_sets cs WHERE cs.container_id=c.id AND cs.enabled))
          AND NOT EXISTS (SELECT 1 FROM dana_coater_shipment_containers_v1 sc WHERE sc.container_id=c.id AND sc.reserved)
        ORDER BY c.serial_number LIMIT 100`,[term]);
      if (!candidates.length) return [];
      // One manifest read for all candidates (a fixed handful of queries), not one per container.
      return availableCoaterContainers(await readCoaterManifest(m,candidates.map((c: { id: string }) => c.id)),candidates);
    });
  }
  async get(id: string) {
    return this.source.transaction('REPEATABLE READ',async m => {
      const row = await this.row(m,id);
      return this.view(m,row,row.status==='DRAFT' ? await readCoaterManifest(m,await this.ids(m,id)) : undefined);
    });
  }
  async update(id: string, revision: number, destination: string, notes: string, user: string) {
    return this.transaction(async m => {
      const row=await this.row(m,id); this.draft(row,revision); Object.assign(row,this.clean(destination,notes));
      return this.saveRevision(m,row,user,'DETAILS_CHANGED','Destination or notes updated; review and print again.');
    });
  }
  async add(id: string, revision: number, serial: string, user: string) {
    return this.transaction(async m => {
      const row=await this.row(m,id); this.draft(row,revision);
      const ids=await this.ids(m,id);
      if (ids.length>=200) throw new BadRequestException('A shipment supports up to 200 containers. Start another shipment for additional containers.');
      const [container]=await m.query('SELECT id FROM containers WHERE serial_number=$1 AND enabled AND "deletedAt" IS NULL',[serial.trim().toUpperCase()]);
      if (!container) throw new NotFoundException('Container not found or disabled.');
      const [reservation]=await m.query('SELECT s.number FROM dana_coater_shipment_containers_v1 c JOIN dana_coater_shipments_v1 s ON s.id=c.shipment_id WHERE c.container_id=$1 AND c.reserved',[container.id]);
      if (reservation) throw new ConflictException(`Container is already selected in ${reservation.number}.`);
      const manifest=await readCoaterManifest(m,[container.id]);
      if (manifest.issues.length) throw new ConflictException(manifest.issues.join(' '));
      await m.query('INSERT INTO dana_coater_shipment_containers_v1(shipment_id,container_id) VALUES($1,$2)',[id,container.id]);
      return this.saveRevision(m,row,user,'CONTAINER_ADDED',serial.trim().toUpperCase());
    });
  }
  async remove(id: string, revision: number, containerId: string, user: string) {
    return this.transaction(async m => {
      const row=await this.row(m,id); this.draft(row,revision);
      const [selected]=await m.query('SELECT c.serial_number FROM dana_coater_shipment_containers_v1 sc JOIN containers c ON c.id=sc.container_id WHERE sc.shipment_id=$1 AND sc.container_id=$2',[id,containerId]);
      if (!selected) throw new ConflictException('Container is no longer in this draft.');
      await m.query('DELETE FROM dana_coater_shipment_containers_v1 WHERE shipment_id=$1 AND container_id=$2',[id,containerId]);
      return this.saveRevision(m,row,user,'CONTAINER_REMOVED',selected.serial_number);
    });
  }
  async review(id: string, revision: number, user: string) {
    return this.transaction(async m => {
      let row=await this.row(m,id); this.draft(row,revision);
      const manifest=await readCoaterManifest(m,await this.ids(m,id));
      if (manifest.issues.length) throw new ConflictException(manifest.issues.join(' '));
      if (coaterContentHash(row.destination,row.notes,manifest)!==row.content_hash) {
        await this.saveRevision(m,row,user,'CONTENTS_REFRESHED','Inventory changed; a new revision was saved.'); row=await this.row(m,id);
      }
      await m.query('UPDATE dana_coater_shipments_v1 SET reviewed_revision=revision,updated_at=clock_timestamp() WHERE id=$1',[id]);
      row=await this.row(m,id); await this.event(m,row,'REVIEWED',user);
      return this.view(m,row);
    });
  }
  private async verifyReviewed(m: EntityManager,row: any,revision: number) {
    this.draft(row,revision);
    const manifest=await readCoaterManifest(m,await this.ids(m,row.id));
    if (manifest.issues.length) throw new ConflictException(manifest.issues.join(' '));
    if (row.reviewed_revision!==revision || coaterContentHash(row.destination,row.notes,manifest)!==row.content_hash) throw new ConflictException('Contents changed or were not reviewed. Refresh, review and print the current revision.');
  }

  async prepareRpa(id: string, revision: number, po: string | undefined, user: string) {
    return this.transaction(async manager => {
      const row = await this.row(manager,id);
      if (row.status === 'DRAFT') await this.verifyReviewed(manager,row,revision);
      else if (row.status !== 'DISPATCHED' || row.revision !== revision) {
        throw new ConflictException('Refresh the active shipment revision before preparing an RPA.');
      }
      const number = await this.rpa.prepare(manager,row,po,user);
      if (number !== null) await this.event(manager,row,'RPA_PREPARED',user,`RPA ${number} prepared.`);
      return this.view(manager,row);
    });
  }
  async print(id: string, revision: number, user: string): Promise<CoaterPackingSlip> {
    return this.transaction(async m => {
      let row=await this.row(m,id);
      if (row.status==='CANCELED') throw new ConflictException('Canceled drafts do not have an active packing slip.');
      if (row.revision!==revision) throw new ConflictException('Shipment revision changed. Refresh before printing.');
      if (row.status==='DRAFT') await this.verifyReviewed(m,row,revision);
      const reprint=row.printed_revision===revision || row.status==='DISPATCHED';
      await m.query('UPDATE dana_coater_shipments_v1 SET printed_revision=revision WHERE id=$1',[id]);
      row=await this.row(m,id);
      const slip: CoaterPackingSlip={shipment:await this.view(m,row),reprint,requested_at:new Date().toISOString(),requested_by:await this.actor(m,user)};
      await this.event(m,row,reprint?'REPRINT_REQUESTED':'PRINT_REQUESTED',user,'Print document prepared; physical printing is confirmed by the operator.',slip);
      return slip;
    });
  }
  async dispatch(id: string,revision: number,printed: boolean,user: string) {
    return this.transaction(async m => {
      const row=await this.row(m,id);
      if (row.status==='DISPATCHED' && row.revision===revision) return this.view(m,row); // Idempotent retry, never a second physical transition.
      if (printed!==true) throw new BadRequestException('Confirm the printed slip and physical containers before sending.');
      await this.verifyReviewed(m,row,revision);
      if (row.printed_revision!==revision) throw new ConflictException('Print the current revision before sending.');
      const [stage]=await m.query('SELECT id FROM tray_stages WHERE code=$1 AND enabled AND "deletedAt" IS NULL',['AT_COATER']);
      if (!stage) throw new ConflictException('AT_COATER stage is not configured.');
      const manifest: CoaterManifest=row.manifest;
      for (const container of manifest.containers) for (const tray of container.trays) {
        // A blade set has left its tray (the tray is already back in the empty pool).
        const set = tray.kind === 'SET';
        await m.query(`INSERT INTO blade_history(id,blade_id,event_type,from_status,to_status,service_cycle,tray_id,container_id,notes,"createdBy","updatedBy")
          SELECT ids.id,ids.blade_id,'sent_to_coater','ready_for_coating','at_coater',ids.cycle,$4,$5,$6,$7,$7
          FROM unnest($1::uuid[],$2::uuid[],$3::int[]) AS ids(id,blade_id,cycle)`,
          [tray.blades.map(()=>randomUUID()),tray.blades.map(b=>b.id),tray.blades.map(b=>b.cycle),set ? null : tray.id,container.id,`Shipment ${row.number}, revision ${revision}`,user]);
        await m.query('UPDATE blades SET status=$2,"updatedAt"=clock_timestamp(),"updatedBy"=$3 WHERE id::text=ANY($1::text[])',[tray.blades.map(b=>b.id),'at_coater',user]);
        if (!set) await m.query('UPDATE trays SET current_stage_id=$2,"updatedAt"=clock_timestamp(),"updatedBy"=$3 WHERE id=$1',[tray.id,stage.id,user]);
      }
      await m.query("UPDATE dana_coater_shipments_v1 SET status='DISPATCHED',dispatched_at=clock_timestamp(),dispatched_by=$2,updated_at=clock_timestamp() WHERE id=$1",[id,user]);
      await m.query('UPDATE dana_coater_shipment_containers_v1 SET reserved=false WHERE shipment_id=$1',[id]);
      const saved=await this.row(m,id); await this.event(m,saved,'DISPATCHED',user,'All containers dispatched in one transaction. Contents are locked.',manifest);
      return this.view(m,saved);
    });
  }
  async labels(id: string, revision: number, user: string): Promise<CoaterPackingSlip> {
    return this.transaction(async m => {
      const row=await this.row(m,id);
      if (row.status==='CANCELED' || row.revision!==revision) throw new ConflictException('Refresh the active shipment revision before printing labels.');
      if (row.status==='DRAFT') await this.verifyReviewed(m,row,revision);
      const [previous]=await m.query("SELECT id FROM dana_coater_shipment_events_v1 WHERE shipment_id=$1 AND revision=$2 AND kind IN ('LABELS_REQUESTED','LABELS_REPRINT_REQUESTED') LIMIT 1",[id,revision]);
      const slip: CoaterPackingSlip={shipment:await this.view(m,row),reprint:!!previous || row.status==='DISPATCHED',requested_at:new Date().toISOString(),requested_by:await this.actor(m,user)};
      await this.event(m,row,slip.reprint?'LABELS_REPRINT_REQUESTED':'LABELS_REQUESTED',user,'One 4 × 6 label per container. Labels do not replace the combined packing slip.',slip);
      return slip;
    });
  }
  async cancel(id: string,revision: number,reason: string,user: string) {
    return this.transaction(async m => {
      const row=await this.row(m,id); this.draft(row,revision);
      if (!reason.trim() || reason.trim().length>1000) throw new BadRequestException('Enter a cancellation reason (1–1000 characters).');
      await m.query("UPDATE dana_coater_shipments_v1 SET status='CANCELED',updated_at=clock_timestamp() WHERE id=$1",[id]);
      await m.query('UPDATE dana_coater_shipment_containers_v1 SET reserved=false WHERE shipment_id=$1',[id]);
      const saved=await this.row(m,id); await this.event(m,saved,'CANCELED',user,reason.trim());
      return this.view(m,saved);
    });
  }
}
