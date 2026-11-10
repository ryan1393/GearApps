import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tools/manufacturing/lib -> repository root. Manufacturing sources live in
// libs/manufacturing, tools/manufacturing, docs/manufacturing and commands, and
// every contract path is relative to the single workspace root.
export const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export function contractPath(base, ...segments) {
  return path.resolve(base, ...segments);
}
export const readContract = (relative) => fs.readFileSync(contractPath(workspaceRoot, relative), 'utf8');
