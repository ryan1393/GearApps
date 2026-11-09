import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptFile), '..', '..');
const dir = path.resolve(projectRoot, process.argv[2] || './tools/base-data/data');

const readJson = async (name) => {
  const raw = await fs.readFile(path.join(dir, name), 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
};

const clean = (v) => (v == null ? '' : String(v).trim());

const [
  summaryAdditions,
  requirements,
  definitions,
  cutterBodies,
] = await Promise.all([
  readJson('summary_additions.json'),
  readJson('cutter_blade_requirements.json'),
  readJson('cutter_body_definitions.json'),
  readJson('cutter_bodies.json'),
]);

const summaryKeys = new Set();
for (const row of summaryAdditions) {
  const number = clean(row.Summary);
  const revision = clean(row.Summary_Rev);
  if (!number) throw new Error('summary_additions.json contains a blank Summary');
  const key = `${number}\u0000${revision}`;
  if (summaryKeys.has(key)) {
    throw new Error(`Duplicate summary addition: ${number} revision '${revision}'`);
  }
  summaryKeys.add(key);
}

const requirementKeys = new Set();
for (const row of requirements) {
  const summary = clean(row.Summary);
  const revision = clean(row.Summary_Rev);
  const partType = clean(row.Part_Type_Code).toUpperCase();
  const count = Number(row.Blades_Required);

  if (!summary) throw new Error('Blade requirement contains a blank Summary');
  if (!['RING', 'PINION'].includes(partType)) {
    throw new Error(`Invalid part type ${row.Part_Type_Code} for ${summary}`);
  }
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`Invalid blade count ${row.Blades_Required} for ${summary} ${partType}`);
  }

  const key = `${summary}\u0000${revision}\u0000${partType}`;
  if (requirementKeys.has(key)) {
    throw new Error(`Duplicate blade requirement: ${summary} ${partType}`);
  }
  requirementKeys.add(key);
}

const definitionCodes = new Set();
for (const row of definitions) {
  const code = clean(row.Definition_Code).toUpperCase();
  if (!code) throw new Error('cutter_body_definitions.json contains a blank Definition_Code');
  if (definitionCodes.has(code)) throw new Error(`Duplicate cutter definition: ${code}`);

  for (const requiredField of [
    'Cutter_Head_Code',
    'Supplier_Code',
    'Supplier_Name',
    'Hand_Code',
    'Hand_Name',
    'Blade_Family_Code',
    'Blade_Family_Name',
    'Size_Code',
  ]) {
    if (!clean(row[requiredField])) {
      throw new Error(`Cutter definition ${code} has blank ${requiredField}`);
    }
  }

  definitionCodes.add(code);
}

const danaSerials = new Set();
const mfSerials = new Set();
for (const row of cutterBodies) {
  // Unetched cutters are allowed to have a blank Dana_Serial.
  // MF/manufacturer serial is always required.
  const dana = clean(row.Dana_Serial).toUpperCase();
  const mf = clean(row.MF_Serial).toUpperCase();
  const definitionCode = clean(row.Definition_Code).toUpperCase();

  if (!mf) throw new Error('Cutter body row contains a blank MF/manufacturer serial');

  if (dana) {
    if (danaSerials.has(dana)) {
      throw new Error(`Duplicate Dana serial in import set: ${dana}`);
    }
    danaSerials.add(dana);
  }

  if (mfSerials.has(mf)) {
    throw new Error(`Duplicate MF/manufacturer serial in import set: ${mf}`);
  }
  mfSerials.add(mf);

  if (definitionCode && !definitionCodes.has(definitionCode)) {
    throw new Error(`Cutter body ${mf} references unknown definition ${definitionCode}`);
  }
}

console.log('[PASS] Cutter reference base-data validation passed.');
console.log({
  summary_additions: summaryAdditions.length,
  cutter_blade_requirements: requirements.length,
  cutter_body_definitions: definitions.length,
  cutter_bodies: cutterBodies.length,
});
