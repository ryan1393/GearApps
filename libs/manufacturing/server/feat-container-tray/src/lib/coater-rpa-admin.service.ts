import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ServerUtilMailerService } from '@meshforge/manufacturing/server/util-mailer';
import { CoaterRpaPartMapDto, CoaterRpaSettingsDto } from './coater-rpa-admin.dto';
import { inspectRpaWorkbook, RpaWorkbookInfo } from './coater-rpa-workbook';

export const RPA_FORM_MAX_BYTES = 2 * 1024 * 1024;

export interface CoaterRpaSetup {
  /** Null until an administrator saves the settings or they are imported. */
  settings: {
    coater_display_name: string;
    next_number: number;
    unit_price: number;
    insurance_unit: number;
    recipients_to: string[];
    recipients_cc: string[];
    default_po: string | null;
    default_po_expires_on: string | null;
    default_po_enabled: boolean;
    updated_at: string;
  } | null;
  /** The Excel form in use: uploaded here, or the workbook of the earliest imported request. */
  form: {
    source: 'UPLOADED' | 'SAVED_REQUEST';
    file_name: string;
    uploaded_at: string | null;
    size: number;
    /** Set when the stored form can no longer be read; requests cannot be prepared until it is replaced. */
    problem: string | null;
    found: RpaWorkbookInfo | null;
  } | null;
  part_map: Array<{ summary: string; part_type: 'RING' | 'PINION'; outer_part: string; inner_part: string }>;
  /** The highest RPA number already issued, so the next number is not set below it. */
  last_number: number | null;
  email_enabled: boolean;
  /** True when a request can be prepared: a form, settings and at least one part mapping. */
  ready: boolean;
}

interface StoredForm { document: Buffer; file_name: string; uploaded_at: Date | null; source: 'UPLOADED' | 'SAVED_REQUEST' }

/** Admin > Coater RPA: the Excel form, the request settings and the part mappings. */
@Injectable()
export class CoaterRpaAdminService {
  constructor(
    @InjectDataSource() private readonly source: DataSource,
    private readonly mailer: ServerUtilMailerService,
  ) {}

  private async storedForm(): Promise<StoredForm | null> {
    const [form] = await this.source.query(`SELECT document, file_name, uploaded_at, source FROM (
      SELECT document, file_name, uploaded_at, 'UPLOADED' AS source, 0 AS number FROM dana_rpa_template_v1
      UNION ALL
      SELECT document, 'RPA-' || number || '.xlsx', NULL, 'SAVED_REQUEST', number FROM dana_rpa_requests_v1
    ) forms ORDER BY source DESC, number LIMIT 1`);
    return form ?? null;
  }

  async setup(): Promise<CoaterRpaSetup> {
    const [settings] = await this.source.query(`SELECT coater_display_name, next_number, unit_price, insurance_unit,
      recipients_to, recipients_cc, default_po, default_po_expires_on::text AS default_po_expires_on,
      default_po_enabled, updated_at FROM dana_rpa_settings_v1 WHERE id=1`);
    const stored = await this.storedForm();
    let found: RpaWorkbookInfo | null = null;
    let problem: string | null = null;
    if (stored) {
      try { found = inspectRpaWorkbook(stored.document); }
      catch (error) { problem = error instanceof Error ? error.message : 'The stored form cannot be read.'; }
    }
    const part_map = await this.source.query(
      'SELECT summary, part_type, outer_part, inner_part FROM dana_rpa_part_map_v1 ORDER BY summary, part_type');
    const [{ last_number }] = await this.source.query('SELECT MAX(number) AS last_number FROM dana_rpa_requests_v1');
    return {
      settings: settings ? {
        ...settings, unit_price: Number(settings.unit_price), insurance_unit: Number(settings.insurance_unit),
        updated_at: new Date(settings.updated_at).toISOString(),
      } : null,
      form: stored ? {
        source: stored.source, file_name: stored.file_name, size: stored.document.length, problem, found,
        uploaded_at: stored.uploaded_at ? new Date(stored.uploaded_at).toISOString() : null,
      } : null,
      part_map, last_number, email_enabled: this.mailer.enabled,
      ready: !!settings && !!found && part_map.length > 0,
    };
  }

