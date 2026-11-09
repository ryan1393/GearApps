import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, open, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ALLOWED_PDF_MIME_TYPES,
  FILE_MODE,
  PDF_HEADER,
  PDF_HEADER_SEARCH_BYTES,
  RXO_STORAGE_DIRECTORY,
  SAP_STORAGE_DIRECTORY,
  SapDocumentFileValidationError,
  UUID_PATTERN,
  assertContainedPath,
  ensureContainedDirectory,
  ensureImmutableDocumentStorageNamespace,
  validateStorageNamespace,
  type SapDocumentPdfInput,
  type StoreImmutableDocumentPdfOptions,
  type StoreSapDocumentPdfOptions,
  type StoredSapDocumentPdf,
} from './sap-document-storage-paths';

// Public storage API (unchanged names): layout/validation types and path
// resolution live in sap-document-storage-paths.ts, cleanup in
// sap-document-file-deletion.ts.
export {
  SapDocumentFileValidationError,
  ensureImmutableDocumentStorageNamespace,
  resolveImmutableDocumentStoragePath,
  resolveRxoDocumentStoragePath,
  resolveSapDocumentStoragePath,
} from './sap-document-storage-paths';
export type {
  ImmutableDocumentStorageNamespace,
  SapDocumentFileValidationCode,
  SapDocumentPdfInput,
  StoreImmutableDocumentPdfOptions,
  StoreSapDocumentPdfOptions,
  StoredSapDocumentPdf,
} from './sap-document-storage-paths';
export {
  deleteStoredImmutableDocumentPdf,
  deleteStoredRxoDocumentPdf,
  deleteStoredRxoTemporaryPdf,
  deleteStoredSapDocumentPdf,
} from './sap-document-file-deletion';

function sanitizeImmutableDocumentFileName(
  originalName: string,
  fallbackStem: string,
): string {
  const leafName = String(originalName || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() || '';
  const cleaned = leafName
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/[^A-Za-z0-9._ ()-]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  const withoutPdfExtension = cleaned.toLowerCase().endsWith('.pdf')
    ? cleaned.slice(0, -4).replace(/[. ]+$/, '')
    : cleaned;
  const stem = withoutPdfExtension || fallbackStem;

  // PostgreSQL stores the metadata name in a varchar(255) column. The stored
  // file itself always uses an opaque UUID and never uses this display name.
  return `${stem.slice(0, 251)}.pdf`;
}

export function sanitizeSapDocumentFileName(originalName: string): string {
  return sanitizeImmutableDocumentFileName(originalName, 'sap-document');
}

export function sanitizeRxoDocumentFileName(originalName: string): string {
  return sanitizeImmutableDocumentFileName(originalName, 'rxo-driver-document');
}

export function validateSapDocumentPdf(
  input: SapDocumentPdfInput,
  maxBytes: number,
): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new SapDocumentFileValidationError(
      'INVALID_MAX_BYTES',
      'The configured SAP document size limit must be a positive integer.',
    );
  }
  if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
    throw new SapDocumentFileValidationError(
      'EMPTY_FILE',
      'The SAP document PDF is empty.',
    );
  }
  if (input.buffer.length > maxBytes) {
    throw new SapDocumentFileValidationError(
      'FILE_TOO_LARGE',
      `The SAP document PDF exceeds the configured ${maxBytes}-byte limit.`,
    );
  }

  const mimeType = String(input.mimeType || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mimeType && !ALLOWED_PDF_MIME_TYPES.has(mimeType)) {
    throw new SapDocumentFileValidationError(
      'INVALID_MIME_TYPE',
      'Only PDF content is accepted for SAP document storage.',
    );
  }

  const header = input.buffer.subarray(
    0,
    Math.min(input.buffer.length, PDF_HEADER_SEARCH_BYTES),
  );
  if (header.indexOf(PDF_HEADER) < 0) {
    throw new SapDocumentFileValidationError(
      'INVALID_PDF_HEADER',
      'The SAP document does not contain a PDF header.',
    );
  }
}

