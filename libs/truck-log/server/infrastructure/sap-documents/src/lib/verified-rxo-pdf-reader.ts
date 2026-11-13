import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { safeDigestEqual } from '@truck-log/server/data-access';

/**
 * The one reader for immutable RXO driver-document PDFs.
 *
 * Used by the RXO Documents download route and by both Print Agent download
 * paths (legacy and automatic). It reads the bounded file into memory from a
 * single no-follow descriptor, after proving that:
 *   - the storage root's `rxo` namespace is a physical child of the root,
 *   - the canonical file is inside the root and the namespace,
 *   - the descriptor that supplies the bytes is that same canonical file,
 *   - it is a regular file of exactly the recorded size, and
 *   - (when given) its SHA-256 equals the recorded digest.
 * Callers decide how a failure is reported; the reason code lets them keep
 * their own public error messages.
 */
export type VerifiedRxoPdfFailureReason =
  | 'NAMESPACE_INVALID'
  | 'PATH_OUTSIDE_NAMESPACE'
  | 'OPENED_PATH_CHANGED'
  | 'SIZE_OR_TYPE_MISMATCH'
  | 'BYTES_CHANGED'
  | 'SHA256_MISMATCH';

export class VerifiedRxoPdfError extends Error {
  constructor(
    readonly reason: VerifiedRxoPdfFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'VerifiedRxoPdfError';
  }
}

export interface VerifiedRxoPdfStorage {
  storageRoot(): string;
  resolveRxoPath(relativePath: string): string;
}

export interface VerifiedRxoPdf {
  /** The exact bytes read from the verified descriptor. */
  buffer: Buffer;
  /** Canonical absolute path of the verified file. */
  canonicalPath: string;
}

function isStrictlyInside(base: string, candidate: string): boolean {
  const fromBase = relative(base, candidate);
  return !(
    !fromBase ||
    fromBase === '..' ||
    fromBase.startsWith(`..${sep}`) ||
    isAbsolute(fromBase)
  );
}

export async function readVerifiedRxoPdf(
  storage: VerifiedRxoPdfStorage,
  relativePath: string,
  expectedSize: number,
  expectedSha256?: string,
): Promise<VerifiedRxoPdf> {
  return new VerifiedRxoPdfReader(storage).read(relativePath, expectedSize, expectedSha256);
}

export class VerifiedRxoPdfReader {
  constructor(private readonly storage: VerifiedRxoPdfStorage) {}

  async read(
    relativePath: string,
    expectedSize: number,
    expectedSha256?: string,
  ): Promise<VerifiedRxoPdf> {
    // Throws SapDocumentFileValidationError for a malformed relative path.
    const absolutePath = this.storage.resolveRxoPath(relativePath);
    const [root, namespaceRoot] = await Promise.all([
      realpath(this.storage.storageRoot()),
      realpath(resolve(this.storage.storageRoot(), 'rxo')),
    ]);
    if (relative(root, namespaceRoot) !== 'rxo') {
      throw new VerifiedRxoPdfError('NAMESPACE_INVALID', 'Document storage namespace is invalid.');
    }
    const canonicalFile = await realpath(absolutePath);
    if (!isStrictlyInside(root, canonicalFile) || !isStrictlyInside(namespaceRoot, canonicalFile)) {
      throw new VerifiedRxoPdfError('PATH_OUTSIDE_NAMESPACE', 'Document storage path is invalid.');
    }

    // Verify and serve the exact same opened bytes. O_NOFOLLOW prevents the
    // final path component from being swapped to a symlink between checks;
    // buffering the bounded PDF removes the path-to-stream TOCTOU entirely.
    // Truck Log is Docker-first on Linux: resolving the open descriptor through
    // /proc closes the intermediate-directory swap window.
    let pdfBuffer: Buffer;
    const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const openedPath = await realpath(`/proc/self/fd/${handle.fd}`);
      const openedFromRoot = relative(root, openedPath);
      const openedFromNamespace = relative(namespaceRoot, openedPath);
      if (
        openedPath !== canonicalFile ||
        !openedFromRoot ||
        openedFromRoot === '..' ||
        openedFromRoot.startsWith(`..${sep}`) ||
        isAbsolute(openedFromRoot) ||
        !openedFromNamespace ||
        openedFromNamespace === '..' ||
        openedFromNamespace.startsWith(`..${sep}`) ||
        isAbsolute(openedFromNamespace)
      ) {
        throw new VerifiedRxoPdfError('OPENED_PATH_CHANGED', 'Opened document storage path is invalid.');
      }
      const openedStat = await handle.stat();
      if (!openedStat.isFile() || openedStat.size !== expectedSize) {
        throw new VerifiedRxoPdfError('SIZE_OR_TYPE_MISMATCH', 'Document storage size or type is invalid.');
      }
      pdfBuffer = await handle.readFile();
    } finally {
      await handle.close();
    }
    if (pdfBuffer.length !== expectedSize) {
      throw new VerifiedRxoPdfError('BYTES_CHANGED', 'Document bytes changed while being read.');
    }
    if (expectedSha256 !== undefined) {
      const actualSha256 = createHash('sha256').update(pdfBuffer).digest('hex');
      if (!safeDigestEqual(actualSha256, expectedSha256)) {
        throw new VerifiedRxoPdfError(
          'SHA256_MISMATCH',
          'Document SHA-256 does not match immutable metadata.',
        );
      }
    }
    return { buffer: pdfBuffer, canonicalPath: canonicalFile };
  }
}
