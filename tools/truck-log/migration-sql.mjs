// Read-only helper for source contract tests: the full SQL of every migration,
// in order, so tests can assert what the database schema contains.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/truck-log/migrations');

export function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
}

export function readSchemaSql() {
  return migrationFiles().map((name) => fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')).join('\n');
}

/**
 * Normalize SQL so a schema assertion written in hand-written migration style
 * ("visible_in_latest BOOLEAN NOT NULL DEFAULT TRUE", "CREATE TABLE IF NOT EXISTS x")
 * matches the pg_dump style the baseline uses ("visible_in_latest boolean DEFAULT true NOT NULL",
 * "CREATE TABLE public.x"). Only for tests; never used to build SQL.
 */
export function normalizeSql(sql, { stripDefaults = true } = {}) {
  let text = String(sql)
    .toLowerCase()
    .replace(/--[^\n]*/g, ' ')
    .replace(/\bpublic\./g, '')
    .replace(/\bif not exists\s+/g, '')
    .replace(/\bcreate or replace\b/g, 'create')
    .replace(/\bcharacter varying\b/g, 'varchar')
    .replace(/\btimestamp with time zone\b/g, 'timestamptz')
    .replace(/\btimestamp without time zone\b/g, 'timestamp')
    .replace(/\binteger\b/g, 'int')
    .replace(/\bserial\b/g, 'int')
    .replace(/'([^']*)'::interval/g, "interval '$1'")
    .replace(/::(?:text|varchar|character varying|int|bigint|jsonb)(?:\[\])?/g, '');
  const tidy = (value) => value
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;])\s*/g, '$1')
    .replace(/\s*(<>|<=|>=|!=|=|<|>|~|\+|\|\|)\s*/g, '$1');
  text = tidy(text);
  // pg_dump adds redundant parentheses; peel them until nothing changes.
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = tidy(text
      // "(x)::text = ANY ((ARRAY['a', 'b'])::text[])"  ->  "x in('a','b')"
      .replace(/\(*([a-z_][\w.]*)\)*= ?any\(+array\[([^\]]*)\]\)+/g, ' $1 in($2) ')
      // ((x)) -> (x)
      .replace(/\(\(([^()]*)\)\)/g, '($1)')
      // (identifier) not used as a call argument list  ->  identifier
      .replace(/(^|[^\w]|\b(?:where|and|or|not|when|then|else|check))\(([a-z_][\w.]*)\)/g, '$1 $2 ')
      // (a = 'b'), (x in(...)), (x is null) not used as a call  ->  bare
      .replace(/(^|[^\w]|\b(?:where|and|or|not|when|then|else|check))\(([\w.]+(?:<>|<=|>=|=|<|>|~)(?:'[^']*'|[\w.]+))\)/g, '$1 $2 ')
      .replace(/(^|[^\w]|\b(?:where|and|or|not|when|then|else|check))\(([\w.]+ in\([^()]*\))\)/g, '$1 $2 ')
      .replace(/(^|[^\w]|\b(?:where|and|or|not|when|then|else|check))\(([\w.]+ is (?:not )?null)\)/g, '$1 $2 '));
  }
  const base = text.trim();
  if (!stripDefaults) return base;
  return base
    .replace(/ ?\bdefault\b ?/g, '\u0000')
    .split('\u0000')
    .map((part, index) => (index === 0 ? part : stripDefault(part)))
    .join('')
    .replace(/ +/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .trim();
}

/** Drop one DEFAULT expression (balanced parentheses, quoted literals) from the start of text. */
function stripDefault(text) {
  let depth = 0, i = 0, quoted = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === "'") quoted = false; continue; }
    if (c === "'") quoted = true;
    else if (c === '(') depth++;
    else if (c === ')') { if (depth === 0) break; depth--; }
    else if (depth === 0 && (c === ',' || c === ';' || text.startsWith(' not null', i) || text.startsWith(' null', i) || text.startsWith(' check', i) || text.startsWith(' constraint', i) || text.startsWith(' references', i) || text.startsWith(' unique', i) || text.startsWith(' primary', i))) break;
  }
  return ' ' + text.slice(i).replace(/^ /, '');
}

let withDefaults, withoutDefaults;
/** True when the migrations contain the given fragment, ignoring formatting differences. */
export function schemaIncludes(fragment) {
  withDefaults ??= normalizeSql(readSchemaSql(), { stripDefaults: false });
  withoutDefaults ??= normalizeSql(readSchemaSql());
  return withDefaults.includes(normalizeSql(fragment, { stripDefaults: false }))
    || withoutDefaults.includes(normalizeSql(fragment));
}

/** Normalized statements of the whole schema, split on ';' outside quotes and dollar-quoted bodies. */
function statements() {
  const sql = readSchemaSql();
  const out = [];
  let cur = '', quote = false, dollar = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (dollar) { if (sql.startsWith(dollar, i)) { cur += dollar; i += dollar.length - 1; dollar = null; continue; } cur += c; continue; }
    if (quote) { cur += c; if (c === "'") quote = false; continue; }
    if (c === '-' && sql[i + 1] === '-') { const nl = sql.indexOf('\n', i); i = nl < 0 ? sql.length : nl; cur += ' '; continue; }
    if (c === "'") { quote = true; cur += c; continue; }
    const tag = /^\$[a-z_]*\$/i.exec(sql.slice(i, i + 40));
    if (tag) { dollar = tag[0]; cur += dollar; i += dollar.length - 1; continue; }
    if (c === ';') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => normalizeSql(s, { stripDefaults: false })).filter(Boolean);
}

/** A table's CREATE TABLE plus every ALTER TABLE that adds its constraints, normalized. */
export function schemaTable(table) {
  const name = table.toLowerCase();
  return statements().filter((s) => s.startsWith(`create table ${name}(`)
    || new RegExp(`^alter table(?: only)? ${name} `).test(s)).join(';\n');
}

/** The first normalized statement containing the fragment (e.g. 'create view rxo_shipment_context'). */
export function schemaStatement(fragment) {
  const wanted = normalizeSql(fragment, { stripDefaults: false });
  return statements().find((s) => s.includes(wanted)) || '';
}

/** How many times a fragment occurs in the normalized schema. */
export function schemaCount(fragment) {
  withoutDefaults ??= normalizeSql(readSchemaSql());
  return withoutDefaults.split(normalizeSql(fragment)).length - 1;
}

/**
 * A string-like view of the schema for tests written against hand-written SQL:
 * includes/indexOf/slice use normalized matching; String(...) gives the raw SQL
 * (for regex checks such as /\bDROP\s+TABLE\b/).
 */
export function schemaSource() {
  const raw = readSchemaSql();
  const text = normalizeSql(raw, { stripDefaults: false });
  return {
    includes: (fragment) => schemaIncludes(fragment),
    indexOf: (fragment, from = 0) => text.indexOf(normalizeSql(fragment, { stripDefaults: false }), Math.max(0, from)),
    slice: (start, end) => text.slice(start, end),
    get length() { return text.length; },
    toString: () => raw,
    [Symbol.toPrimitive]: () => raw,
  };
}
