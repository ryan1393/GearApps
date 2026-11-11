import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { calculateSheet, CellValue, SheetCell } from './coater-rpa-formulas';

export interface RpaLine {
  summary: string;
  part_type: string;
  trays: number;
  per_side: number;
  outer_part: string;
  inner_part: string;
}

const worksheet = 'xl/worksheets/sheet1.xml';
const cells = /<c\b([^>]*\br="([A-Z]+)(\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const partCells = ['B32', 'B35', 'B38', 'B41', 'B44', 'B47'];
const groupColumns = ['P', 'Q', 'R', 'S', 'T', 'V', 'W', 'Y', 'Z'];

function xml(value: string): string {
  return value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]!);
}

function unxml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, name: string) =>
    name === 'amp' ? '&' : name === 'lt' ? '<' : name === 'gt' ? '>' : name === 'quot' ? '"' : name === 'apos' ? "'"
      : String.fromCodePoint(name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))));
}

function cellContent(value: string | number | undefined): string {
  if (value === undefined) return '/>';
  if (typeof value === 'number') return `><v>${value}</v></c>`;
  return ` t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

const textRuns = (fragment: string): string =>
  Array.from(fragment.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g), run => unxml(run[1])).join('');

/** Excel saves repeated text once in a shared table and puts an index in the cell. */
function sharedStrings(files: Record<string, Uint8Array>): string[] {
  const part = files['xl/sharedStrings.xml'];
  if (!part) return [];
  return Array.from(strFromU8(part).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), item =>
    // Phonetic guides (<rPh>) are not part of the text.
    textRuns(item[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')));
}

function cellValue(attributes: string, inner: string | undefined, strings: string[]): CellValue {
  const type = /\bt="([^"]*)"/.exec(attributes)?.[1];
  if (type === 'inlineStr') return textRuns(inner ?? '');
  const raw = /<v>([^<]*)<\/v>/.exec(inner ?? '')?.[1];
  if (raw === undefined) return null;
  if (type === 's') return strings[Number(raw)] ?? '';
  if (type === 'str' || type === 'e') return unxml(raw);
  if (type === 'b') return raw === '1';
  return raw === '' ? null : Number(raw);
}

/** Part names the form can total: its part lines and the names its SUMIF formulas count. */
function formParts(sheet: string, strings: string[]): Set<string> {
  const parts = new Set<string>();
  for (const match of sheet.matchAll(cells)) {
    if (partCells.includes(match[2] + match[3])) {
      const value = cellValue(match[1], match[4], strings);
      if (typeof value === 'string' && value.trim()) parts.add(value.trim());
    }
  }
  // A coating variant such as "1700-5000 Evo" shares the part number of another line and is
  // told apart only by the name its total formula counts.
  for (const formula of sheet.matchAll(/<f\b[^>]*>([^<]*)<\/f>/g)) {
    for (const criteria of unxml(formula[1]).matchAll(/SUMIF\([^,]+,\s*"=([^"]+)"/gi)) parts.add(criteria[1].trim());
  }
  return parts;
}

/**
 * Write the result of every formula back into the sheet, so the form reads correctly in
 * viewers that do not recalculate. A formula that cannot be calculated here loses its saved
 * result and is calculated by Excel when the workbook opens.
 */
function recalculate(sheet: string, strings: string[], today: number): string {
  const model = new Map<string, SheetCell>();
  for (const match of sheet.matchAll(cells)) {
    const [, attributes, column, row, inner] = match;
    const formula = /<f\b([^>]*?)(?:\/>|>([^<]*)<\/f>)/.exec(inner ?? '');
    if (!formula) {
      model.set(column + row, { value: cellValue(attributes, inner, strings) });
      continue;
    }
    const shared = /\bt="shared"/.test(formula[1]) ? /\bsi="(\d+)"/.exec(formula[1])?.[1] : undefined;
    model.set(column + row, {
      value: null, shared,
      formula: formula[2] !== undefined && formula[2] !== '' ? unxml(formula[2]) : undefined,
    });
  }
  const results = calculateSheet(model, today);
  return sheet.replace(cells, (cell: string, attributes: string, column: string, row: string, inner?: string) => {
    const formula = /<f\b[^>]*?(?:\/>|>[^<]*<\/f>)/.exec(inner ?? '')?.[0];
    if (!formula) return cell;
    const value = results.get(column + row);
    const open = `<c${attributes.replace(/\s+t="[^"]*"/, '')}`;
    if (value === undefined || value === null) return `${open}>${formula}</c>`;
    if (typeof value === 'number') return `${open}>${formula}<v>${value}</v></c>`;
    if (typeof value === 'boolean') return `${open} t="b">${formula}<v>${value ? 1 : 0}</v></c>`;
    return `${open} t="str">${formula}<v>${xml(value)}</v></c>`;
  });
}

/**
 * Excel refuses a workbook whose calculation chain lists a cell that no longer has a formula
 * (the form number and date become plain values). Excel rebuilds the chain when it is absent.
 */
function dropCalculationChain(files: Record<string, Uint8Array>): void {
  if (!files['xl/calcChain.xml']) return;
  delete files['xl/calcChain.xml'];
  const edit = (path: string, pattern: RegExp) => {
    if (files[path]) files[path] = strToU8(strFromU8(files[path]).replace(pattern, ''));
  };
  edit('xl/_rels/workbook.xml.rels', /<Relationship\b[^>]*calcChain[^>]*\/>/);
  edit('[Content_Types].xml', /<Override\b[^>]*calcChain[^>]*\/>/);
}

/** Ask Excel to recalculate everything on opening, whatever results the file carries. */
function recalculateOnOpen(files: Record<string, Uint8Array>): void {
  const path = 'xl/workbook.xml';
  if (!files[path]) return;
  const workbook = strFromU8(files[path]);
  const updated = /<calcPr\b/.test(workbook)
    ? workbook.replace(/<calcPr\b([^>]*?)\s*\/>/, (_, attributes: string) =>
      `<calcPr${attributes.replace(/\s+fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`)
    : workbook;
  files[path] = strToU8(updated);
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
  const strings = sharedStrings(files);
  const parts = formParts(sheet, strings);
  for (const line of request.lines) {
    if (!parts.has(line.outer_part.trim()) || !parts.has(line.inner_part.trim())) {
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
  files[worksheet] = strToU8(recalculate(populated, strings, date));
  dropCalculationChain(files);
  recalculateOnOpen(files);
  return Buffer.from(zipSync(files));
}
