import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'data/rxo/latest');

const expected = [
  { pageKey: 'orders', direction: 'OUTBOUND', file: 'Outbound.xlsx' },
  { pageKey: 'orders', direction: 'INBOUND', file: 'Inbound.xlsx' },
  { pageKey: 'freight-on-the-move', direction: 'OUTBOUND', file: 'Outbound.xlsx' },
  { pageKey: 'freight-on-the-move', direction: 'INBOUND', file: 'Inbound.xlsx' },
  { pageKey: 'shipments', direction: 'OUTBOUND', file: 'Outbound.xlsx' },
  { pageKey: 'shipments', direction: 'INBOUND', file: 'Inbound.xlsx' },
];

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function isXlsx(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(2);
    const read = fs.readSync(fd, buffer, 0, 2, 0);
    return read === 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  } finally {
    fs.closeSync(fd);
  }
}

const manifestPath = path.join(root, 'fort-wayne', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  fail(`Missing manifest: ${manifestPath}`);
  process.exit();
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (error) {
  fail(`Could not parse manifest: ${error.message}`);
  process.exit();
}

if (manifest.status !== 'complete') {
  fail(`Manifest status must be complete; got ${manifest.status}`);
}

if (!Array.isArray(manifest.exports) || manifest.exports.length !== 6) {
  fail(`Manifest must contain exactly 6 exports; got ${manifest.exports?.length ?? 'none'}`);
}

const identifiers = new Set(manifest.site?.requiredIdentifiers ?? []);
for (const value of ['12808', 'DANA_USA_FORT_WAYNE_IN']) {
  if (!identifiers.has(value)) {
    fail(`Manifest site is missing required Fort Wayne identifier ${value}`);
  }
}

if (manifest.directionRule?.Origin !== 'OUTBOUND') {
  fail('Manifest directionRule.Origin must be OUTBOUND.');
}
if (manifest.directionRule?.Destination !== 'INBOUND') {
  fail('Manifest directionRule.Destination must be INBOUND.');
}

const manifestByKey = new Map(
  (manifest.exports ?? []).map((entry) => [`${entry.pageKey}|${entry.direction}`, entry]),
);

const datasets = [];

for (const item of expected) {
  const key = `${item.pageKey}|${item.direction}`;
  const entry = manifestByKey.get(key);
  if (!entry) {
    fail(`Manifest missing ${key}`);
    continue;
  }

  const file = path.join(root, 'fort-wayne', item.pageKey, item.file);
  if (!fs.existsSync(file)) {
    fail(`Missing XLSX: ${file}`);
    continue;
  }

  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size <= 0) {
    fail(`Empty/non-file XLSX: ${file}`);
    continue;
  }

  if (!isXlsx(file)) {
    fail(`Not an XLSX ZIP container: ${file}`);
    continue;
  }

  const digest = sha256(file);
  const manifestDigest = entry.download?.sha256;
  if (manifestDigest && digest.toLowerCase() !== String(manifestDigest).toLowerCase()) {
    fail(`SHA256 mismatch for ${key}`);
    continue;
  }

  datasets.push({
    pageKey: item.pageKey,
    pageName: entry.pageName ?? item.pageKey,
    direction: item.direction,
    filter: entry.filter ?? (item.direction === 'OUTBOUND' ? 'Origin' : 'Destination'),
    relativePath: path.relative(root, file).split(path.sep).join('/'),
    bytes: stat.size,
    sha256: digest,
    requiredIdentifiers: entry.requiredIdentifiers ?? ['12808', 'DANA_USA_FORT_WAYNE_IN'],
    filterVerification: entry.filterVerification ?? null,
  });

  console.log(`[PASS] ${key}: ${stat.size} bytes`);
}

if (process.exitCode) {
  process.exit();
}

const boundary = {
  contractVersion: 1,
  source: 'RXO Connect',
  authority: 'planned/expected freight only',
  truckLogPhysicalWorkflowAuthoritative: true,
  validatedAt: new Date().toISOString(),
  sourceManifestVersion: manifest.version,
  sourceBatchId: manifest.batchId,
  sourceCompletedAt: manifest.completedAt,
  site: manifest.site,
  directionRule: manifest.directionRule,
  datasetCount: datasets.length,
  datasets,
  postgresImported: false,
};

const boundaryPath = path.join(root, 'truck-log-ingestion-boundary.json');
fs.writeFileSync(boundaryPath, `${JSON.stringify(boundary, null, 2)}\n`, 'utf8');

console.log(`[PASS] Six-file Truck Log RXO boundary: ${boundaryPath}`);
