import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import ExcelJS = require('exceljs');
import { ScheduledLoad, returnedRows } from '@truck-log/server/data-access';
import { scheduledLoadAvailableSql } from '@truck-log/server/domain/rxo';

export interface UploadedScheduleWorkbook {
  originalname: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

type DateParts = { year: number; month: number; day: number };
type TimeParts = { hour: number; minute: number };

type ParsedScheduleRow = {
  rowNumber: number;
  loadNumber: string;
  scheduledAt: Date;
};

const MAX_IMPORT_ROWS = 5000;
const MAX_TEMPLATE_ROWS = 500;

@Injectable()
export class ScheduledLoadsService {
  constructor(
    @InjectRepository(ScheduledLoad) private readonly scheduledLoads: Repository<ScheduledLoad>,
    private readonly dataSource: DataSource,
  ) {}

  normalizeLoadNumber(loadNumber?: string) {
    return loadNumber?.trim().toUpperCase() || '';
  }

  async findActiveByLoadNumber(loadNumber?: string) {
    const normalized = this.normalizeLoadNumber(loadNumber);
    if (!normalized) return null;

    return this.scheduledLoads.createQueryBuilder('scheduledLoad')
      .where('UPPER(scheduledLoad.loadNumber) = :loadNumber', { loadNumber: normalized })
      .andWhere('scheduledLoad.active = true')
      .andWhere(scheduledLoadAvailableSql('scheduledLoad.loadNumber', 'scheduledLoad.source'))
      .orderBy('scheduledLoad.scheduledAt', 'ASC')
      .getOne();
  }

  async lookup(loadNumber?: string) {
    const normalized = this.normalizeLoadNumber(loadNumber);
    const scheduledLoad = await this.findActiveByLoadNumber(normalized);
    return {
      found: Boolean(scheduledLoad),
      loadNumber: normalized,
      scheduledAt: scheduledLoad?.scheduledAt.toISOString() ?? null,
    };
  }

  async listActive(limit = 500) {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 2000) : 500;
    const rows = await this.scheduledLoads.createQueryBuilder('scheduledLoad')
      .where('scheduledLoad.active = true')
      .andWhere(scheduledLoadAvailableSql('scheduledLoad.loadNumber', 'scheduledLoad.source'))
      .orderBy('scheduledLoad.scheduledAt', 'ASC')
      .addOrderBy('scheduledLoad.loadNumber', 'ASC')
      .take(safeLimit)
      .getMany();
    return rows.map((row) => ({
      id: row.id,
      loadNumber: row.loadNumber,
      scheduledAt: row.scheduledAt.toISOString(),
      active: row.active,
      source: row.source,
    }));
  }