  async saveSettings(dto: CoaterRpaSettingsDto, user: string): Promise<CoaterRpaSetup> {
    const po = dto.default_po?.trim() || null;
    const expires = dto.default_po_expires_on || null;
    if (dto.default_po_enabled && (!po || !expires)) {
      throw new BadRequestException('A default PO needs the PO and the date it expires.');
    }
    if (po && /[\p{Cc}]/u.test(po)) throw new BadRequestException('Enter a valid purchase order.');
    const clean = (list: string[]) => [...new Set(list.map(address => address.trim().toLowerCase()).filter(Boolean))];
    await this.source.transaction(async manager => {
      const [{ last_number }] = await manager.query('SELECT MAX(number) AS last_number FROM dana_rpa_requests_v1');
      if (last_number !== null && dto.next_number <= last_number) {
        throw new ConflictException(`RPA ${last_number} has already been issued. The next number must be higher.`);
      }
      await manager.query(`INSERT INTO dana_rpa_settings_v1
        (id, coater_display_name, next_number, unit_price, insurance_unit, recipients_to, recipients_cc,
         default_po, default_po_expires_on, default_po_enabled, updated_at, updated_by)
        VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp(),$10)
        ON CONFLICT (id) DO UPDATE SET coater_display_name=EXCLUDED.coater_display_name, next_number=EXCLUDED.next_number,
          unit_price=EXCLUDED.unit_price, insurance_unit=EXCLUDED.insurance_unit, recipients_to=EXCLUDED.recipients_to,
          recipients_cc=EXCLUDED.recipients_cc, default_po=EXCLUDED.default_po,
          default_po_expires_on=EXCLUDED.default_po_expires_on, default_po_enabled=EXCLUDED.default_po_enabled,
          updated_at=EXCLUDED.updated_at, updated_by=EXCLUDED.updated_by`,
        [dto.coater_display_name.trim(), dto.next_number, dto.unit_price, dto.insurance_unit,
          clean(dto.recipients_to), clean(dto.recipients_cc), po, expires, dto.default_po_enabled, user]);
    });
    return this.setup();
  }

  async uploadForm(file: { buffer: Buffer; originalname: string } | undefined, user: string): Promise<CoaterRpaSetup> {
    if (!file?.buffer?.length) throw new BadRequestException('Choose the RPA Excel form (.xlsx) to upload.');
    if (file.buffer.length > RPA_FORM_MAX_BYTES) throw new BadRequestException('The form is larger than 2 MB.');
    try { inspectRpaWorkbook(file.buffer); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'The form could not be read.'); }
    // Keep a plain file name: no path, no control characters.
    const name = (file.originalname.split(/[\\/]/).pop() ?? '').replace(/[\p{Cc}"]/gu, '').trim().slice(0, 120) || 'rpa-form.xlsx';
    await this.source.query(`INSERT INTO dana_rpa_template_v1 (id, document, file_name, uploaded_at, uploaded_by)
      VALUES (1,$1,$2,clock_timestamp(),$3)
      ON CONFLICT (id) DO UPDATE SET document=EXCLUDED.document, file_name=EXCLUDED.file_name,
        uploaded_at=EXCLUDED.uploaded_at, uploaded_by=EXCLUDED.uploaded_by`, [file.buffer, name, user]);
    return this.setup();
  }

  async form(): Promise<{ document: Buffer; file_name: string }> {
    const stored = await this.storedForm();
    if (!stored) throw new NotFoundException('No RPA form has been uploaded or imported.');
    return stored;
  }

  async saveMapping(dto: CoaterRpaPartMapDto): Promise<CoaterRpaSetup> {
    const stored = await this.storedForm();
    if (stored) {
      let parts: string[] = [];
      try { parts = inspectRpaWorkbook(stored.document).parts; } catch { /* reported on the Admin page */ }
      const unknown = [dto.outer_part.trim(), dto.inner_part.trim()].filter(part => parts.length && !parts.includes(part));
      if (unknown.length) throw new BadRequestException(`The RPA form has no part named ${unknown.join(' or ')}.`);
    }
    const summary = dto.summary.trim().toUpperCase();
    await this.source.transaction(async manager => {
      // Imported rows may differ only in case or spacing; one summary and part type has one mapping.
      await manager.query('DELETE FROM dana_rpa_part_map_v1 WHERE upper(btrim(summary))=$1 AND part_type=$2', [summary, dto.part_type]);
      await manager.query(`INSERT INTO dana_rpa_part_map_v1 (summary, part_type, outer_part, inner_part)
        VALUES ($1,$2,$3,$4)`, [summary, dto.part_type, dto.outer_part.trim(), dto.inner_part.trim()]);
    });
    return this.setup();
  }

  async removeMapping(summary: string, partType: string): Promise<CoaterRpaSetup> {
    await this.source.query('DELETE FROM dana_rpa_part_map_v1 WHERE upper(btrim(summary))=$1 AND part_type=$2',
      [summary.trim().toUpperCase(), partType]);
    return this.setup();
  }
}
