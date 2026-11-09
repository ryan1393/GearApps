import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const service = read('libs/server/feat-greenshed/src/lib/server-feat-greenshed.service.ts');
const workflow = read('tools/test-full-workflow.ps1');
const fixture = read('tools/test-data/ensure-workflow-test-fixtures.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  service.includes("buildPartType === 'PINION' && machineDepartment === 'PINION CUTTING'") &&
  service.includes("buildPartType === 'RING' && machineDepartment === 'GEAR CUTTING'"),
  'Green Shed setup must enforce PINION->PINION CUTTING and RING->GEAR CUTTING machine compatibility.',
);
assert(
  service.includes('part.part_type_id !== build.part_type_id') &&
  service.includes('part.summary_id !== build.summary_id'),
  'Green Shed setup must enforce both Summary and Part Type compatibility for the selected part number.',
);
assert(
  workflow.includes("'Reject PINION/RING part-number mismatch'") &&
  workflow.includes("'Reject PINION/RING machine mismatch'"),
  'The full workflow must actively test both cross-type rejection paths.',
);
assert(
  fixture.includes('wrong_type_part_number') &&
  fixture.includes('wrong_type_machine_number') &&
  fixture.includes("requirement.part_type_code === 'PINION' ? 'RING' : 'PINION'"),
  'Automatic fixtures must provide opposite-type part and machine test data.',
);

console.log('[PASS] PINION/RING part + machine compatibility contract passed.');
