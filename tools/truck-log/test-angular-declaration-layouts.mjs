#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./check-angular-templates.mjs', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-declarations-'));
const appDir = path.join(temp, 'apps/truck-log/src');
const pkgDir = path.join(temp, 'node_modules/@dana/ui');
const declaration = (prefix, namespace) => `${prefix} class InternalControl<T = unknown> implements ControlValueAccessor {
  writeValue(value: unknown): void;
  registerOnChange(callback: (value: unknown) => void): void;
  static ɵcmp: ${namespace}.ɵɵComponentDeclaration<InternalControl<any>, "dana-test-control", never,
    { opts: { alias: "options"; required: false; isSignal: false; }; disabled: "disabled"; },
    { pickedEvent: "picked"; }, never, never, true, never>;
}`;
const source = ({ imported = true, input = 'options', output = 'picked', selector = 'dana-test-control' } = {}) => `
@Component({ selector: 'tl-fixture', standalone: true, imports: [FormsModule${imported ? ', LibControl' : ''}],
  template: '<${selector} [${input}]="rows" [(ngModel)]="value" (${output})="pick($event)"></${selector}>' })
export class Fixture { rows = []; value = ''; pick(event: unknown): void {} }
`;
const run = (options) => {
  fs.writeFileSync(path.join(appDir, 'fixture.ts'), source(options));
  const result = spawnSync(process.execPath, [checker], { cwd: temp, encoding: 'utf8' });
  return { status: result.status, text: result.stdout + result.stderr };
};
try {
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@dana/ui', typings: 'index.d.ts' }));
  for (const layout of ['split-reexport', 'flat-local-export', 'direct-export']) {
    if (layout === 'split-reexport') {
      fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), 'export { InternalControl as LibControl } from "./control";\n');
      fs.writeFileSync(path.join(pkgDir, 'control.d.ts'), declaration('export declare', 'i0'));
    } else if (layout === 'flat-local-export') {
      fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), declaration('declare', 'angularCore') + '\nexport { InternalControl as LibControl };\n');
    } else {
      fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), declaration('export declare', 'ng').replaceAll('InternalControl', 'LibControl'));
    }
    const valid = run();
    assert.equal(valid.status, 0, `${layout}: ${valid.text}`);
    const typeFile = path.join(pkgDir, layout === 'split-reexport' ? 'control.d.ts' : 'index.d.ts');
    const originalTypes = fs.readFileSync(typeFile, 'utf8');
    fs.writeFileSync(typeFile, originalTypes.replace(' implements ControlValueAccessor', '')
      .replace('  writeValue(value: unknown): void;', '')
      .replace('  registerOnChange(callback: (value: unknown) => void): void;', ''));
    const noAccessor = run();
    assert.notEqual(noAccessor.status, 0, `${layout} accepted ngModel without a value accessor`);
    assert.match(noAccessor.text, /is not a ControlValueAccessor/);
    fs.writeFileSync(typeFile, originalTypes);
    for (const [options, expected] of [
      [{ imported: false }, /LibControl is not in imports/],
      [{ input: 'missingInput' }, /has no @Input 'missingInput'/],
      [{ output: 'missingOutput' }, /has no @Output 'missingOutput'/],
      [{ selector: 'dana-unknown' }, /unknown element <dana-unknown>/],
    ]) {
      const invalid = run(options);
      assert.notEqual(invalid.status, 0, `${layout} accepted ${JSON.stringify(options)}`);
      assert.match(invalid.text, expected);
    }
  }
  console.log('[PASS] Angular 19 split, Angular 20 bundled, and direct exported typings retain selector/import/input/output/CVA checks.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