  private normalizedHeader(value: unknown) {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private cellScalar(cell: ExcelJS.Cell): unknown {
    const value = cell.value;
    if (value && typeof value === 'object') {
      const objectValue = value as any;
      if ('result' in objectValue && objectValue.result != null) return objectValue.result;
      if ('text' in objectValue) return String(objectValue.text ?? '');
    }
    return value;
  }

  private parseDate(value: unknown): DateParts | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const wholeDays = Math.floor(value);
      const date = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86400000);
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    }
    const text = String(value ?? '').trim();
    let match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/.exec(text);
    if (match) {
      let year = Number(match[3]);
      if (year < 100) year += 2000;
      return { year, month: Number(match[1]), day: Number(match[2]) };
    }
    match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    return null;
  }

  private parseTime(value: unknown): TimeParts | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return { hour: value.getUTCHours(), minute: value.getUTCMinutes() };
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const fraction = value - Math.floor(value);
      const totalMinutes = Math.round(fraction * 24 * 60) % (24 * 60);
      return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
    }
    const text = String(value ?? '').trim().toUpperCase();
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/.exec(text);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const suffix = match[3];
    if (minute < 0 || minute > 59) return null;
    if (suffix) {
      if (hour < 1 || hour > 12) return null;
      if (suffix === 'AM') hour = hour === 12 ? 0 : hour;
      if (suffix === 'PM') hour = hour === 12 ? 12 : hour + 12;
    } else if (hour < 0 || hour > 23) {
      return null;
    }
    return { hour, minute };
  }

  private combineDateTime(date: DateParts, time: TimeParts): Date | null {
    const result = new Date(date.year, date.month - 1, date.day, time.hour, time.minute, 0, 0);
    if (
      result.getFullYear() !== date.year ||
      result.getMonth() !== date.month - 1 ||
      result.getDate() !== date.day ||
      result.getHours() !== time.hour ||
      result.getMinutes() !== time.minute
    ) return null;
    return result;
  }

  private async parseWorkbook(file: UploadedScheduleWorkbook): Promise<ParsedScheduleRow[]> {
    if (!file?.buffer?.length) throw new BadRequestException('Choose an Excel .xlsx file to import.');
    if (!file.originalname?.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Scheduled-load import must be an Excel .xlsx file.');
    }

    const workbook = new ExcelJS.Workbook();
    try {
      // ExcelJS declares its input as ArrayBuffer. Copy only the uploaded view,
      // rather than exposing unused bytes from Node's pooled backing buffer.
      await workbook.xlsx.load(Uint8Array.from(file.buffer).buffer);
    } catch {
      throw new BadRequestException('The uploaded file is not a readable Excel .xlsx workbook.');
    }

    const worksheet = workbook.getWorksheet('Scheduled Loads') ?? workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException('The workbook does not contain a worksheet.');

    const headerRow = worksheet.getRow(1);
    const columns = new Map<string, number>();
    headerRow.eachCell((cell, columnNumber) => {
      const key = this.normalizedHeader(this.cellScalar(cell));
      if (key) columns.set(key, columnNumber);
    });

    const loadColumn = columns.get('loadnumber');
    const dateColumn = columns.get('scheduleddate');
    const timeColumn = columns.get('scheduledtime');
    const missing = [
      !loadColumn ? 'Load Number' : '',
      !dateColumn ? 'Scheduled Date' : '',
      !timeColumn ? 'Scheduled Time' : '',
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`Missing required Excel column(s): ${missing.join(', ')}.`);
    }

    const parsed: ParsedScheduleRow[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    const lastRow = Math.min(worksheet.actualRowCount, MAX_IMPORT_ROWS + 1);

    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const rawLoad = this.cellScalar(row.getCell(loadColumn!));
      const rawDate = this.cellScalar(row.getCell(dateColumn!));
      const rawTime = this.cellScalar(row.getCell(timeColumn!));
      const hasAnyValue = [rawLoad, rawDate, rawTime].some((value) => String(value ?? '').trim() !== '');
      if (!hasAnyValue) continue;

      const loadNumber = this.normalizeLoadNumber(String(rawLoad ?? ''));
      if (!loadNumber) {
        errors.push(`Row ${rowNumber}: Load Number is required.`);
        continue;
      }
      if (loadNumber.length > 120) {
        errors.push(`Row ${rowNumber}: Load Number exceeds 120 characters.`);
        continue;
      }
      if (seen.has(loadNumber)) {
        errors.push(`Row ${rowNumber}: Load Number ${loadNumber} appears more than once in this workbook.`);
        continue;
      }
      seen.add(loadNumber);

      const date = this.parseDate(rawDate);
      const time = this.parseTime(rawTime);
      if (!date) errors.push(`Row ${rowNumber}: Scheduled Date is invalid.`);
      if (!time) errors.push(`Row ${rowNumber}: Scheduled Time is invalid.`);
      if (!date || !time) continue;

      const scheduledAt = this.combineDateTime(date, time);
      if (!scheduledAt) {
        errors.push(`Row ${rowNumber}: Scheduled Date/Time is invalid.`);
        continue;
      }

      parsed.push({ rowNumber, loadNumber, scheduledAt });
    }

    if (worksheet.actualRowCount > MAX_IMPORT_ROWS + 1) {
      errors.push(`Workbook contains more than ${MAX_IMPORT_ROWS} data rows.`);
    }
    if (!parsed.length && !errors.length) errors.push('The Scheduled Loads sheet does not contain any data rows.');
    if (errors.length) {
      const preview = errors.slice(0, 20);
      if (errors.length > preview.length) preview.push(`...and ${errors.length - preview.length} more error(s).`);
      throw new BadRequestException(['Schedule workbook was not imported.', ...preview].join(' '));
    }
    return parsed;
  }

  async importWorkbook(file: UploadedScheduleWorkbook) {
    const rows = await this.parseWorkbook(file);
    const sourceName = `EXCEL_UPLOAD:${file.originalname}`.slice(0, 120);

    const counts = await this.dataSource.transaction(async (manager) => {
      let inserted = 0;
      let updated = 0;
      for (const row of rows) {
        const updatedRows = returnedRows(await manager.query(
          `UPDATE scheduled_loads
              SET scheduled_at = $2,
                  source = $3,
                  active = TRUE,
                  updated_at = NOW()
            WHERE active = TRUE
              AND UPPER(load_number) = UPPER($1)
            RETURNING id`,
          [row.loadNumber, row.scheduledAt, sourceName],
        ));
        if (updatedRows.length) {
          updated += 1;
        } else {
          await manager.query(
            `INSERT INTO scheduled_loads(load_number, scheduled_at, active, source, created_at, updated_at)
             VALUES($1, $2, TRUE, $3, NOW(), NOW())`,
            [row.loadNumber, row.scheduledAt, sourceName],
          );
          inserted += 1;
        }
      }
      return { inserted, updated };
    });

    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM scheduled_loads WHERE active = TRUE
         AND ${scheduledLoadAvailableSql('scheduled_loads.load_number', 'scheduled_loads.source')}`,
    );

    return {
      fileName: file.originalname,
      rows: rows.length,
      inserted: counts.inserted,
      updated: counts.updated,
      activeTotal: Number(count ?? 0),
    };
  }

  async templateWorkbook(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Truck Log';
    workbook.subject = 'Scheduled Loads Import Template';

    const sheet = workbook.addWorksheet('Scheduled Loads', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Load Number', key: 'loadNumber', width: 22 },
      { header: 'Scheduled Date', key: 'scheduledDate', width: 18 },
      { header: 'Scheduled Time', key: 'scheduledTime', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1F36' } };
    sheet.getColumn(1).numFmt = '@';
    sheet.getColumn(2).numFmt = 'mm/dd/yyyy';
    sheet.getColumn(3).numFmt = 'h:mm AM/PM';
    for (let row = 2; row <= MAX_TEMPLATE_ROWS + 1; row += 1) {
      sheet.getCell(row, 2).numFmt = 'mm/dd/yyyy';
      sheet.getCell(row, 3).numFmt = 'h:mm AM/PM';
    }

    const instructions = workbook.addWorksheet('Instructions');
    instructions.columns = [{ width: 16 }, { width: 72 }];
    instructions.addRow(['Scheduled Loads', 'Excel Upload Instructions']);
    instructions.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    instructions.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1F36' } };
    const lines = [
      'Enter one scheduled load per row on the Scheduled Loads sheet.',
      'Do not rename Load Number, Scheduled Date, or Scheduled Time.',
      'Load Number must match the Load Number used during Guard Check-In.',
      'Scheduled Date example: 08/26/2026.',
      'Scheduled Time example: 7:30 AM.',
      'An existing active Load Number is updated; a new Load Number is inserted.',
      'Loads missing from an upload are left unchanged for safety.',
      'If any row is invalid or duplicated, the entire upload is rejected and nothing is partially imported.',
    ];
    lines.forEach((line, index) => instructions.addRow([index + 1, line]));

    const output = await workbook.xlsx.writeBuffer();
    return Buffer.from(output);
  }
}
