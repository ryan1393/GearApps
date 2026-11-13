import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UpdateDockAgingSettingsDto } from './dto/update-dock-aging-settings.dto';
import { UpdateGatePrintingSettingsDto } from './dto/update-gate-printing-settings.dto';

const DEFAULT_DOCK_WARNING_MINUTES = 15;
const DEFAULT_DOCK_CRITICAL_MINUTES = 30;

@Injectable()
export class AppSettingsService {
  constructor(private readonly dataSource: DataSource) {}

  private parsePositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  async getDockAging() {
    const rows = await this.dataSource.query(
      `SELECT key, value
         FROM app_settings
        WHERE key IN ('dock_warning_minutes', 'dock_critical_minutes')`,
    );

    const values = new Map<string, string>();
    for (const row of rows) {
      if (row?.key && row?.value != null) values.set(String(row.key), String(row.value));
    }

    const warningMinutes = this.parsePositiveInt(
      values.get('dock_warning_minutes'),
      DEFAULT_DOCK_WARNING_MINUTES,
    );
    const criticalMinutes = this.parsePositiveInt(
      values.get('dock_critical_minutes'),
      DEFAULT_DOCK_CRITICAL_MINUTES,
    );

    return {
      warningMinutes,
      criticalMinutes: criticalMinutes > warningMinutes
        ? criticalMinutes
        : Math.max(warningMinutes + 1, DEFAULT_DOCK_CRITICAL_MINUTES),
    };
  }

  async updateDockAging(dto: UpdateDockAgingSettingsDto) {
    if (dto.criticalMinutes <= dto.warningMinutes) {
      throw new BadRequestException('Red threshold must be greater than the yellow threshold.');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO app_settings(key, value, description)
         VALUES('dock_warning_minutes', $1, 'Minutes at an assigned dock before the truck is highlighted yellow')
         ON CONFLICT(key) DO UPDATE
           SET value = EXCLUDED.value,
               description = EXCLUDED.description,
               updated_at = NOW()`,
        [String(dto.warningMinutes)],
      );
      await manager.query(
        `INSERT INTO app_settings(key, value, description)
         VALUES('dock_critical_minutes', $1, 'Minutes at an assigned dock before the truck is highlighted red')
         ON CONFLICT(key) DO UPDATE
           SET value = EXCLUDED.value,
               description = EXCLUDED.description,
               updated_at = NOW()`,
        [String(dto.criticalMinutes)],
      );
    });

    return this.getDockAging();
  }

  /** Read the centrally saved gate mapping. No printer jobs or credentials are created. */
  async getGatePrinting(): Promise<{ eastPrinter: string; westPrinter: string }> {
    const rows: Array<{ key: string; value: string | null }> =
      await this.dataSource.query(
        `SELECT key, value
           FROM app_settings
          WHERE key IN ('driver_print_east_printer', 'driver_print_west_printer')`,
      );
    const values = new Map<string, string>();
    for (const row of rows) {
      if (row?.key && typeof row.value === 'string' && row.value.trim()) {
        values.set(row.key, row.value.trim());
      }
    }
    // Keep the established webpage defaults. These names still must match the Windows
    // agent's advertised outputPrinter values before physical printing is ready.
    return {
      eastPrinter: values.get('driver_print_east_printer') || 'USFTWP_E_Gate_Pass',
      westPrinter: values.get('driver_print_west_printer') || 'USFTWP_W_Gate_Pass',
    };
  }

  /** Save both mappings in one transaction; never rewrite existing print items. */
  async updateGatePrinting(
    dto: UpdateGatePrintingSettingsDto,
  ): Promise<{ eastPrinter: string; westPrinter: string }> {
    const eastPrinter = this.normalizeGatePrinter(dto?.eastPrinter, 'East');
    const westPrinter = this.normalizeGatePrinter(dto?.westPrinter, 'West');
    if (eastPrinter.toLowerCase() === westPrinter.toLowerCase()) {
      throw new BadRequestException('East and West Gate must use different printers.');
    }
    await this.dataSource.transaction(async (manager) => {
      const settings: Array<[string, string, string]> = [
        ['driver_print_east_printer', eastPrinter, 'RXO driver-paperwork printer for East Gate'],
        ['driver_print_west_printer', westPrinter, 'RXO driver-paperwork printer for West Gate'],
      ];
      for (const [key, value, description] of settings) {
        await manager.query(
          `INSERT INTO app_settings(key, value, description)
           VALUES ($1, $2, $3)
           ON CONFLICT(key) DO UPDATE
             SET value = EXCLUDED.value,
                 description = EXCLUDED.description,
                 updated_at = NOW()`,
          [key, value, description],
        );
      }
    });
    // Return this committed pair, not a second read that could race another save.
    return { eastPrinter, westPrinter };
  }

  private normalizeGatePrinter(value: unknown, gate: 'East' | 'West'): string {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new BadRequestException(`${gate} Gate printer must be a valid printer name.`);
    }
    const printer = value.trim();
    if (!printer || printer.length > 255) {
      throw new BadRequestException(`${gate} Gate printer must contain 1 to 255 characters.`);
    }
    return printer;
  }
}
