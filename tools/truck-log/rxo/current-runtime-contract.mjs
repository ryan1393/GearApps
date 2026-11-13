import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MANIFEST = 'apps/rxo-integration/RUNTIME-MANIFEST.json';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export function currentRuntime(root = process.cwd()) {
  const file = path.join(root, MANIFEST);
  if (!fs.existsSync(file)) throw new Error('RXO runtime manifest is missing.');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  if (manifest.release !== version || manifest.validationStatus !== 'SOURCE_VERIFIED') {
    throw new Error('Unexpected RXO runtime manifest release/status.');
  }
  for (const [relative, metadata] of Object.entries(manifest.files || {})) {
    // libs/truck-log/rxo-shared is copied into the exporter image's src/lib.
    if (!relative.startsWith('apps/rxo-integration/') && !relative.startsWith('libs/truck-log/rxo-shared/') && relative !== 'docker-compose.yml') {
      throw new Error(`Invalid RXO runtime path: ${relative}`);
    }
    const bytes = fs.readFileSync(path.join(root, relative));
    if (bytes.length !== metadata.bytes || sha256(bytes) !== metadata.sha256) {
      throw new Error(`RXO runtime drift: ${relative}`);
    }
  }
  return manifest;
}

