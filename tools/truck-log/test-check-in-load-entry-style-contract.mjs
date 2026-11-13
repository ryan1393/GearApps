import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readDanaUiStyles } from './source-contract-utils.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const componentPath = 'libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts';
const cssPath = 'libs/truck-log/web/styles/src/styles/check-in.css';
const appStylesPath = 'libs/truck-log/web/styles/src/styles/truck-log.css';
const component = read(componentPath);
const componentFeature = `${component}\n${read('libs/truck-log/web/feature/check-in/src/lib/check-in.component.html')}`;
const css = read(cssPath);
const appStyles = read(appStylesPath);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const marker = (source, value, label) => assert(source.includes(value), `Missing ${label}: ${value}`);

// The load-source switch is a Dana UI segmented control; its pressed state is aria-pressed (Dana styles it).
marker(componentFeature, '<div class="dana-field dana-field-full">', 'full-width Load Number field');
marker(componentFeature, 'id="checkin-load-label">Load Number</label>', 'Load Number label');
marker(componentFeature, '<div class="tl-load-entry">', 'control wrapper');
marker(componentFeature, '<div class="dana-segmented tl-load-source" role="group" aria-label="Load number source">', 'load source switch');
marker(componentFeature, '[attr.aria-pressed]="!manualLoadEntry"', 'RXO aria-pressed state');
marker(componentFeature, '[attr.aria-pressed]="manualLoadEntry"', 'manual aria-pressed state');
marker(componentFeature, '(click)="useFreightLoadPicker()">RXO list</button>', 'RXO switch label');
marker(componentFeature, '(click)="useManualLoadEntry()">Type it</button>', 'manual switch label');
assert(!componentFeature.includes('class="btn" (click)="useManualLoadEntry()"'), 'Legacy ungrouped manual-entry button remains.');
assert(!componentFeature.includes('class="btn" [disabled]="freightLoadsLoading || !freightLoads.length" (click)="useFreightLoadPicker()"'), 'Legacy ungrouped RXO-list button remains.');
assert(!/\[class\.active\]="!?manualLoadEntry"/.test(componentFeature), 'Load-source state must use aria-pressed (Dana segmented), not a parallel .active class.');

const danaStyles = readDanaUiStyles(root);
marker(danaStyles, '.dana-segmented', 'Dana segmented control style');
marker(danaStyles, 'aria-pressed="true"', 'Dana pressed-state style');
marker(css, '.tl-load-entry', 'Check-In layout selector');
marker(appStyles, '@import "./check-in.css";', 'Check-In stylesheet import');

const result = ts.transpileModule(component, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    experimentalDecorators: true,
  },
  reportDiagnostics: true,
  fileName: componentPath,
});
const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
if (errors.length) {
  throw new Error(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));
}

console.log('[PASS] Check-In combined load-source switch (Dana segmented), accessibility state, and TypeScript syntax passed.');
