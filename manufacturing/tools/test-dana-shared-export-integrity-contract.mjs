import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const barrelRel = 'vendor/dana-ui/package/index.d.ts';
const barrel = fs.readFileSync(path.join(root, barrelRel), 'utf8').replace(/^\uFEFF/, '');
const exportRe = /export(?:\s+type)?\s+(?:\{[^}]+\}|\*)\s+from\s+['"](\.\/[^'"]+)['"]/g;
const checked = [];
for (const match of barrel.matchAll(exportRe)) {
  const spec = match[1];
  const base = path.resolve(root, path.dirname(barrelRel), spec);
  const candidates = [base + '.ts', base + '.d.ts', path.join(base, 'index.ts'), path.join(base, 'index.d.ts')];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) throw new Error(`Shared UI barrel export does not resolve: ${spec}`);
  checked.push(path.relative(root, resolved).replaceAll('\\', '/'));
}
if (checked.length < 20) throw new Error(`Shared UI export integrity scan was unexpectedly small: ${checked.length}`);
for (const required of [
  'vendor/dana-ui/package/lib/components/navigation/dana-tabs.directive.d.ts',
  'vendor/dana-ui/package/lib/components/navigation/dana-tab.directive.d.ts',
  'vendor/dana-ui/package/lib/components/feedback/dana-toast-host.component.d.ts',
  'vendor/dana-ui/package/lib/components/feedback/dana-toast.service.d.ts',
  'vendor/dana-ui/package/lib/components/feedback/dana-confirm-dialog.component.d.ts',
]) {
  if (!checked.includes(required)) throw new Error(`Required Step 2 shared export was not verified through the barrel: ${required}`);
}
console.log(`[PASS] Dana shared UI barrel/export integrity passed for ${checked.length} resolved exports.`);
