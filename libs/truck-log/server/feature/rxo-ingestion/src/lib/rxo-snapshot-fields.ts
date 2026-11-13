import * as path from 'node:path';
import type { Direction, Row } from './rxo-snapshot.types';
import { RXO_BOUNDARY_FILE } from './rxo-ingestion-paths';

export const ORDER_EXPORT_HEADERS = {
  originAddressLine1: 'Origin Address Line 1',
  originAddressLine2: 'Origin Address Line 2',
  destinationAddressLine1: 'Destination Address Line 1',
  destinationAddressLine2: 'Destination Address Line 2',
  earlyPickupDate: 'Early Pickup Date',
  earlyPickupTime: 'Early Pickup Time',
  latePickupDate: 'Late Pickup Date',
  latePickupTime: 'Late Pickup Time',
  earlyDeliveryDate: 'Early Delivery Date',
  earlyDeliveryTime: 'Early Delivery Time',
  lateDeliveryDate: 'Late Delivery Date',
  lateDeliveryTime: 'Late Delivery Time',
} as const;

/**
 * Cell/field normalization and plant-time date parsing for RXO export rows.
 * Base of RxoSnapshotReader; contains no file or workbook I/O.
 */
export class RxoSnapshotFields {
  constructor(
    protected readonly latestRootPath: string,
    protected readonly timeZone: string,
  ) {}

  protected latestRoot() {
    return this.latestRootPath;
  }

  protected plantTimeZone() {
    return this.timeZone;
  }

  protected boundaryPath() {
    return path.join(this.latestRootPath, RXO_BOUNDARY_FILE);
  }

