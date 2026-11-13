import { BadRequestException } from '@nestjs/common';
import ExcelJS = require('exceljs');
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RxoSnapshotFields } from './rxo-snapshot-fields';
import type {
  Boundary,
  BoundaryDataset,
  DatasetKey,
  Direction,
  ParsedFreight,
  ParsedOrder,
  ParsedShipment,
  Row,
} from './rxo-snapshot.types';

export type {
  Boundary,
  BoundaryDataset,
  DatasetKey,
  Direction,
  ParsedFreight,
  ParsedOrder,
  ParsedShipment,
  Row,
} from './rxo-snapshot.types';

const REQUIRED_IDS = ['12808', 'DANA_USA_FORT_WAYNE_IN'];
const MAX_ROWS = 25000;
const RXO_EXPORT_LIMIT_WARNING_ROWS = 10000;

/**
 * Reads and validates the verified RXO latest snapshot: source boundary,
 * file digests, XLSX workbooks, and row parsing/deduplication into the
 * shapes RxoSnapshotWriter persists. Field and date normalization is
 * inherited from RxoSnapshotFields.
 */
export class RxoSnapshotReader extends RxoSnapshotFields {
  private scalar(cell: ExcelJS.Cell) {
    const value = cell.value as any;
    if (value && typeof value === 'object') {
      if (value.result != null) return value.result;
      if (value.text != null) return value.text;
      if (Array.isArray(value.richText)) return value.richText.map((x: any) => x?.text ?? '').join('');
    }
    return value;
  }

  boundarySourceHash(boundary: Boundary) {
    const sourceContract = {
      contractVersion: boundary.contractVersion,
      sourceBatchId: boundary.sourceBatchId,
      sourceManifestVersion: boundary.sourceManifestVersion ?? null,
      sourceCompletedAt: boundary.sourceCompletedAt ?? null,
      site: boundary.site ?? null,
      directionRule: boundary.directionRule ?? null,
      datasets: [...boundary.datasets]
        .sort((left, right) => `${left.pageKey}|${left.direction}|${left.relativePath}`.localeCompare(`${right.pageKey}|${right.direction}|${right.relativePath}`))
        .map((dataset) => ({
          pageKey: dataset.pageKey,
          direction: dataset.direction,
          relativePath: dataset.relativePath,
          sha256: dataset.sha256 ?? null,
        })),
    };
    return crypto.createHash('sha256').update(JSON.stringify(sourceContract)).digest('hex');
  }

  private expectedHeaders(dataset: DatasetKey) {
    return dataset === 'orders'
      ? new Set(['ordernumber', 'orderid', 'shipmentid', 'originname', 'destinationname', 'pickupdate', 'deliverydate', 'status'])
      : new Set(['shipmentid', 'shipment', 'orders', 'status', 'mode', 'carrier', 'firststopaddress', 'laststopaddress']);
  }

