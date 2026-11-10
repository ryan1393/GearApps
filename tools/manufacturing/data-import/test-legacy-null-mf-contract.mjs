import { contractPath } from '../lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const read = (p) => fs.readFileSync(contractPath(root,p),'utf8');
const assert=(c,m)=>{if(!c) throw new Error(m);};

const entity=read('libs/manufacturing/server/data-access/src/lib/database/entities/cutter-tracking/cutter-body.orm-entity.ts');
const dto=read('libs/manufacturing/server/feat-cutter-build/src/lib/cutter-build.dto.ts');
const shared=read('libs/manufacturing/shared/util-types/src/lib/interfaces/cutter-tracking/cutter-body.interface.ts');

assert(entity.includes('mf_serial_number!: string | null;'),'ORM MF field must allow legacy null');
assert(entity.includes('@Column({ type: String, nullable: true })'),'ORM MF column must be nullable');
assert(dto.includes('mf_serial_number!: string;'),'New cutter DTO must still require MF');
assert(shared.includes('mf_serial_number: string | null;'),'Read interface must allow legacy null');

console.log('[PASS] Legacy null-MF startup contract passed.');
