import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const manufacturingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const workspaceRoot = path.resolve(manufacturingRoot, '..');
const rootFiles = new Set([
  'package.json', 'package-lock.json', 'nx.json', 'tsconfig.base.json',
  'jest.preset.js', 'jest.config.ts', 'eslint.config.mjs', '.dockerignore',
]);
// Manufacturing sources retain their domain directory. Toolchain, dependencies,
// configuration and Dana UI belong to the single repository root.
export function contractPath(base, ...segments) {
  const absolute = path.resolve(base, ...segments);
  const relative = path.relative(manufacturingRoot, absolute).replaceAll('\\', '/');
  if (rootFiles.has(relative) || relative.startsWith('node_modules/') || relative.startsWith('vendor/dana-ui/') || relative.startsWith('libs/shared/dana-ui/')) {
    return path.join(workspaceRoot, relative);
  }
  if (relative.startsWith('manufacturing/')) return path.join(workspaceRoot, relative);
  return absolute;
}
export const readContract = (relative) => fs.readFileSync(contractPath(manufacturingRoot, relative), 'utf8');
