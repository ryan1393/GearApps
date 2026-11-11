import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'tmp',
  '.nx',
  '.angular',
  '.cache',
  '_patch_backups',
  '_archive',
  'runtime-data',
  'secrets',
  'credentials',
  '.auth',
  'deploy-reports',
  'playwright-report',
  'test-results',
  'source-archives',
  'releases',
  'backups',
  'database-reports',
]);

export function packageFileAllowed(relativePath) {
  const relative = relativePath.replaceAll('\\', '/');
  const parts = relative.split('/');
  if (
    !relative ||
    relative.startsWith('/') ||
    /^[A-Za-z]:/.test(relative) ||
    parts.some((part) => !part || part === '..' || part === '.')
  )
    return false;
  if (parts.some((part) => excludedDirectories.has(part.toLowerCase()))) return false;
  if (relative.startsWith('tools/manufacturing/data-import/work/')) return false;
  if (/^tools\/database\/(?:cleanup|legacy-import)\.sql$/i.test(relative)) return false;
  const name = parts.at(-1);
  const template = /(?:^|[._-])(?:example|sample|template)(?:[._-]|$)/i.test(name);
  if (/^\.env(?:\.|$)/i.test(name) && !template) return false;
  if (name.toLowerCase() === '.npmrc') return false;
  if (
    /\.(?:pem|key|pfx|p12|jks|keystore|kdbx)$/i.test(name) ||
    /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i.test(name)
  )
    return false;
  if (
    !template &&
    /\.json$/i.test(name) &&
    /(?:^|[._-])(?:credentials?|secrets?|service[-_]?account|storage[-_]?state|auth(?:[-_]?state)?|browser[-_]?state|session[-_]?state|cookies?|tokens?)(?:[._-]|$)/i.test(
      name,
    )
  )
    return false;
  return (
    !/\.(?:zip|tgz)\.sha256$/i.test(name) &&
    !/\.(?:log|zip|tgz|sqlite|sqlite3|db|dump|bak|tmp)$/i.test(name) &&
    name !== '.DS_Store'
  );
}

function zipRecord(size, write) {
  const buffer = Buffer.alloc(size);
  write(buffer);
  return buffer;
}

export function packageRelease(outputDirectory = path.join(workspaceRoot, 'releases')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  const entries = [];
  function visit(directory, relative = '') {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!packageFileAllowed(name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full, name);
      else if (entry.isFile()) entries.push({ name, full });
    }
  }
  visit(workspaceRoot);
  assert.ok(entries.length > 0 && entries.length < 65535, 'Source archive must fit ZIP32');
  const records = [],
    central = [];
  let offset = 0,
    centralSize = 0;
  for (const entry of entries) {
    const name = Buffer.from(`MeshForge-${pkg.version}/${entry.name}`, 'utf8');
    const data = fs.readFileSync(entry.full);
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    assert.ok(name.length < 65536 && data.length < 0xffffffff && compressed.length < 0xffffffff);
    const local = zipRecord(30, (b) => {
      b.writeUInt32LE(0x04034b50);
      b.writeUInt16LE(20, 4);
      b.writeUInt16LE(0x800, 6);
      b.writeUInt16LE(8, 8);
      b.writeUInt16LE(0x21, 12);
      b.writeUInt32LE(checksum, 14);
      b.writeUInt32LE(compressed.length, 18);
      b.writeUInt32LE(data.length, 22);
      b.writeUInt16LE(name.length, 26);
    });
    const directory = zipRecord(46, (b) => {
      b.writeUInt32LE(0x02014b50);
      b.writeUInt16LE(0x0314, 4);
      b.writeUInt16LE(20, 6);
      b.writeUInt16LE(0x800, 8);
      b.writeUInt16LE(8, 10);
      b.writeUInt16LE(0x21, 14);
      b.writeUInt32LE(checksum, 16);
      b.writeUInt32LE(compressed.length, 20);
      b.writeUInt32LE(data.length, 24);
      b.writeUInt16LE(name.length, 28);
      b.writeUInt32LE(
        ((0o100000 | (fs.statSync(entry.full).mode & 0o111 ? 0o755 : 0o644)) * 0x10000) >>> 0,
        38,
      );
      b.writeUInt32LE(offset, 42);
    });
    records.push(local, name, compressed);
    central.push(directory, name);
    offset += local.length + name.length + compressed.length;
    centralSize += directory.length + name.length;
    assert.ok(offset + centralSize < 0xffffffff, 'Source archive exceeds ZIP32 size');
  }
  const end = zipRecord(22, (b) => {
    b.writeUInt32LE(0x06054b50);
    b.writeUInt16LE(entries.length, 8);
    b.writeUInt16LE(entries.length, 10);
    b.writeUInt32LE(centralSize, 12);
    b.writeUInt32LE(offset, 16);
  });
  const output = path.resolve(outputDirectory, `MeshForge-${pkg.version}.zip`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  try {
    fs.writeFileSync(temporary, Buffer.concat([...records, ...central, end]));
    fs.renameSync(temporary, output);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  const sha256 = createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(`${output}.sha256`, `${sha256}  ${path.basename(output)}\n`);
  console.log(`Packaged ${entries.length} source files: ${output}`);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output-dir'))
    throw new Error('Usage: node tools/package-release.mjs [--output-dir directory]');
  packageRelease(args[1]);
}
