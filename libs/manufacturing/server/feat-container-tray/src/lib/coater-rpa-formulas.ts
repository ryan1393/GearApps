/**
 * Recalculates the formulas of the saved RPA Excel form after its inputs are replaced.
 *
 * Excel keeps the last result of every formula in the file. Viewers that do not recalculate
 * (mail previews, Protected View, phones) show those saved results, so a form filled without
 * recalculating would show the previous request's quantities and amounts.
 *
 * Only what the RPA form uses is supported: + - * / ^ &, comparisons, cell and range
 * references, shared formulas, and SUM, SUMIF, IF, OR, AND, INT, ISBLANK, CONCAT and TODAY.
 * Anything else raises `UnsupportedFormula`; the caller then clears that cell's saved result
 * and leaves it for Excel to calculate.
 */

export type CellValue = number | string | boolean | null;

export class UnsupportedFormula extends Error {}

export interface SheetCell {
  /** Typed value for a plain cell. Ignored when the cell has a formula. */
  value: CellValue;
  /** Formula text, when this cell owns one (a normal formula or the first cell of a shared one). */
  formula?: string;
  /** Shared formula this cell belongs to. */
  shared?: string;
}

interface Ref { col: number; row: number; colAbs: boolean; rowAbs: boolean }
type Node =
  | { kind: 'value'; value: CellValue }
  | { kind: 'ref'; ref: Ref }
  | { kind: 'range'; from: Ref; to: Ref }
  | { kind: 'unary'; op: string; arg: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };

type Token = { type: 'num' | 'str' | 'ref' | 'name' | 'op'; text: string };

export function columnNumber(letters: string): number {
  let n = 0;
  for (const char of letters) n = n * 26 + (char.charCodeAt(0) - 64);
  return n;
}

export function columnLetters(n: number): string {
  let letters = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

const address = (col: number, row: number) => columnLetters(col) + row;

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s+|(\d+\.?\d*(?:[eE][+-]?\d+)?)|"((?:[^"]|"")*)"|(\$?[A-Z]{1,3}\$?\d+)(?![A-Za-z0-9_.(])|([A-Za-z_][A-Za-z0-9_.]*)|(<=|>=|<>|[-+*/^&=<>(),:])/y;
  let match: RegExpExecArray | null;
  while (pattern.lastIndex < formula.length) {
    match = pattern.exec(formula);
    if (!match) throw new UnsupportedFormula(`Unreadable formula: ${formula}`);
    if (match[1] !== undefined) tokens.push({ type: 'num', text: match[1] });
    else if (match[2] !== undefined) tokens.push({ type: 'str', text: match[2].replace(/""/g, '"') });
    else if (match[3] !== undefined) tokens.push({ type: 'ref', text: match[3] });
    else if (match[4] !== undefined) tokens.push({ type: 'name', text: match[4] });
    else if (match[5] !== undefined) tokens.push({ type: 'op', text: match[5] });
  }
  return tokens;
}

function parseRef(text: string): Ref {
  const match = /^(\$?)([A-Z]+)(\$?)(\d+)$/.exec(text)!;
  return { col: columnNumber(match[2]), row: Number(match[4]), colAbs: !!match[1], rowAbs: !!match[3] };
}

function parse(formula: string): Node {
  const tokens = tokenize(formula);
  let position = 0;
  const peek = (text?: string) => {
    const token = tokens[position];
    return token && (text === undefined || (token.type === 'op' && token.text === text)) ? token : undefined;
  };
  const expect = (text: string) => {
    if (!peek(text)) throw new UnsupportedFormula(`Expected ${text} in ${formula}`);
    position++;
  };
  const binary = (next: () => Node, ops: string[]) => (): Node => {
    let left = next();
    for (let token = tokens[position]; token?.type === 'op' && ops.includes(token.text); token = tokens[position]) {
      position++;
      left = { kind: 'binary', op: token.text, left, right: next() };
    }
    return left;
  };
  const primary = (): Node => {
    const token = tokens[position++];
    if (!token) throw new UnsupportedFormula(`Incomplete formula: ${formula}`);
    if (token.type === 'num') return { kind: 'value', value: Number(token.text) };
    if (token.type === 'str') return { kind: 'value', value: token.text };
    if (token.type === 'ref') {
      const from = parseRef(token.text);
      if (!peek(':')) return { kind: 'ref', ref: from };
      position++;
      const end = tokens[position++];
      if (end?.type !== 'ref') throw new UnsupportedFormula(`Unsupported range in ${formula}`);
      return { kind: 'range', from, to: parseRef(end.text) };
    }
    if (token.type === 'name') {
      const name = token.text.toUpperCase().replace(/^_XLFN\./, '');
      if (!peek('(')) {
        if (name === 'TRUE' || name === 'FALSE') return { kind: 'value', value: name === 'TRUE' };
        throw new UnsupportedFormula(`Unsupported name ${token.text}`);
      }
      position++;
      const args: Node[] = [];
      if (!peek(')')) {
        do args.push(expression());
        while (peek(',') && ++position);
      }
      expect(')');
      return { kind: 'call', name, args };
    }
    if (token.text === '(') {
      const inner = expression();
      expect(')');
      return inner;
    }
    throw new UnsupportedFormula(`Unexpected ${token.text} in ${formula}`);
  };
  const unary = (): Node => {
    const token = tokens[position];
    if (token?.type === 'op' && (token.text === '-' || token.text === '+')) {
      position++;
      return { kind: 'unary', op: token.text, arg: unary() };
    }
    return primary();
  };
  const power = binary(unary, ['^']);
  const product = binary(power, ['*', '/']);
  const sum = binary(product, ['+', '-']);
  const concat = binary(sum, ['&']);
  const expression: () => Node = binary(concat, ['=', '<>', '<', '>', '<=', '>=']);
  const tree = expression();
  if (position !== tokens.length) throw new UnsupportedFormula(`Unexpected text in ${formula}`);
  return tree;
}

