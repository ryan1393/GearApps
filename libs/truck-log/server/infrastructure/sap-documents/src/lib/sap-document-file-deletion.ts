import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  RXO_STORAGE_DIRECTORY,
  SAP_STORAGE_DIRECTORY,
  STORAGE_DAY_PATTERN,
  STORAGE_MONTH_PATTERN,
  STORAGE_YEAR_PATTERN,
  STORED_PDF_NAME_PATTERN,
  SapDocumentFileValidationError,
  TEMPORARY_PDF_NAME_PATTERN,
  assertContainedPath,
  resolveImmutableDocumentStoragePath,
  validateStorageNamespace,
  type ImmutableDocumentStorageNamespace,
} from './sap-document-storage-paths';

/*
 * Descriptor-anchored cleanup of immutable stored PDFs and crash-window
 * temporary files. Linux-only by design: it fails closed elsewhere.
 */

export async function deleteStoredImmutableDocumentPdf(
  storageRoot: string,
  relativePath: string,
  namespace: ImmutableDocumentStorageNamespace,
): Promise<void> {
  return deleteStoredImmutableDocumentFile(
    storageRoot,
    relativePath,
    namespace,
    STORED_PDF_NAME_PATTERN,
  );
}

async function deleteStoredImmutableDocumentFile(
  storageRoot: string,
  relativePath: string,
  namespace: ImmutableDocumentStorageNamespace,
  allowedFileName: RegExp,
): Promise<void> {
  const expectedNamespace = validateStorageNamespace(namespace);
  resolveImmutableDocumentStoragePath(
    storageRoot,
    relativePath,
    expectedNamespace,
  );
  const parts = relativePath.split('/');
  if (
    parts.length !== 5
    || parts[0] !== expectedNamespace
    || !STORAGE_YEAR_PATTERN.test(parts[1])
    || !STORAGE_MONTH_PATTERN.test(parts[2])
    || !STORAGE_DAY_PATTERN.test(parts[3])
    || !allowedFileName.test(parts[4])
  ) {
    throw new SapDocumentFileValidationError(
      'INVALID_STORAGE_PATH',
      'Immutable document cleanup requires a canonical dated storage path.',
    );
  }

  // Destructive cleanup is deliberately descriptor-anchored through Linux
  // procfs. A lexical-path fallback on Windows or macOS would reopen the
  // symlink/directory-swap race this helper is designed to prevent, so an
  // unsupported native runtime must fail closed instead of pretending the
  // target was already absent.
  if (process.platform !== 'linux') {
    throw new SapDocumentFileValidationError(
      'INVALID_STORAGE_PATH',
      'Immutable document cleanup requires the Linux descriptor-anchored server runtime.',
    );
  }

  let parentHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const canonicalRoot = await realpath(resolve(storageRoot));
    const expectedNamespacePath = join(canonicalRoot, expectedNamespace);
    const namespaceMetadata = await lstat(expectedNamespacePath);
    if (namespaceMetadata.isSymbolicLink() || !namespaceMetadata.isDirectory()) {
      throw new SapDocumentFileValidationError(
        'INVALID_STORAGE_PATH',
        'Immutable document cleanup namespace must be a physical directory.',
      );
    }
    const canonicalNamespace = await realpath(expectedNamespacePath);
    if (canonicalNamespace !== expectedNamespacePath) {
      throw new SapDocumentFileValidationError(
        'INVALID_STORAGE_PATH',
        'Immutable document cleanup namespace failed exact-path checks.',
      );
    }

    const expectedParent = join(canonicalRoot, ...parts.slice(0, -1));
    assertContainedPath(canonicalNamespace, expectedParent);
    parentHandle = await open(
      expectedParent,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
    const parentDescriptorPath = `/proc/self/fd/${parentHandle.fd}`;
    let openedParent: string;
    try {
      openedParent = await realpath(parentDescriptorPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new SapDocumentFileValidationError(
          'INVALID_STORAGE_PATH',
          'Immutable document cleanup could not resolve its held parent directory descriptor.',
        );
      }
      throw error;
    }
    if (openedParent !== expectedParent) {
      throw new SapDocumentFileValidationError(
        'INVALID_STORAGE_PATH',
        'Immutable document cleanup date path failed exact-path checks.',
      );
    }

    const descriptorPath = `/proc/self/fd/${parentHandle.fd}/${parts[4]}`;
    const file = await lstat(descriptorPath);
    if (file.isSymbolicLink() || !file.isFile()) {
      throw new SapDocumentFileValidationError(
        'INVALID_STORAGE_PATH',
        'Immutable document cleanup accepts only a regular stored PDF.',
      );
    }
    // Resolve the held descriptor again immediately before unlink. The delete
    // is issued through that descriptor, so a concurrent lexical directory
    // swap cannot redirect cleanup into another date tree.
    let recheckedParent: string;
    try {
      recheckedParent = await realpath(parentDescriptorPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new SapDocumentFileValidationError(
          'INVALID_STORAGE_PATH',
          'Immutable document cleanup lost its held parent directory descriptor.',
        );
      }
      throw error;
    }
    if (recheckedParent !== expectedParent) {
      throw new SapDocumentFileValidationError(
        'INVALID_STORAGE_PATH',
        'Immutable document cleanup path changed during containment checks.',
      );
    }
    await unlink(descriptorPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  } finally {
    if (parentHandle) await parentHandle.close().catch(() => undefined);
  }
}

export async function deleteStoredSapDocumentPdf(
  storageRoot: string,
  relativePath: string,
): Promise<void> {
  return deleteStoredImmutableDocumentPdf(
    storageRoot,
    relativePath,
    SAP_STORAGE_DIRECTORY,
  );
}

export async function deleteStoredRxoDocumentPdf(
  storageRoot: string,
  relativePath: string,
): Promise<void> {
  return deleteStoredImmutableDocumentPdf(
    storageRoot,
    relativePath,
    RXO_STORAGE_DIRECTORY,
  );
}

export async function deleteStoredRxoTemporaryPdf(
  storageRoot: string,
  relativePath: string,
): Promise<void> {
  return deleteStoredImmutableDocumentFile(
    storageRoot,
    relativePath,
    RXO_STORAGE_DIRECTORY,
    TEMPORARY_PDF_NAME_PATTERN,
  );
}
