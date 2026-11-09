import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const rel = 'libs/truck-log/web/domain/src/lib/check-in-form.ts';
const full = path.join(root, rel);
const must = (ok, message) => {
  if (!ok) throw new Error(`[FAIL] ${message}`);
  console.log(`[PASS] ${message}`);
};

must(fs.existsSync(full), `${rel} exists`);
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const ts = requireFromRoot('typescript');
const text = fs.readFileSync(full, 'utf8');
const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

if (sf.parseDiagnostics.length) {
  const messages = sf.parseDiagnostics.map((d) => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    if (typeof d.start !== 'number') return `${rel}: ${message}`;
    const pos = sf.getLineAndCharacterOfPosition(d.start);
    return `${rel}:${pos.line + 1}:${pos.character + 1}: ${message}`;
  });
  throw new Error(`[FAIL] check-in-form.ts TypeScript syntax is malformed:\n${messages.join('\n')}`);
}
console.log('[PASS] check-in-form.ts parses with zero TypeScript syntax diagnostics');

let hasInterface = false;
const exportedFunctions = new Set();
const walk = (node) => {
  if (ts.isInterfaceDeclaration(node) && node.name.text === 'CheckInForm') hasInterface = true;
  if (ts.isFunctionDeclaration(node) && node.name) {
    const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported) exportedFunctions.add(node.name.text);
  }
  ts.forEachChild(node, walk);
};
walk(sf);

must(hasInterface, 'CheckInForm interface remains intact');
must(exportedFunctions.has('emptyCheckInForm'), 'emptyCheckInForm export remains intact');
must(exportedFunctions.has('toCreateTruckVisitRequest'), 'toCreateTruckVisitRequest export remains intact');
must(!/\blocationName\b/.test(text), 'obsolete per-visit locationName is absent from check-in-form.ts');

console.log('[PASS] Truck Log Check-In form transform-integrity contract passed.');
