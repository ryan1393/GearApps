import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

/** Read only a bounded, hash-verified PDF inside the configured document volume. */
export async function readDockScanPdf(
  storageRoot: string, relativePath: string, expectedSize: number, expectedSha256: string, maxBytes: number,
): Promise<Buffer> {
  if (!relativePath || relativePath.includes('\\') || relativePath.startsWith('/') ||
      relativePath.split('/').some((part) => !part || part === '.' || part === '..') ||
      !Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > maxBytes ||
      !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Unsafe or incomplete PDF metadata.');
  const root = await realpath(resolve(storageRoot));
  const requested = resolve(root, relativePath);
  if (!requested.startsWith(root + sep)) throw new Error('PDF is outside document storage.');
  const actual = await realpath(requested);
  if (!actual.startsWith(root + sep)) throw new Error('PDF resolves outside document storage.');
  // Do not follow a replaced final-component symlink. The size/hash check also
  // prevents a changed file from being substituted between lookup and confirmation.
  const file = await open(actual, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== expectedSize || stat.size > maxBytes) throw new Error('PDF size changed.');
    const buffer = Buffer.alloc(expectedSize);
    let offset = 0;
    while (offset < expectedSize) {
      const result = await file.read(buffer, offset, expectedSize - offset, offset);
      if (!result.bytesRead) throw new Error('PDF is truncated.');
      offset += result.bytesRead;
    }
    const after = await file.stat();
    if (after.size !== expectedSize || !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')) ||
        createHash('sha256').update(buffer).digest('hex') !== expectedSha256) throw new Error('PDF integrity check failed.');
    return buffer;
  } finally { await file.close(); }
}