  async readWorkbook(filePath: string, dataset: DatasetKey) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.readFile(filePath);
    } catch {
      throw new BadRequestException(`RXO workbook could not be read: ${filePath}`);
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException(`RXO workbook has no worksheet: ${filePath}`);

    const expected = this.expectedHeaders(dataset);
    const scanRows = Math.min(25, worksheet.rowCount || 1);
    let bestRow = 1;
    let bestScore = -1;
    for (let rowNumber = 1; rowNumber <= scanRows; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const values: unknown[] = [];
      for (let col = 1; col <= Math.max(row.cellCount, 1); col += 1) values.push(this.scalar(row.getCell(col)));
      const keys = new Set(values.map((value) => this.canonical(value)).filter(Boolean));
      let score = Math.min(keys.size, 20);
      for (const key of keys) if (expected.has(key)) score += 10;
      score += values.filter((value) => /[A-Za-z]/.test(this.text(value))).length;
      if (score > bestScore) { bestScore = score; bestRow = rowNumber; }
    }

    const headerRow = worksheet.getRow(bestRow);
    const width = Math.max(headerRow.cellCount, worksheet.columnCount, 1);
    const counts = new Map<string, number>();
    const headers: string[] = [];
    for (let col = 1; col <= width; col += 1) {
      const base = this.text(this.scalar(headerRow.getCell(col))) || `Column ${col}`;
      const key = base.toLowerCase();
      const count = counts.get(key) ?? 0;
      counts.set(key, count + 1);
      headers.push(count ? `${base}.${count}` : base);
    }

    const headerKeys = new Set(headers.map((header) => this.canonical(header)));
    const keyAliases = dataset === 'orders'
      ? ['ordernumber', 'orderid', 'order']
      : ['shipmentid', 'shipmentnumber', 'shipment'];
    if (!keyAliases.some((key) => headerKeys.has(key))) {
      throw new BadRequestException(`${dataset} workbook does not contain its required key header.`);
    }

    const rows: Row[] = [];
    // actualRowCount counts populated rows; it is not the final row index.
    // Iterate the populated rows so gaps cannot hide later rows or inflate the limit.
    worksheet.eachRow((source, rowNumber) => {
      if (rowNumber <= bestRow) return;
      const row: Row = {};
      let populated = false;
      for (let col = 1; col <= headers.length; col += 1) {
        const value = this.scalar(source.getCell(col));
        if (this.text(value)) populated = true;
        row[headers[col - 1]] = value ?? '';
      }
      if (populated) {
        rows.push(row);
        if (rows.length > MAX_ROWS) throw new BadRequestException(`${dataset} workbook exceeds ${MAX_ROWS.toLocaleString()} rows.`);
      }
    });
    const possibleExportCeiling = rows.length >= RXO_EXPORT_LIMIT_WARNING_ROWS;
    return { rows, headers, sheetName: worksheet.name, headerRow: bestRow, possibleExportCeiling };
  }

  hashFile(filePath: string) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
  }

  readBoundary(): Boundary {
    const boundaryPath = this.boundaryPath();
    if (!fs.existsSync(boundaryPath)) {
      throw new BadRequestException('No verified RXO export has been copied into Truck Log yet. Truck Log copies each new export automatically; to do it now, select Sync latest in RXO Control Center.');
    }
    let boundary: Boundary;
    try {
      boundary = JSON.parse(fs.readFileSync(boundaryPath, 'utf8')) as Boundary;
    } catch {
      throw new BadRequestException('RXO ingestion boundary JSON could not be parsed.');
    }
    if (boundary.contractVersion !== 1) throw new BadRequestException(`Unsupported RXO boundary contract version ${boundary.contractVersion}.`);
    if (!boundary.sourceBatchId?.trim()) throw new BadRequestException('RXO boundary sourceBatchId is missing.');
    if (!boundary.site?.key?.trim() || !boundary.site?.name?.trim()) {
      throw new BadRequestException('RXO boundary site key/name is missing.');
    }
    if (!Array.isArray(boundary.datasets) || boundary.datasets.length !== 6 || boundary.datasetCount !== 6) {
      throw new BadRequestException('RXO boundary must contain exactly six datasets.');
    }
    if (boundary.site.key.trim().toLowerCase() === 'fort-wayne') {
      const identifiers = new Set(boundary.site.requiredIdentifiers ?? []);
      for (const identifier of REQUIRED_IDS) {
        if (!identifiers.has(identifier)) throw new BadRequestException(`RXO boundary is missing required Fort Wayne identifier ${identifier}.`);
      }
    }
    if (boundary.directionRule?.Origin !== 'OUTBOUND' || boundary.directionRule?.Destination !== 'INBOUND') {
      throw new BadRequestException('RXO direction contract must remain Origin=OUTBOUND and Destination=INBOUND.');
    }

    const required = new Set([
      'orders|OUTBOUND', 'orders|INBOUND',
      'shipments|OUTBOUND', 'shipments|INBOUND',
      'freight-on-the-move|OUTBOUND', 'freight-on-the-move|INBOUND',
    ]);
    for (const dataset of boundary.datasets) {
      required.delete(`${dataset.pageKey}|${dataset.direction}`);
      const absolute = path.resolve(this.latestRoot(), dataset.relativePath);
      if (!absolute.startsWith(this.latestRoot() + path.sep)) throw new BadRequestException(`Unsafe RXO dataset path ${dataset.relativePath}.`);
      if (!fs.existsSync(absolute)) throw new BadRequestException(`Missing RXO dataset ${dataset.relativePath}.`);
      if (dataset.sha256 && this.hashFile(absolute).toLowerCase() !== dataset.sha256.toLowerCase()) {
        throw new BadRequestException(`RXO dataset SHA256 mismatch ${dataset.relativePath}.`);
      }
    }
    if (required.size) throw new BadRequestException(`RXO boundary is missing ${[...required].join(', ')}.`);
    return boundary;
  }

  private order(row: Row, direction: Direction): ParsedOrder | null {
    const orderNumber = this.fieldText(row, ['Order Number', 'Order ID', 'Order Id', 'Order #'])?.toUpperCase();
    if (!orderNumber) return null;
    return {
      orderNumber,
      direction,
      shipmentId: this.fieldText(row, ['Shipment ID', 'Shipment Id', 'Shipment #', 'Shipment Number'])?.toUpperCase() ?? null,
      status: this.fieldText(row, ['Status']),
      originName: this.fieldText(row, ['Origin Name', 'Origin Location Name']),
      originAddress: this.composeAddress(row, 'Origin'),
      destinationName: this.fieldText(row, ['Destination Name', 'Destination Location Name']),
      destinationAddress: this.composeAddress(row, 'Destination'),
      pickupAt: this.orderStopDate(row, 'pickup'),
      deliveryAt: this.orderStopDate(row, 'delivery'),
      customerOrderNumber: this.fieldText(row, ['Customer Order Number', 'Customer Order #']),
      trackingNumber: this.fieldText(row, ['Tracking #', 'Tracking Number', 'Pro #']),
      rawRow: this.rawRow(row),
    };
  }

  private shipment(row: Row, direction: Direction): ParsedShipment | null {
    const shipmentId = this.fieldText(row, ['Shipment ID', 'Shipment Id', 'Shipment #', 'Shipment Number'])?.toUpperCase();
    if (!shipmentId) return null;
    return {
      shipmentId,
      direction,
      status: this.fieldText(row, ['Status']),
      mode: this.fieldText(row, ['Mode', 'Transportation Mode']),
      carrierName: this.fieldText(row, ['Carrier', 'Carrier Name']),
      orderCount: this.fieldInt(row, ['Orders', '# Orders', 'Order Count']),
      orderNumbers: this.fieldList(row, ['Order ID', 'Order Id', 'Order #', 'Order Number']),
      stopCount: this.fieldInt(row, ['# of Stops', '# Stops', 'Stops', 'Stop Count']),
      firstStopName: this.fieldText(row, ['First Stop Name']),
      firstStopAddress: this.fieldText(row, ['First Stop Address', 'First Stop']),
      lastStopName: this.fieldText(row, ['Last Stop Name']),
      lastStopAddress: this.fieldText(row, ['Last Stop Address', 'Last Stop']),
      plantScheduledAt: this.scheduleFromRow(row, direction),
      proNumber: this.fieldText(row, ['Pro #', 'PRO #', 'Pro Number']),
      trailerNumber: this.fieldText(row, ['Trailer #', 'Trailer Number']),
      pieces: this.fieldText(row, ['Pieces']),
      totalWeight: this.fieldText(row, ['Total Weight', 'Weight']),
      volume: this.fieldText(row, ['Volume']),
      hazardous: this.fieldBool(row, ['Is Hazardous?', 'Hazardous']),
      rawRow: this.rawRow(row),
    };
  }

  private freight(row: Row, direction: Direction): ParsedFreight | null {
    const shipmentId = this.fieldText(row, ['Shipment ID', 'Shipment Id', 'Shipment #', 'Shipment Number'])?.toUpperCase();
    if (!shipmentId) return null;
    return {
      shipmentId,
      direction,
      status: this.fieldText(row, ['Status']),
      etaStatus: this.fieldText(row, ['ETA status', 'ETA Status']),
      mode: this.fieldText(row, ['Mode', 'Transportation Mode']),
      carrierName: this.fieldText(row, ['Carrier', 'Carrier Name']),
      firstStopAddress: this.fieldText(row, ['First Stop Address', 'First Stop']),
      lastStopAddress: this.fieldText(row, ['Last Stop Address', 'Last Stop']),
      pickupEstimatedArrivalRaw: this.fieldText(row, ['Pickup - Estimated Arrival', 'Pickup Estimated Arrival']),
      pickupAppointmentArrivalRaw: this.fieldText(row, ['Pickup - Appointment Arrival', 'Pickup Appointment Arrival']),
      deliveryEstimatedArrivalRaw: this.fieldText(row, ['Delivery - Estimated Arrival', 'Delivery Estimated Arrival']),
      deliveryAppointmentArrivalRaw: this.fieldText(row, ['Delivery - Appointment Arrival', 'Delivery Appointment Arrival']),
      plantScheduledAt: this.scheduleFromRow(row, direction),
      proNumber: this.fieldText(row, ['Pro #', 'PRO #', 'Pro Number']),
      trailerNumber: this.fieldText(row, ['Trailer #', 'Trailer Number']),
      rawRow: this.rawRow(row),
    };
  }

  dedupeOrders(rows: ParsedOrder[]) {
    return [...new Map(rows.map((row) => [`${row.orderNumber}|${row.direction}`, row])).values()];
  }

  private dedupeShipments(rows: ParsedShipment[]) {
    const map = new Map<string, ParsedShipment>();
    for (const row of rows) {
      const key = `${row.shipmentId}|${row.direction}`;
      const previous = map.get(key);
      if (!previous) {
        map.set(key, row);
        continue;
      }
      map.set(key, {
        ...previous,
        ...row,
        orderNumbers: [...new Set([...previous.orderNumbers, ...row.orderNumbers])],
      });
    }
    return [...map.values()];
  }

  private dedupeFreight(rows: ParsedFreight[]) {
    return [...new Map(rows.map((row) => [`${row.shipmentId}|${row.direction}`, row])).values()];
  }

  /** use the named Cancel column (CA in the user's export), never a
   * fixed position: RXO can reorder optional columns between export windows.
   * Unknown flags or a missing/ambiguous header fail before database changes. */
  filterCancelledOrders(table: { rows: Row[]; headers: string[] }, direction: Direction) {
    const headers = table.headers.filter((header) =>
      this.canonical(header.replace(/\.\d+$/, '')) === 'cancel');
    if (headers.length > 1 || (headers.length === 0 && table.rows.length > 0)) {
      throw new BadRequestException(`Orders ${direction} must contain exactly one named Cancel column (CA in the source export); found ${headers.length}. No Orders were imported.`);
    }
    const header = headers[0] ?? 'Cancel';
    const trueFlags = new Set(['true', 'yes', 'y', '1', 't', 'x', 'cancel', 'canceled', 'cancelled']);
    const falseFlags = new Set(['', 'false', 'no', 'n', '0', 'f', 'not canceled', 'not cancelled']);
    const cancelledKeys = new Set<string>();
    const candidates: ParsedOrder[] = [];
    let keyedRows = 0;
    let cancelledFlagRows = 0;
    for (const row of table.rows) {
      const flag = this.text(row[header]).toLowerCase();
      if (!trueFlags.has(flag) && !falseFlags.has(flag)) {
        throw new BadRequestException(`Orders ${direction}: unrecognized Cancel flag "${flag.slice(0, 80)}". Import stopped before database changes.`);
      }
      const cancelled = trueFlags.has(flag);
      if (cancelled) cancelledFlagRows += 1;
      const parsed = this.order(row, direction);
      if (!parsed) continue;
      keyedRows += 1;
      const key = `${direction}|${parsed.orderNumber}`;
      if (cancelled) cancelledKeys.add(key);
      else candidates.push(parsed);
    }
    // A canceled duplicate wins over an active duplicate in the same snapshot.
    // Direction is part of the key; one direction cannot suppress the other.
    const parsed = candidates.filter((order) => !cancelledKeys.has(`${direction}|${order.orderNumber}`));
    const cancelledDuplicateRows = candidates.length - parsed.length;
    return {
      parsed, cancelledKeys, keyedRows,
      cancelFilterVersion: 'CANCEL_POLICY_1',
      cancelHeader: header,
      cancelColumnNumber: headers.length ? table.headers.indexOf(header) + 1 : null,
      cancelledFlagRows,
      cancelledDuplicateRows,
      cancelledRowsSkipped: cancelledFlagRows + cancelledDuplicateRows,
      cancelledOrdersSkipped: cancelledKeys.size,
    };
  }

  async parseSnapshot(boundary: Boundary) {
    const orders: ParsedOrder[] = [];
    const cancelledOrderKeys = new Set<string>();
    const shipments: ParsedShipment[] = [];
    const freight: ParsedFreight[] = [];
    const datasets: Record<string, unknown>[] = [];
    const warnings: string[] = [];
    const completeDirections: Record<DatasetKey, Set<Direction>> = {
      orders: new Set<Direction>(),
      shipments: new Set<Direction>(),
      'freight-on-the-move': new Set<Direction>(),
    };

    for (const dataset of boundary.datasets) {
      const filePath = path.resolve(this.latestRoot(), dataset.relativePath);
      const table = await this.readWorkbook(filePath, dataset.pageKey);

      // RXO Connect has been observed returning 10,001 populated rows for an
      // Orders export when the UI source reaches its ~10,000-row ceiling.
      // Never pretend that dataset is complete. Skip only the affected
      // page/direction and keep importing the other verified datasets.
      if (table.possibleExportCeiling) {
        const warning =
          `${dataset.pageKey} ${dataset.direction} contains ${table.rows.length.toLocaleString()} data rows ` +
          'and may have hit the RXO 10,000-row export ceiling; this dataset/direction was skipped.';
        warnings.push(warning);
        datasets.push({
          pageKey: dataset.pageKey,
          direction: dataset.direction,
          file: dataset.relativePath,
          status: 'SKIPPED_POSSIBLE_RXO_EXPORT_CEILING',
          warning,
          sourceRows: table.rows.length,
          parsedRows: 0,
          uniqueRows: 0,
          duplicatesCollapsed: 0,
          sheet: table.sheetName,
          headerRow: table.headerRow,
          headers: table.headers,
          sha256: dataset.sha256 ?? null,
        });
        continue;
      }

      completeDirections[dataset.pageKey].add(dataset.direction);

      let parsedRows = 0;
      let uniqueRows = 0;
      let duplicatesCollapsed = 0;
      let keyedOrderRows = 0;
      let cancellationSummary: Record<string, unknown> = {};

      if (dataset.pageKey === 'orders') {
        const filtered = this.filterCancelledOrders(table, dataset.direction);
        const { parsed, cancelledKeys, keyedRows, ...cancelSummary } = filtered;
        keyedOrderRows = keyedRows;
        cancellationSummary = { ...cancelSummary, keyedRows };
        for (const key of cancelledKeys) cancelledOrderKeys.add(key);
        const unique = this.dedupeOrders(parsed);
        parsedRows = parsed.length;
        uniqueRows = unique.length;
        duplicatesCollapsed = parsedRows - uniqueRows;
        orders.push(...unique);
      } else if (dataset.pageKey === 'shipments') {
        const parsed: ParsedShipment[] = [];
        for (const row of table.rows) {
          const value = this.shipment(row, dataset.direction);
          if (value) parsed.push(value);
        }
        const unique = this.dedupeShipments(parsed);
        parsedRows = parsed.length;
        uniqueRows = unique.length;
        duplicatesCollapsed = parsedRows - uniqueRows;
        shipments.push(...unique);
      } else {
        const parsed: ParsedFreight[] = [];
        for (const row of table.rows) {
          const value = this.freight(row, dataset.direction);
          if (value) parsed.push(value);
        }
        const unique = this.dedupeFreight(parsed);
        parsedRows = parsed.length;
        uniqueRows = unique.length;
        duplicatesCollapsed = parsedRows - uniqueRows;
        freight.push(...unique);
      }

      if (table.rows.length > 0 && (dataset.pageKey === 'orders' ? keyedOrderRows : parsedRows) === 0) {
        throw new BadRequestException(`${dataset.pageKey} ${dataset.direction} contains data rows but none have the expected RXO key.`);
      }

      datasets.push({
        pageKey: dataset.pageKey,
        direction: dataset.direction,
        file: dataset.relativePath,
        status: 'COMPLETE',
        sourceRows: table.rows.length,
        parsedRows,
        uniqueRows,
        duplicatesCollapsed,
        ...cancellationSummary,
        sheet: table.sheetName,
        headerRow: table.headerRow,
        headers: table.headers,
        sha256: dataset.sha256 ?? null,
      });
    }

    // All Orders canceled is a valid complete snapshot, not a broken workbook.
    if (!orders.length && !shipments.length && !freight.length && !cancelledOrderKeys.size) {
      throw new BadRequestException('RXO snapshot contains no complete keyed datasets.');
    }

    return { orders, shipments, freight, datasets, warnings, completeDirections, cancelledOrderKeys };
  }


}
