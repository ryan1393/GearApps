// TypeORM's PostgreSQL driver returns `[rows, affectedCount]` for raw
// UPDATE … RETURNING and DELETE … RETURNING, but a plain row array for SELECT and
// INSERT … RETURNING. Reading `.length` or `[0]` from the wrapped form silently
// gives 2 and "the whole row array", which turns "no row matched" into "found".
//
// This check fails if any server raw query that updates or deletes with RETURNING
// is not passed straight through a helper that unwraps that shape.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const HELPER_BEFORE = /(returnedRows|updateRows|oneUpdated|printAgentReturningRows|exactlyOneRowUpdated)(<.*>)?\(\s*$/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
  });
}

/** Every `.query(…)` call whose SQL updates or deletes with RETURNING. */
export function returningCalls(source) {
  const calls = [];
  const re = /\.query(?:<[^>]*>)?\(/g;
  let match;
  while ((match = re.exec(source))) {
    let depth = 1, end = match.index + match[0].length;
    for (; end < source.length && depth; end++) {
      if (source[end] === '(') depth++;
      else if (source[end] === ')') depth--;
    }
    const call = source.slice(match.index, end);
    if (!/\b(UPDATE|DELETE)\b/i.test(call) || !/\bRETURNING\b/i.test(call)) continue;
    if (/^\.query(?:<[^>]*>)?\(\s*['"`]\s*(SELECT|INSERT)\b/i.test(call)) continue;
    const awaitAt = source.lastIndexOf('await ', match.index);
    const receiver = awaitAt < 0 ? '' : source.slice(awaitAt + 6, match.index);
    const direct = awaitAt >= 0 && /^[\w.\s]*$/.test(receiver) && receiver.length <= 60;
    const wrapped = direct && HELPER_BEFORE.test(source.slice(Math.max(0, awaitAt - 120), awaitAt));
    calls.push({ line: source.slice(0, match.index).split('\n').length, wrapped });
  }
  return calls;
}

// Self-test of the scanner.
assert.deepEqual(returningCalls("const r = await db.query('UPDATE t SET a=1 RETURNING id');").map((c) => c.wrapped), [false]);
assert.deepEqual(returningCalls("const r = returnedRows(await db.query('UPDATE t SET a=1 RETURNING id'));").map((c) => c.wrapped), [true]);
assert.deepEqual(returningCalls("const r = returnedRows<Pick<Row, 'id'>>(await q.query(`DELETE FROM t RETURNING id`));").map((c) => c.wrapped), [true]);
assert.deepEqual(returningCalls("await db.query('INSERT INTO t(a) VALUES (1) RETURNING id'); await db.query('UPDATE t SET a=1')"), []);

let total = 0;
const failures = [];
for (const file of walk(path.join(root, 'libs/truck-log/server'))) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  for (const call of returningCalls(fs.readFileSync(file, 'utf8'))) {
    total++;
    if (!call.wrapped) failures.push(`${rel}:${call.line}`);
  }
}
assert.ok(total >= 30, `expected to find the server's UPDATE/DELETE … RETURNING queries, found ${total}`);
assert.deepEqual(failures, [], `Wrap these UPDATE/DELETE … RETURNING results in returnedRows(): ${failures.join(', ')}`);

const helper = fs.readFileSync(path.join(root, 'libs/truck-log/server/data-access/src/lib/support/request-integrity.ts'), 'utf8');
assert.match(helper, /export function returnedRows</, 'data-access exports returnedRows');
console.log(`[PASS] Query result shape: ${total} UPDATE/DELETE … RETURNING queries unwrap TypeORM's [rows, count].`);
