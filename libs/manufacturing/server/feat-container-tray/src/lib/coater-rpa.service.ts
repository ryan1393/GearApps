import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CoaterManifest, CoaterRpaState } from '@meshforge/manufacturing/shared/util-types';
import { ServerUtilMailerService } from '@meshforge/manufacturing/server/util-mailer';
import { fillRpaWorkbook, RpaLine } from './coater-rpa-workbook';

const requestFields = `r.number, r.po, r.recipients_to, r.recipients_cc,
  CASE WHEN r.email_status = 'SENDING' AND r.email_started_at < clock_timestamp() - interval '15 minutes'
    THEN 'UNKNOWN' ELSE r.email_status END AS email_status`;

@Injectable()
export class CoaterRpaService {
  constructor(
    @InjectDataSource() private readonly source: DataSource,
    private readonly mailer: ServerUtilMailerService,
  ) {}

  async state(manager: EntityManager, shipmentId: string, revision: number): Promise<CoaterRpaState> {
    const [config] = await manager.query(`SELECT coater_display_name,
      CASE WHEN default_po_enabled AND default_po_expires_on >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Indiana/Indianapolis')::date
        THEN default_po END AS default_po,
      (EXISTS (SELECT 1 FROM dana_rpa_template_v1) OR EXISTS (SELECT 1 FROM dana_rpa_requests_v1)) AS has_template
      FROM dana_rpa_settings_v1 WHERE id=1`);
    const [request] = await manager.query(`SELECT ${requestFields} FROM dana_rpa_requests_v1 r
      WHERE r.shipment_id=$1 AND r.revision=$2`, [shipmentId, revision]);
    return {
      configured: !!config?.has_template,
      coater_name: config?.coater_display_name ?? null,
      default_po: config?.default_po ?? null,
      email_enabled: this.mailer.enabled,
      request: request ? {
        number: request.number, po: request.po, email_status: request.email_status,
        recipient_count: request.recipients_to.length ? request.recipients_to.length + request.recipients_cc.length : 0,
      } : null,
    };
  }

  async prepare(manager: EntityManager, shipment: {
    id: string; revision: number; manifest: CoaterManifest;
  }, manualPo: string | undefined, user: string): Promise<number | null> {
    const [existing] = await manager.query('SELECT number,po FROM dana_rpa_requests_v1 WHERE shipment_id=$1 AND revision=$2',
      [shipment.id, shipment.revision]);
    if (existing) {
      if (manualPo?.trim() && manualPo.trim() !== existing.po) {
        throw new ConflictException('This revision already has an RPA with a different PO.');
      }
      return null;
    }
    const [settings] = await manager.query(`SELECT *, default_po_expires_on::text AS expires_on,
      (CURRENT_TIMESTAMP AT TIME ZONE 'America/Indiana/Indianapolis')::date::text AS today
      FROM dana_rpa_settings_v1 WHERE id=1 FOR UPDATE`);
    // The form uploaded in Admin > Coater RPA, or else the workbook of the earliest imported request.
    const [template] = await manager.query(`SELECT document FROM (
      SELECT document, 0 AS source, 0 AS number FROM dana_rpa_template_v1
      UNION ALL SELECT document, 1, number FROM dana_rpa_requests_v1) forms ORDER BY source, number LIMIT 1`);
    if (!settings || !template) throw new ConflictException('Set up the RPA form and settings in Admin > Coater RPA before preparing requests.');

    const override = manualPo?.trim();
    const defaultValid = settings.default_po_enabled && settings.expires_on >= settings.today;
    const po: string | null = override || (defaultValid ? settings.default_po : null);
    if (!po || po.length > 80 || /[\p{Cc}]/u.test(po)) throw new BadRequestException('Enter a valid purchase order for this RPA.');

    const [{ number }] = await manager.query(`SELECT GREATEST($1::integer, COALESCE(MAX(number)+1, 1)) AS number
      FROM dana_rpa_requests_v1`, [settings.next_number]);
    if (number >= 9999999) throw new ConflictException('The RPA number range is exhausted.');
    const lines = await this.lines(manager, shipment.manifest);
    let document: Buffer;
    try {
      document = fillRpaWorkbook(template.document, {
        number, po, date: settings.today, lines,
        unitPrice: Number(settings.unit_price), insuranceUnit: Number(settings.insurance_unit),
      });
    } catch (error) {
      throw new ConflictException(error instanceof Error ? error.message : 'The saved RPA form could not be filled.');
    }
    await manager.query(`INSERT INTO dana_rpa_requests_v1
      (id,shipment_id,revision,number,po,document,details,recipients_to,recipients_cc,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`, [randomUUID(), shipment.id, shipment.revision,
      number, po, document, JSON.stringify(lines), settings.recipients_to, settings.recipients_cc, user]);
    await manager.query('UPDATE dana_rpa_settings_v1 SET next_number=$1 WHERE id=1', [number + 1]);
    await manager.query(`UPDATE dana_coater_shipments_v1 SET po=$2,po_source=$3,coater_legal_name=$4 WHERE id=$1`,
      [shipment.id, po, override ? 'MANUAL' : 'ADMIN_DEFAULT', settings.coater_display_name]);
    return number;
  }