const toNumber = (value: CellValue): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null) return 0;
  const parsed = value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(parsed)) throw new UnsupportedFormula('Text used as a number');
  return parsed;
};
const toText = (value: CellValue): string =>
  value === null ? '' : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
const truthy = (value: CellValue): boolean => (typeof value === 'string' ? value.toUpperCase() === 'TRUE' : toNumber(value) !== 0);

function compare(left: CellValue, right: CellValue): number {
  // A blank compares as 0 against a number and as "" against text.
  if (left === null) left = typeof right === 'string' ? '' : 0;
  if (right === null) right = typeof left === 'string' ? '' : 0;
  if (typeof left === 'boolean') left = left ? 1 : 0;
  if (typeof right === 'boolean') right = right ? 1 : 0;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'string' && typeof right === 'string') return left.toLowerCase().localeCompare(right.toLowerCase());
  return typeof left === 'number' ? -1 : 1; // Excel sorts every number before any text.
}

/** SUMIF criteria such as "=1700-5000", ">5" or a bare value. */
function criterion(raw: CellValue): (value: CellValue) => boolean {
  if (typeof raw !== 'string') return value => value !== null && compare(value, raw) === 0;
  const match = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(raw)!;
  const op = match[1] ?? '=';
  if (/[*?~]/.test(match[2])) throw new UnsupportedFormula('Wildcard criteria');
  const number = match[2].trim() !== '' && Number.isFinite(Number(match[2])) ? Number(match[2]) : null;
  return value => {
    if (number !== null) {
      const candidate = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
      if (!Number.isFinite(candidate)) return op === '<>';
      return ({ '=': candidate === number, '<>': candidate !== number, '<': candidate < number,
        '>': candidate > number, '<=': candidate <= number, '>=': candidate >= number })[op]!;
    }
    const same = toText(value).toLowerCase() === match[2].toLowerCase();
    if (op === '=') return same && (value !== null || match[2] === '');
    if (op === '<>') return !same;
    throw new UnsupportedFormula('Ordered text criteria');
  };
}

/**
 * Calculate every formula on a sheet.
 * @returns the result for each formula cell, or `undefined` where it could not be calculated.
 */
