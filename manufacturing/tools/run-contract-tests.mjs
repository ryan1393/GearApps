import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
for (const subdirectory of ['', 'data-import', 'test-data']) {
  for (const name of fs.readdirSync(path.join(root, 'tools', subdirectory))) {
    if (
      /^test-.*-contract\.mjs$/.test(name) &&
      name !== 'test-start-grinding-db-contract.mjs'
    )
      files.push(path.join(subdirectory, name));
  }
}
files.sort();
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(root, 'tools', file)], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failures += 1;
    console.error(`FAIL ${file}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  } else console.log(`PASS ${file}`);
}
console.log(
  `${files.length - failures}/${files.length} source contracts passed.`,
);
process.exitCode = failures ? 1 : 0;
