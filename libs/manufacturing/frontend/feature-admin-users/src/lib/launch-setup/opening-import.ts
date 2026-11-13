export const OPENING_IMPORT_HEADER = 'tray,summary,part_type,stage,shelf,service_cycle';
export interface OpeningImportRow {
  line: number;
  tray: string;
  summary: string;
  part_type: string;
  stage: string;
  shelf: string;
  service_cycle: number;
  error: string;
}

/** Intentionally simple CSV: barcode/summary values cannot contain commas or line breaks. */
export function parseOpeningImport(text: string): OpeningImportRow[] {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.shift()?.trim().toLowerCase() !== OPENING_IMPORT_HEADER) throw new Error(`Use this header: ${OPENING_IMPORT_HEADER}`);
  if (lines.length < 1 || lines.length > 100) throw new Error('Import 1 to 100 trays at a time.');
  const rows = lines.map((line, index): OpeningImportRow => {
    const cells = line.split(',').map(cell => cell.trim());
    const [tray = '', summary = '', part_type = '', stage = '', shelf = '', cycle = ''] = cells;
    const row = { line: index + 2, tray: tray.toUpperCase(), summary, part_type: part_type.toUpperCase(), stage: stage.toUpperCase(), shelf: shelf.toUpperCase(), service_cycle: Number(cycle), error: '' };
    if (cells.length !== 6 || cells.some(cell => cell.includes('"'))) row.error = 'Use six comma-separated values without quotes.';
    else if (!tray || !summary || !shelf || [tray, summary, shelf].some(value => value.length > 80)) row.error = 'Tray, summary and shelf are required (80 characters maximum).';
    else if (!['RING', 'PINION'].includes(row.part_type)) row.error = 'Part type must be RING or PINION.';
    else if (!['READY_FOR_COATING', 'READY_FOR_CUTTER'].includes(row.stage)) row.error = 'Stage must be READY_FOR_COATING or READY_FOR_CUTTER.';
    else if (!/^\d+$/.test(cycle) || !Number.isInteger(row.service_cycle) || row.service_cycle > 99) row.error = 'Service cycle must be a whole number from 0 to 99.';
    return row;
  });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.tray, (counts.get(row.tray) ?? 0) + 1);
  for (const row of rows) if (row.tray && counts.get(row.tray)! > 1) row.error = 'Duplicate tray in this upload. Remove duplicate rows.';
  return rows;
}