function storageDateParts(capturedAt: Date): [string, string, string] {
  if (!(capturedAt instanceof Date) || !Number.isFinite(capturedAt.getTime())) {
    throw new SapDocumentFileValidationError(
      'INVALID_CAPTURE_TIMESTAMP',
      'The SAP document capture timestamp is invalid.',
    );
  }
  const year = capturedAt.getUTCFullYear();
  if (year < 1 || year > 9999) {
    throw new SapDocumentFileValidationError(
      'INVALID_CAPTURE_TIMESTAMP',
      'The SAP document capture timestamp is outside the supported year range.',
    );
  }
  return [
    String(year).padStart(4, '0'),
    String(capturedAt.getUTCMonth() + 1).padStart(2, '0'),
    String(capturedAt.getUTCDate()).padStart(2, '0'),
  ];
}

export async function storeImmutableDocumentPdf(
  input: SapDocumentPdfInput,
  options: StoreImmutableDocumentPdfOptions,
): Promise<StoredSapDocumentPdf> {
  const namespace = validateStorageNamespace(options.namespace);
  validateSapDocumentPdf(input, options.maxBytes);
  const fileName = namespace === RXO_STORAGE_DIRECTORY
    ? sanitizeRxoDocumentFileName(input.originalName)
    : sanitizeSapDocumentFileName(input.originalName);
  const sha256 = createHash('sha256').update(input.buffer).digest('hex');

  const capturedAt = input.capturedAt ?? new Date();
  const [year, month, day] = storageDateParts(capturedAt);
  const documentUuid = (options.idFactory ?? randomUUID)();
  if (!UUID_PATTERN.test(documentUuid)) {
    throw new SapDocumentFileValidationError(
      'INVALID_DOCUMENT_UUID',
      'The generated SAP document storage ID is not a valid UUID.',
    );
  }

  const storedFileName = `${documentUuid.toLowerCase()}.pdf`;
  const relativePath = [
    namespace,
    year,
    month,
    day,
    storedFileName,
  ].join('/');

  const canonicalNamespace = await ensureImmutableDocumentStorageNamespace(
    options.storageRoot,
    namespace,
  );
  const canonicalRoot = await realpath(resolve(options.storageRoot));
  const canonicalDirectory = await ensureContainedDirectory(canonicalNamespace, [
    year,
    month,
    day,
  ]);
  const absolutePath = join(canonicalDirectory, storedFileName);
  assertContainedPath(canonicalRoot, absolutePath);
  const temporaryPath = join(
    canonicalDirectory,
    `.${storedFileName}.${randomUUID()}.tmp`,
  );
  let ownsTemporaryFile = false;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporaryPath, 'wx', FILE_MODE);
    ownsTemporaryFile = true;
    await handle.writeFile(input.buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporaryPath, FILE_MODE);
    try {
      // A hard-link publishes the fully synced same-directory temp file in one
      // atomic, no-replace operation. Unlike rename(), this cannot overwrite an
      // existing UUID path on the Linux Docker document volume.
      await link(temporaryPath, absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new SapDocumentFileValidationError(
          'STORAGE_PATH_COLLISION',
          'The generated SAP document storage path already exists.',
        );
      }
      throw error;
    }
    // Once the final hard-link exists the storage commit is complete. Cleanup
    // is best-effort so a transient unlink failure cannot make the caller omit
    // database metadata for an already-published PDF.
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    ownsTemporaryFile = false;
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    if (ownsTemporaryFile) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }

  return {
    fileName,
    storedFileName,
    relativePath,
    absolutePath,
    mimeType: 'application/pdf',
    fileSizeBytes: input.buffer.length,
    sha256,
  };
}

export function storeSapDocumentPdf(
  input: SapDocumentPdfInput,
  options: StoreSapDocumentPdfOptions,
): Promise<StoredSapDocumentPdf> {
  return storeImmutableDocumentPdf(input, {
    ...options,
    namespace: SAP_STORAGE_DIRECTORY,
  });
}

export function storeRxoDocumentPdf(
  input: SapDocumentPdfInput,
  options: StoreSapDocumentPdfOptions,
): Promise<StoredSapDocumentPdf> {
  return storeImmutableDocumentPdf(input, {
    ...options,
    namespace: RXO_STORAGE_DIRECTORY,
  });
}
