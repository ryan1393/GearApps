import { contractPath } from './contract-paths.mjs';
// Read an original Dana UI TypeScript source file (e.g. 'lib/components/data/dana-table.directive.ts'
// or 'index.ts') from the vendored @dana/ui package. The package's source map embeds the exact
// sources it was built from, so contract tests can check Dana components without a local copy.
import fs from 'node:fs';
import path from 'node:path';

let cache = null;
export function danaUiSources(root = process.cwd()) {
  if (!cache) {
    const map = JSON.parse(fs.readFileSync(contractPath(root, 'vendor/dana-ui/package/fesm2022/dana-ui.mjs.map'), 'utf8'));
    cache = new Map(map.sources.map((s, i) => [s.replace(/^.*\/src\//, ''), map.sourcesContent[i]]));
  }
  return cache;
}
export function readDanaUiSource(root, rel) {
  const source = contractPath(root, 'libs/shared/dana-ui/src', rel);
  if (fs.existsSync(source)) return fs.readFileSync(source, 'utf8');
  const text = danaUiSources(root).get(rel);
  if (text == null) throw new Error(`Dana UI source not found in the vendored package: ${rel}`);
  return text;
}
