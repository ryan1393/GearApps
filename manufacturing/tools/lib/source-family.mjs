import { contractPath } from './contract-paths.mjs';
// Contract tests check that behaviour exists "in" a source file. Several large
// services were split in 70.1.0 (read-side queries moved to *.queries.ts); this
// returns the original file's text followed by the modules carved out of it, so
// those checks keep working wherever the code now lives.
import fs from 'node:fs';
import path from 'node:path';

export const SPLIT_FAMILIES = {
  'libs/server/feat-cutter-build/src/lib/server-feat-cutter-build.service.ts': [
    'libs/server/feat-cutter-build/src/lib/cutter-build.queries.ts',
  ],
  'libs/server/feat-greenshed/src/lib/server-feat-greenshed.service.ts': [
    'libs/server/feat-greenshed/src/lib/greenshed.queries.ts',
  ],
  'libs/server/feat-tray/src/lib/server-feat-tray.service.ts': [
    'libs/server/feat-tray/src/lib/tray.queries.ts',
  ],
};

export function readSourceFamily(root, rel) {
  const key = rel.split(path.sep).join('/');
  return [key, ...(SPLIT_FAMILIES[key] ?? [])]
    .map((p) => fs.readFileSync(contractPath(root, p), 'utf8'))
    .join('\n');
}
