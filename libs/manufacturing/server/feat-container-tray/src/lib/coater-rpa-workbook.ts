import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export interface RpaLine {
  summary: string;
  part_type: string;
  trays: number;
  per_side: number;
  outer_part: string;
  inner_part: string;
}

const worksheet = 'xl/worksheets/sheet1.xml';
const cells = /<c\b([^>]*\br="([A-Z]+)(\d+)"[^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g;
const partCells = ['B32', 'B35', 'B38', 'B41', 'B44', 'B47'];
const groupColumns = ['P', 'Q', 'R', 'S', 'T', 'V', 'W', 'Y', 'Z'];

function xml(value: string): string {
  return value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]!);
}

function cellContent(value: string | number | undefined): string {
  if (value === undefined) return '/>';
  if (typeof value === 'number') return `><v>${value}</v></c>`;
  return ` t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

/** Populate the original Excel form saved with the imported request. */
export function fillRpaWorkbook(template: Buffer, request: {
  number: number;
  po: string;
  date: string;
  unitPrice: number;
  insuranceUnit: number;
  lines: RpaLine[];
}): Buffer {
  if (request.lines.length < 1 || request.lines.length > 29) {
    throw new Error('The recovered RPA form holds up to 29 part groups. Split this shipment.');
  }
  const files = unzipSync(template);
  if (!files[worksheet]) throw new Error('The saved RPA Excel form is missing its worksheet.');
  const sheet = strFromU8(files[worksheet]);
  const parts = new Set(Array.from(sheet.matchAll(cells))
    .filter(match => partCells.includes(match[2] + match[3]))
    .map(match => /<t(?: [^>]*)?>([^<]+)<\/t>/.exec(match[0])?.[1]?.trim()));
  for (const line of request.lines) {
    if (!parts.has(xml(line.outer_part)) || !parts.has(xml(line.inner_part))) {
      throw new Error(`The RPA form has no part line for ${line.summary} ${line.part_type}.`);
    }
  }
  const date = Date.parse(request.date + 'T00:00:00Z') / 86_400_000 + 25569;
  const formNumber = `DN-85-0${request.number}`;
  const values = new Map<string, string | number | undefined>(Object.entries({
    P2: request.number, R2: request.po, P3: date, K9: date,
    H5: formNumber, K8: formNumber, S3: request.unitPrice, I50: request.insuranceUnit,
  }));

  for (let i = 0; i < 29; i++) {
    const line = request.lines[i];
    const quantity = line && line.trays * line.per_side;
    const row = line ? [line.summary, line.part_type === 'RING' ? 'G' : 'P', line.trays, line.per_side,
      line.outer_part, quantity, line.inner_part, quantity] : [];
    groupColumns.forEach((column, index) => values.set(column + (i + 11), row[index]));
  }

  const required = new Set([...values.keys()].filter(key => values.get(key) !== undefined));
  const populated = sheet.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (row: string, rowNumber: string) => {
    const existing = new Map<string, string>();
    for (const match of row.matchAll(cells)) {
      const [, attributes, column, number] = match;
      const address = column + number;
      required.delete(address);
      existing.set(column, values.has(address)
        ? `<c${attributes.replace(/\s+t="[^"]*"/, '')}${cellContent(values.get(address))}`
        : match[0]);
    }
    if (Number(rowNumber) >= 11 && Number(rowNumber) <= 39) {
      for (const column of groupColumns) {
        const address = column + rowNumber;
        const value = values.get(address);
        if (!existing.has(column) && value !== undefined) {
          existing.set(column, `<c r="${address}"${cellContent(value)}`);
          required.delete(address);
        }
      }
    }
    const ordered = [...existing.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b));
    return row.slice(0, row.indexOf('>') + 1) + ordered.map(column => existing.get(column)).join('') + '</row>';
  });
  if (required.size) throw new Error('The saved RPA Excel form is missing required cells.');
  files[worksheet] = strToU8(populated);
  return Buffer.from(zipSync(files));
}