  private cellText(value: unknown): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (value && typeof value === 'object') {
      const v = value as any;
      if (v.result != null) return String(v.result);
      if (v.text != null) return String(v.text);
      if (Array.isArray(v.richText)) return v.richText.map((x: any) => x?.text ?? '').join('');
    }
    return String(value ?? '');
  }

  text(value: unknown) {
    return this.cellText(value).replace(/\s+/g, ' ').trim();
  }

  protected canonical(value: unknown) {
    return this.text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  protected field(row: Row, names: string[]) {
    const map = new Map(Object.keys(row).map((key) => [this.canonical(key), key]));
    for (const name of names) {
      const actual = map.get(this.canonical(name));
      if (actual) return row[actual];
    }
    return null;
  }

  protected fieldText(row: Row, names: string[]) {
    const value = this.text(this.field(row, names));
    return value || null;
  }

  protected fieldList(row: Row, names: string[]): string[] {
    // Split before normalizing whitespace: RXO can put one order on each line.
    const value = this.cellText(this.field(row, names));
    return [...new Set<string>(
      value
        .split(/[;,|\r\n]+/)
        .map((item) => this.text(item).toUpperCase())
        .filter((item): item is string => Boolean(item)),
    )];
  }

  protected chunks<T>(items: T[], size = 500) {
    const result: T[][] = [];
    for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
    return result;
  }

  protected composeAddress(row: Row, prefix: 'Origin' | 'Destination') {
    const line1 = prefix === 'Origin'
      ? [ORDER_EXPORT_HEADERS.originAddressLine1, 'Origin Address 1']
      : [ORDER_EXPORT_HEADERS.destinationAddressLine1, 'Destination Address 1'];
    const line2 = prefix === 'Origin'
      ? [ORDER_EXPORT_HEADERS.originAddressLine2, 'Origin Address 2']
      : [ORDER_EXPORT_HEADERS.destinationAddressLine2, 'Destination Address 2'];
    const parts = [
      this.fieldText(row, line1),
      this.fieldText(row, line2),
      this.fieldText(row, [`${prefix} City`]),
      this.fieldText(row, [`${prefix} State`, `${prefix} Province`]),
      this.fieldText(row, [`${prefix} Postal Code`, `${prefix} Zip`, `${prefix} ZIP`]),
      this.fieldText(row, [`${prefix} Country`]),
    ].filter((part): part is string => Boolean(part));
    if (parts.length) return parts.join(', ');
    return this.fieldText(row, [prefix, `${prefix} Address`]);
  }

  protected fieldInt(row: Row, names: string[]) {
    const value = Number.parseInt(this.text(this.field(row, names)).replace(/,/g, ''), 10);
    return Number.isFinite(value) ? value : null;
  }

  protected fieldBool(row: Row, names: string[]) {
    const raw = this.field(row, names);
    if (typeof raw === 'boolean') return raw;
    const value = this.text(raw).toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(value)) return true;
    if (['false', 'no', 'n', '0'].includes(value)) return false;
    return null;
  }

  protected rawRow(row: Row) {
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, this.text(v)]));
  }

  protected zonedDate(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
    let result = new Date(Date.UTC(year, month - 1, day, hour, minute));
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(result).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
      );
      const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
      const wanted = Date.UTC(year, month - 1, day, hour, minute);
      const delta = wanted - observed;
      if (!delta) break;
      result = new Date(result.getTime() + delta);
    }
    return result;
  }

  protected parseDate(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const result = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
      return Number.isNaN(result.getTime()) ? null : result;
    }

    const text = this.text(value);
    if (!text || /^\d{1,2}$/.test(text)) return null;

    const months: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})(?:\s*(ET|CT|MT|PT))?$/i.exec(text);
    if (match) {
      const zones: Record<string, string> = {
        ET: 'America/Indiana/Indianapolis', CT: 'America/Chicago',
        MT: 'America/Denver', PT: 'America/Los_Angeles',
      };
      return this.zonedDate(
        Number(match[3]), months[match[1].slice(0, 3).toLowerCase()], Number(match[2]),
        Number(match[4]), Number(match[5]), match[6] ? (zones[String(match[6]).toUpperCase()] ?? this.plantTimeZone()) : this.plantTimeZone(),
      );
    }

    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
      const result = new Date(text);
      return Number.isNaN(result.getTime()) ? null : result;
    }
    return null;
  }

  protected parsePlantDateAndTime(dateValue: unknown, timeValue: unknown) {
    const dateText = this.text(dateValue);
    const timeText = this.text(timeValue);
    if (!dateText) return null;

    const months: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const dateMatch = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{4})$/i.exec(dateText);
    const timeMatch = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(timeText || '00:00');
    if (!dateMatch || !timeMatch) return this.parseDate(dateValue);

    let hour = Number(timeMatch[1]);
    const meridiem = timeMatch[3]?.toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    if (hour > 23) return null;

    return this.zonedDate(
      Number(dateMatch[3]),
      months[dateMatch[1].slice(0, 3).toLowerCase()],
      Number(dateMatch[2]),
      hour,
      Number(timeMatch[2]),
      this.plantTimeZone(),
    );
  }

  orderStopDate(row: Row, kind: 'pickup' | 'delivery') {
    const label = kind === 'pickup' ? 'Pickup' : 'Delivery';
    const windows = kind === 'pickup'
      ? [
          [ORDER_EXPORT_HEADERS.earlyPickupDate, ORDER_EXPORT_HEADERS.earlyPickupTime],
          [ORDER_EXPORT_HEADERS.latePickupDate, ORDER_EXPORT_HEADERS.latePickupTime],
        ]
      : [
          [ORDER_EXPORT_HEADERS.earlyDeliveryDate, ORDER_EXPORT_HEADERS.earlyDeliveryTime],
          [ORDER_EXPORT_HEADERS.lateDeliveryDate, ORDER_EXPORT_HEADERS.lateDeliveryTime],
        ];
    for (const [dateHeader, timeHeader] of windows) {
      const parsed = this.parsePlantDateAndTime(
        this.field(row, [dateHeader]),
        this.field(row, [timeHeader]),
      );
      if (parsed) return parsed;
    }
    for (const name of [
      `${label} - Appointment Arrival`,
      `${label} Appointment Arrival`,
      `${label} - Estimated Arrival`,
      `${label} Estimated Arrival`,
      `${label} Est. Arrival`,
      `${label} Date`,
    ]) {
      const parsed = this.parseDate(this.field(row, [name]));
      if (parsed) return parsed;
    }
    return null;
  }

  isTerminalStatus(status: string | null | undefined) {
    const value = this.canonical(status);
    return ['delivered', 'complete', 'completed', 'cancelled', 'canceled', 'closed'].includes(value);
  }

  protected scheduleFromRow(row: Row, direction: Direction) {
    const candidates = direction === 'OUTBOUND'
      ? ['Pickup - Appointment Arrival', 'Pickup Appointment Arrival', 'Pickup - Estimated Arrival', 'Pickup Estimated Arrival', 'Pickup Est. Arrival', 'Pickup Date']
      : ['Delivery - Appointment Arrival', 'Delivery Appointment Arrival', 'Delivery - Estimated Arrival', 'Delivery Estimated Arrival', 'Delivery Est. Arrival', 'Delivery Date'];
    for (const name of candidates) {
      const parsed = this.parseDate(this.field(row, [name]));
      if (parsed) return parsed;
    }
    return null;
  }

}
