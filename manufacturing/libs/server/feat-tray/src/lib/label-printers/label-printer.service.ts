import { Socket } from 'node:net';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LabelLanguage, LabelType, SaveLabelPrinterDto } from './label-printer.dto';
import { ensureLabelPrinterSchema } from './label-printer-schema';

export interface LabelPrinterRow {
  id: string;
  name: string;
  host: string;
  port: number;
  label_type: LabelType;
  language: LabelLanguage;
  is_default: boolean;
  enabled: boolean;
  updated_at: string;
}

/** Where one print job goes. `id` is null for the printer set in the server environment. */
export interface LabelPrinterTarget {
  id: string | null;
  name: string;
  host: string;
  port: number;
  language: LabelLanguage;
}

export type LabelPrinterSendResult = { ok: true } | { ok: false; reason: string };

const COLUMNS = 'id, name, host, port, label_type, language, is_default, enabled, updated_at';
const ENVIRONMENT_PRINTER_NAME = 'Server default printer';

/**
 * The label printers an administrator has set up, the default for each kind of label, and the
 * raw TCP send. GEAR_LABEL_PRINTER_HOST keeps working as the tag printer until a default tag
 * printer is chosen in Admin.
 */
@Injectable()
export class LabelPrinterService implements OnModuleInit {
  private readonly logger = new Logger(LabelPrinterService.name);
  private schemaReady = false;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (this.dataSource.options?.type !== 'postgres') return;
    try {
      await ensureLabelPrinterSchema(this.dataSource);
      this.schemaReady = true;
    } catch (error) {
      // Printing through GEAR_LABEL_PRINTER_HOST must keep working even if the table cannot be created.
      this.logger.error(`Label printer table is not available: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Everything, for Admin. */
  async adminList() {
    const environment = this.environmentPrinter();
    return {
      available: this.schemaReady,
      printers: this.schemaReady
        ? await this.rows(`SELECT ${COLUMNS} FROM public.gear_label_printers ORDER BY label_type, lower(name)`)
        : [],
      environment_printer: environment ? { host: environment.host, port: environment.port, language: environment.language } : null,
    };
  }

  /** What an operator may choose from: names only, never addresses. */
  async choices(labelType: LabelType) {
    const printers = this.schemaReady
      ? await this.rows(
          `SELECT ${COLUMNS} FROM public.gear_label_printers WHERE label_type = $1 AND enabled ORDER BY is_default DESC, lower(name)`,
          [labelType],
        )
      : [];
    const fallback = await this.resolve(labelType);
    return {
      label_type: labelType,
      printers: printers.map(({ id, name, language, is_default }) => ({ id, name, language, is_default })),
      default_printer_name: fallback?.name ?? null,
    };
  }

  async create(dto: SaveLabelPrinterDto, userId: string): Promise<LabelPrinterRow> {
    this.requireSchema();
    return this.save(null, dto, userId);
  }

  async update(id: string, dto: SaveLabelPrinterDto, userId: string): Promise<LabelPrinterRow> {
    this.requireSchema();
    return this.save(id, dto, userId);
  }

  async remove(id: string): Promise<{ removed: true }> {
    this.requireSchema();
    const removed = await this.rows(`DELETE FROM public.gear_label_printers WHERE id = $1 RETURNING ${COLUMNS}`, [id]);
    if (!removed.length) throw new NotFoundException('That printer no longer exists.');
    return { removed: true };
  }

  /** Opens and closes a connection. Nothing is printed. */
  async test(id: string): Promise<{ ok: boolean; message: string }> {
    this.requireSchema();
    const [printer] = await this.rows(`SELECT ${COLUMNS} FROM public.gear_label_printers WHERE id = $1`, [id]);
    if (!printer) throw new NotFoundException('That printer no longer exists.');
    const result = await this.send(printer, null);
    return result.ok
      ? { ok: true, message: `${printer.name} answered at ${printer.host}:${printer.port}.` }
      : { ok: false, message: result.reason };
  }

  /**
   * The printer for one job: the one chosen on the operator's computer, else the default for
   * that label, else (tags only) the printer from the server environment. Null: none set up.
   */
  async resolve(labelType: LabelType, printerId?: string | null): Promise<LabelPrinterTarget | null> {
    if (printerId) {
      const [chosen] = this.schemaReady
        ? await this.rows(
            `SELECT ${COLUMNS} FROM public.gear_label_printers WHERE id = $1 AND label_type = $2 AND enabled`,
            [printerId, labelType],
          )
        : [];
      if (!chosen) {
        throw new BadRequestException('The printer chosen on this computer is no longer available. Choose a printer again.');
      }
      return chosen;
    }
    if (this.schemaReady) {
      const [preferred] = await this.rows(
        `SELECT ${COLUMNS} FROM public.gear_label_printers WHERE label_type = $1 AND enabled AND is_default`,
        [labelType],
      );
      if (preferred) return preferred;
    }
    return labelType === 'ASSET_TAG' ? this.environmentPrinter() : null;
  }

  /** Sends raw bytes to the printer, or with no payload only checks that it answers. */
  send(target: LabelPrinterTarget, payload: Buffer | null): Promise<LabelPrinterSendResult> {
    const timeoutMs = positiveInteger(process.env['GEAR_LABEL_PRINTER_TIMEOUT_MS'], 5000);
    return new Promise((resolve) => {
      const socket = new Socket();
      let settled = false;
      const finish = (failure?: NodeJS.ErrnoException | 'timeout') => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (!failure) return resolve({ ok: true });
        const reason = describeFailure(failure, target, timeoutMs);
        this.logger.warn(`Label printer ${target.name} (${target.host}:${target.port}): ${reason}`);
        resolve({ ok: false, reason });
      };
      socket.setTimeout(timeoutMs);
      socket.once('timeout', () => finish('timeout'));
      socket.once('error', (error) => finish(error));
      socket.connect(target.port, target.host, () => {
        if (payload) socket.end(payload, () => finish());
        else finish();
      });
    });
  }

  private async save(id: string | null, dto: SaveLabelPrinterDto, userId: string): Promise<LabelPrinterRow> {
    const name = dto.name.trim();
    const host = dto.host.trim().toLowerCase();
    const enabled = dto.enabled ?? true;
    if (!name) throw new BadRequestException('Give the printer a name operators will recognise.');
    try {
      return await this.dataSource.transaction(async (manager) => {
        const others = (await manager.query(
          `SELECT count(*)::int AS defaults FROM public.gear_label_printers
            WHERE label_type = $1 AND is_default AND ($2::uuid IS NULL OR id <> $2::uuid)`,
          [dto.label_type, id],
        )) as Array<{ defaults: number }>;
        // The first working printer for a label becomes its default, so printing works without a second step.
        const isDefault = enabled && (dto.is_default === true || (dto.is_default !== false && others[0].defaults === 0));
        if (isDefault) {
          await manager.query(
            `UPDATE public.gear_label_printers SET is_default = false, updated_at = clock_timestamp()
              WHERE label_type = $1 AND is_default AND ($2::uuid IS NULL OR id <> $2::uuid)`,
            [dto.label_type, id],
          );
        }
        const values = [name, host, dto.port, dto.label_type, dto.language, isDefault, enabled, userId];
        const saved = (id
          ? await manager.query(
              `UPDATE public.gear_label_printers
                  SET name = $1, host = $2, port = $3, label_type = $4, language = $5, is_default = $6, enabled = $7,
                      updated_by = $8, updated_at = clock_timestamp()
                WHERE id = $9 RETURNING ${COLUMNS}`,
              [...values, id],
            )
          : await manager.query(
              `INSERT INTO public.gear_label_printers (name, host, port, label_type, language, is_default, enabled, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
              values,
            )) as unknown;
        // node-postgres returns [rows, count] for UPDATE ... RETURNING and rows for INSERT ... RETURNING.
        const rows = (Array.isArray(saved) && Array.isArray(saved[0]) ? saved[0] : saved) as LabelPrinterRow[];
        if (!rows.length) throw new NotFoundException('That printer no longer exists.');
        return rows[0];
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(`A printer named ${name} already exists.`);
      }
      throw error;
    }
  }

  private async rows(sql: string, parameters: unknown[] = []): Promise<LabelPrinterRow[]> {
    const result = (await this.dataSource.query(sql, parameters)) as unknown;
    return (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as LabelPrinterRow[];
  }

  private requireSchema(): void {
    if (!this.schemaReady) {
      throw new ServiceUnavailableException('Label printers cannot be saved because the printer table could not be created. Check the API log.');
    }
  }

  private environmentPrinter(): LabelPrinterTarget | null {
    const host = process.env['GEAR_LABEL_PRINTER_HOST']?.trim() ?? '';
    if (!host) return null;
    return {
      id: null,
      name: ENVIRONMENT_PRINTER_NAME,
      host,
      port: positiveInteger(process.env['GEAR_LABEL_PRINTER_PORT'], 9100),
      language: process.env['GEAR_LABEL_PRINTER_LANGUAGE']?.trim().toUpperCase() === 'ZPL' ? 'ZPL' : 'IPL',
    };
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Says what to check, in the terms of whoever is standing at the printer. */
function describeFailure(failure: NodeJS.ErrnoException | 'timeout', target: LabelPrinterTarget, timeoutMs: number): string {
  const where = `${target.host}:${target.port}`;
  if (failure === 'timeout' || failure.code === 'ETIMEDOUT') {
    return `No answer from ${where} within ${Math.round(timeoutMs / 1000)} seconds. Check the address, that the printer is switched on, and that the Gear Apps server can reach the printer's network.`;
  }
  switch (failure.code) {
    case 'ECONNREFUSED':
      return `${target.host} refused the connection on port ${target.port}. Check the port (raw printing is normally 9100) and that the printer is ready.`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `The name ${target.host} could not be found. Use the printer's IP address.`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `The Gear Apps server has no network route to ${target.host}.`;
    case 'ECONNRESET':
    case 'EPIPE':
      return `${where} closed the connection before the label was sent.`;
    default:
      return `Could not send to ${where}${failure.code ? ` (${failure.code})` : ''}.`;
  }
}
