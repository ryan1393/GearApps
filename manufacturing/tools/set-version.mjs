// Update release ownership everywhere, validating every input before writing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function setReleaseVersion(root, next) {
  if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) throw new Error('usage: npm run version:set -- <major.minor.patch>');
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  const current = pkg.version;
  const lock = JSON.parse(read('package-lock.json'));
  const vendor = JSON.parse(read('vendor/dana-ui/VENDOR_MANIFEST.json'));
  if (!lock.packages?.['']) throw new Error('package-lock.json root package entry is missing');
  const staged = new Map();
  pkg.version = next; lock.version = next; lock.packages[''].version = next;
  vendor.danaAppsVersion = next;
  for (const [file, value] of [['package.json', pkg], ['package-lock.json', lock], ['vendor/dana-ui/VENDOR_MANIFEST.json', vendor]]) staged.set(file, JSON.stringify(value, null, 2) + '\n');
  const edit = (file, pattern, replace) => {
    const original = read(file);
    if (!pattern.test(original)) throw new Error(`${file}: version marker not found`);
    staged.set(file, original.replace(pattern, replace));
  };
  const escaped = current.replace(/\./g, '\\.');
  edit('libs/shared/util-constants/src/lib/app-version.constants.ts', /(GEAR_APPS_VERSION = ')[^']+(')/, (_all, a, b) => a + next + b);
  edit('compose.yml', new RegExp(`(image: dana-apps-[a-z-]+:)${escaped}`, 'g'), (_all, prefix) => prefix + next);
  edit('README.md', new RegExp(`(# Gear Apps )${escaped}`), (_all, prefix) => prefix + next);
  for (const [file, value] of staged) fs.writeFileSync(path.join(root, file), value);
  return [...staged.keys()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    console.log(setReleaseVersion(root, process.argv[2]).map(file => `  ${file}`).join('\n'));
    console.log('Run: node tools/test-version-consistency-contract.mjs');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