  private async lines(manager: EntityManager, manifest: CoaterManifest): Promise<RpaLine[]> {
    const mappings = new Map<string, { outer_part: string; inner_part: string }>();
    for (const row of await manager.query('SELECT summary,part_type,outer_part,inner_part FROM dana_rpa_part_map_v1')) {
      mappings.set(JSON.stringify([row.summary.trim().toUpperCase(), row.part_type]), row);
    }
    const lines = new Map<string, RpaLine>();
    for (const { trays } of manifest.containers) for (const tray of trays) {
      const summary = tray.summary.trim().toUpperCase();
      const mapping = mappings.get(JSON.stringify([summary, tray.part_type]));
      if (!mapping) throw new ConflictException(`No RPA part mapping for ${summary} ${tray.part_type}.`);
      // Tray quantities count matched sets: 13 means 13 inner AND 13 outer blades.
      const per_side = tray.count;
      if (!Number.isSafeInteger(per_side) || per_side < 1) throw new ConflictException(`Tray ${tray.serial} does not have a valid inner and outer set count.`);
      const key = JSON.stringify([summary, tray.part_type, per_side]);
      const line = lines.get(key);
      if (line) line.trays++;
      else lines.set(key, { summary, part_type: tray.part_type, trays: 1, per_side,
        outer_part: mapping.outer_part, inner_part: mapping.inner_part });
    }
    return [...lines.values()];
  }

  async document(shipmentId: string, revision: number): Promise<{ number: number; document: Buffer }> {
    const [request] = await this.source.query('SELECT number,document FROM dana_rpa_requests_v1 WHERE shipment_id=$1 AND revision=$2',
      [shipmentId, revision]);
    if (!request) throw new NotFoundException('RPA request not found.');
    return request;
  }

  async email(shipmentId: string, revision: number): Promise<void> {
    if (!this.mailer.enabled) throw new ServiceUnavailableException('RPA email is disabled. Download the workbook or configure SMTP.');
    const request = await this.source.transaction(async manager => {
      const [row] = await manager.query(`SELECT r.id,r.document,${requestFields} FROM dana_rpa_requests_v1 r
        JOIN dana_coater_shipments_v1 s ON s.id=r.shipment_id AND s.revision=r.revision
        WHERE r.shipment_id=$1 AND r.revision=$2 AND s.status <> 'CANCELED' FOR UPDATE OF s,r`, [shipmentId, revision]);
      if (!row) throw new NotFoundException('RPA request not found for the active shipment revision.');
      if (row.email_status === 'SENT') return null;
      if (!['PENDING', 'FAILED'].includes(row.email_status)) {
        throw new ConflictException('Delivery is in progress or unconfirmed. Check with the recipient before sending again.');
      }
      if (!row.recipients_to.length) throw new ConflictException('This RPA has no email recipients. Download the workbook to send it manually.');
      await manager.query(`UPDATE dana_rpa_requests_v1 SET email_status='SENDING',email_error=NULL,
        email_started_at=clock_timestamp(),email_attempts=email_attempts+1 WHERE id=$1`, [row.id]);
      return row;
    });
    if (!request) return;

    let status = 'SENT';
    let errorMessage: string | null = null;
    try {
      const result = await this.mailer.sendAttachment({
        to: request.recipients_to, cc: request.recipients_cc, subject: `RPA ${request.number}`,
        text: `Attached is RPA ${request.number} for PO ${request.po}.`,
        attachments: [{ filename: `RPA-${request.number}.xlsx`, content: request.document }],
      });
      if (!result.accepted?.length || result.rejected?.length) {
        status = 'UNKNOWN';
        errorMessage = 'SMTP did not confirm acceptance for the full recipient list.';
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      status = ['EAUTH', 'EENVELOPE', 'ECONNREFUSED', 'EDNS'].includes(code ?? '') ? 'FAILED' : 'UNKNOWN';
      errorMessage = status === 'FAILED' ? 'SMTP rejected the request before delivery.' : 'SMTP delivery could not be confirmed.';
    }
    await this.source.query(`UPDATE dana_rpa_requests_v1 SET email_status=$2,email_error=$3,
      email_sent_at=CASE WHEN $2='SENT' THEN clock_timestamp() END WHERE id=$1 AND email_status='SENDING'`,
      [request.id, status, errorMessage]);
  }
}
