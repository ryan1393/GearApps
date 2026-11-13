// Regenerates tools/truck-log/admin-auth-core.cjs from the server source so the
// admin command-line tool and the API share one implementation.
//   node tools/truck-log/build-admin-auth-core.mjs          write the file
//   node tools/truck-log/build-admin-auth-core.mjs --check  fail if it is stale
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = 'libs/truck-log/server/auth/admin/src/lib/admin-security.ts';
const TARGET = 'tools/truck-log/admin-auth-core.cjs';
const HEADER = `// GENERATED from ${SOURCE} by tools/truck-log/build-admin-auth-core.mjs. Do not edit.\n`;

function loadTypeScript() {
  for (const base of [path.join(root, 'package.json'), import.meta.url]) {
    try { return createRequire(base)('typescript'); } catch { /* try next */ }
  }
  return null;
}

const ts = loadTypeScript();
if (!ts) {
  console.log('[SKIP] typescript is not installed; admin-auth-core.cjs freshness not checked.');
  process.exit(0);
}
const source = fs.readFileSync(path.join(root, SOURCE), 'utf8');
const output = HEADER + ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const current = fs.readFileSync(path.join(root, TARGET), 'utf8');
if (process.argv.includes('--check')) {
  if (current !== output) {
    console.error(`[FAIL] ${TARGET} is stale. Run: node tools/truck-log/build-admin-auth-core.mjs`);
    process.exit(1);
  }
  console.log(`[PASS] ${TARGET} matches ${SOURCE}.`);
} else {
  fs.writeFileSync(path.join(root, TARGET), output);
  console.log(`[PASS] Regenerated ${TARGET}.`);
}
