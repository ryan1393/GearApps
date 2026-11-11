// One release owner for Lapper and manufacturing; validate every edit before writing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function setReleaseVersion(root, next) {
  if (!/^\d+\.\d+\.\d+$/.test(next ?? ''))
    throw new Error('usage: npm run version:set -- <major.minor.patch>');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  if (!lock.packages?.[''])
    throw new Error('package-lock.json root package entry is missing');
  const staged = new Map();
  pkg.version = next;
  lock.version = next;
  lock.packages[''].version = next;
  for (const [file, value] of [
    ['package.json', pkg],
    ['package-lock.json', lock],
  ])
    staged.set(file, JSON.stringify(value, null, 2) + '\n');
  const edit = (file, pattern, replace) => {
    const original = read(file);
    if (!pattern.test(original))
      throw new Error(`${file}: version marker not found`);
    staged.set(file, original.replace(pattern, replace));
  };
  edit(
    'libs/shared/domain/src/lib/app-version.ts',
    /(MESHFORGE_VERSION\s*=\s*['"])[^'"]+(['"])/,
    (_all, a, b) => a + next + b,
  );
  edit(
    'apps/lapper-read/Directory.Build.props',
    /(<Version>\s*)[^<]+(\s*<\/Version>)/,
    (_all, prefix, suffix) => prefix + next + suffix,
  );
  edit(
    'apps/lapper-read-py/lapper_read/__init__.py',
    /(__version__\s*=\s*")[^"]+(")/,
    (_all, a, b) => a + next + b,
  );
  edit(
    'README.md',
    /(# MeshForge )\d+\.\d+\.\d+/,
    (_all, prefix) => prefix + next,
  );
  edit(
    'compose.yml',
    /(image: dana-apps-[a-z-]+:)\d+\.\d+\.\d+/g,
    (_all, prefix) => prefix + next,
  );
  edit(
    'docs/manufacturing/README.md',
    /(# MeshForge )\d+\.\d+\.\d+/,
    (_all, prefix) => prefix + next,
  );
  for (const [file, value] of staged)
    fs.writeFileSync(path.join(root, file), value);
  return [...staged.keys()];
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  try {
    console.log(
      setReleaseVersion(root, process.argv[2])
        .map((file) => `  ${file}`)
        .join('\n'),
    );
    console.log('Run: npm run test:version');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