export function calculateSheet(cells: Map<string, SheetCell>, today: number): Map<string, CellValue | undefined> {
  const masters = new Map<string, { node: Node; col: number; row: number }>();
  const parsed = new Map<string, Node>();
  const position = (key: string) => {
    const match = /^([A-Z]+)(\d+)$/.exec(key)!;
    return { col: columnNumber(match[1]), row: Number(match[2]) };
  };
  for (const [key, cell] of cells) {
    if (cell.formula === undefined) continue;
    try {
      const node = parse(cell.formula);
      parsed.set(key, node);
      if (cell.shared !== undefined) masters.set(cell.shared, { node, ...position(key) });
    } catch (error) {
      if (!(error instanceof UnsupportedFormula)) throw error;
    }
  }

  const results = new Map<string, CellValue | undefined>();
  const running = new Set<string>();

  const valueAt = (col: number, row: number): CellValue => {
    const key = address(col, row);
    const cell = cells.get(key);
    if (!cell) return null;
    if (cell.formula === undefined && cell.shared === undefined) return cell.value;
    const value = formulaResult(key, cell);
    if (value === undefined) throw new UnsupportedFormula(`${key} could not be calculated`);
    return value;
  };

  const formulaResult = (key: string, cell: SheetCell): CellValue | undefined => {
    if (results.has(key)) return results.get(key);
    if (running.has(key)) throw new UnsupportedFormula(`Circular reference at ${key}`);
    running.add(key);
    let value: CellValue | undefined;
    try {
      const here = position(key);
      const own = parsed.get(key);
      const master = cell.shared !== undefined ? masters.get(cell.shared) : undefined;
      if (own) value = evaluate(own, 0, 0);
      else if (master) value = evaluate(master.node, here.col - master.col, here.row - master.row);
      else value = undefined;
    } catch (error) {
      if (!(error instanceof UnsupportedFormula)) throw error;
      value = undefined;
    } finally {
      running.delete(key);
    }
    results.set(key, value);
    return value;
  };

  const resolve = (ref: Ref, dCol: number, dRow: number) =>
    ({ col: ref.colAbs ? ref.col : ref.col + dCol, row: ref.rowAbs ? ref.row : ref.row + dRow });

  const rangeOf = (node: Node, dCol: number, dRow: number) => {
    if (node.kind === 'ref') {
      const at = resolve(node.ref, dCol, dRow);
      return { col: at.col, row: at.row, cols: 1, rows: 1 };
    }
    if (node.kind !== 'range') throw new UnsupportedFormula('A range was expected');
    const from = resolve(node.from, dCol, dRow), to = resolve(node.to, dCol, dRow);
    return { col: Math.min(from.col, to.col), row: Math.min(from.row, to.row),
      cols: Math.abs(to.col - from.col) + 1, rows: Math.abs(to.row - from.row) + 1 };
  };

  const evaluate = (node: Node, dCol: number, dRow: number): CellValue => {
    const run = (child: Node) => evaluate(child, dCol, dRow);
    switch (node.kind) {
      case 'value': return node.value;
      case 'ref': { const at = resolve(node.ref, dCol, dRow); return valueAt(at.col, at.row); }
      case 'range': throw new UnsupportedFormula('A range cannot be used as a single value');
      case 'unary': return node.op === '-' ? -toNumber(run(node.arg)) : toNumber(run(node.arg));
      case 'binary': {
        const left = run(node.left), right = run(node.right);
        switch (node.op) {
          case '+': return toNumber(left) + toNumber(right);
          case '-': return toNumber(left) - toNumber(right);
          case '*': return toNumber(left) * toNumber(right);
          case '/': { const by = toNumber(right); if (by === 0) throw new UnsupportedFormula('Division by zero'); return toNumber(left) / by; }
          case '^': return toNumber(left) ** toNumber(right);
          case '&': return toText(left) + toText(right);
          case '=': return compare(left, right) === 0;
          case '<>': return compare(left, right) !== 0;
          case '<': return compare(left, right) < 0;
          case '>': return compare(left, right) > 0;
          case '<=': return compare(left, right) <= 0;
          default: return compare(left, right) >= 0;
        }
      }
      case 'call': {
        const { name, args } = node;
        switch (name) {
          case 'TODAY': return today;
          case 'IF': return truthy(run(args[0])) ? (args[1] ? run(args[1]) : true) : (args[2] ? run(args[2]) : false);
          case 'OR': return args.some(arg => truthy(run(arg)));
          case 'AND': return args.every(arg => truthy(run(arg)));
          case 'INT': return Math.floor(toNumber(run(args[0])));
          case 'CONCAT': case 'CONCATENATE': return args.map(arg => toText(run(arg))).join('');
          case 'ISBLANK': {
            if (args[0]?.kind !== 'ref') return false;
            const at = resolve(args[0].ref, dCol, dRow);
            return !cells.has(address(at.col, at.row)) || valueAt(at.col, at.row) === null;
          }
          case 'SUM': {
            let total = 0;
            for (const arg of args) {
              if (arg.kind === 'ref' || arg.kind === 'range') {
                const range = rangeOf(arg, dCol, dRow);
                // Text and blanks inside a range are ignored, as in Excel.
                for (let r = 0; r < range.rows; r++) for (let c = 0; c < range.cols; c++) {
                  const value = valueAt(range.col + c, range.row + r);
                  if (typeof value === 'number') total += value;
                }
              } else total += toNumber(run(arg));
            }
            return total;
          }
          case 'SUMIF': {
            const range = rangeOf(args[0], dCol, dRow);
            const matches = criterion(run(args[1]));
            // The cells added are the ones at the same offsets from the top-left of sum_range.
            const sum = args[2] ? rangeOf(args[2], dCol, dRow) : range;
            let total = 0;
            for (let r = 0; r < range.rows; r++) for (let c = 0; c < range.cols; c++) {
              if (!matches(valueAt(range.col + c, range.row + r))) continue;
              const value = valueAt(sum.col + c, sum.row + r);
              if (typeof value === 'number') total += value;
            }
            return total;
          }
          default: throw new UnsupportedFormula(`Unsupported function ${name}`);
        }
      }
    }
  };

  for (const [key, cell] of cells) {
    if (cell.formula !== undefined || cell.shared !== undefined) formulaResult(key, cell);
  }
  return results;
}
