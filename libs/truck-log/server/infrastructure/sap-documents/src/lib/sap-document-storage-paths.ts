import { lstat, mkdir, realpath } from 'node:fs/promises';
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

/*
 * Immutable document storage layout: namespaces, file/directory modes, name
 * patterns, the validation error, and containment-checked path resolution.
 * Shared by sap-document-file-storage.ts (store) and
 * sap-document-file-deletion.ts (descriptor-anchored cleanup).
 */

export const PDF_HEADER = Buffer.from('%PDF-', 'ascii');
export const PDF_HEADER_SEARCH_BYTES = 1024;
export const SAP_STORAGE_DIRECTORY = 'sap';
export const RXO_STORAGE_DIRECTORY = 'rxo';
export const DOCUMENT_STORAGE_DIRECTORIES = new Set([
  SAP_STORAGE_DIRECTORY,
  RXO_STORAGE_DIRECTORY,
]);
export const FILE_MODE = 0o600;
export const DIRECTORY_MODE = 0o700;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const STORAGE_YEAR_PATTERN = /^[0-9]{4}$/;
export const STORAGE_MONTH_PATTERN = /^(0[1-9]|1[0-2])$/;
export const STORAGE_DAY_PATTERN = /^(0[1-9]|[12][0-9]|3[01])$/;
export const STORED_PDF_NAME_PATTERN = new RegExp(`^${UUID_PATTERN.source.slice(1, -1)}\\.pdf$`, 'i');
export const TEMPORARY_PDF_NAME_PATTERN = new RegExp(
  `^\\.${UUID_PATTERN.source.slice(1, -1)}\\.pdf\\.${UUID_PATTERN.source.slice(1, -1)}\\.tmp$`,
  'i',
);
export const ALLOWED_PDF_MIME_TYPES = new Set([
  'application/pdf',
  'application/octet-stream',
]);


export type SapDocumentFileValidationCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_MAX_BYTES'
  | 'INVALID_MIME_TYPE'
  | 'INVALID_PDF_HEADER'
  | 'INVALID_STORAGE_PATH'
  | 'INVALID_CAPTURE_TIMESTAMP'
  | 'INVALID_DOCUMENT_UUID'
  | 'INVALID_STORAGE_NAMESPACE'
  | 'STORAGE_PATH_COLLISION';

export type ImmutableDocumentStorageNamespace = 'sap' | 'rxo';

export class SapDocumentFileValidationError extends Error {
  constructor(
    readonly code: SapDocumentFileValidationCode,
    message: string,
  ) {
    super(message);
    this.name = 'SapDocumentFileValidationError';
  }
}

export interface SapDocumentPdfInput {
  buffer: Buffer;
  originalName: string;
  mimeType?: string | null;
  capturedAt?: Date;
}

export interface StoreSapDocumentPdfOptions {
  storageRoot: string;
  maxBytes: number;
  /** Intended for deterministic tests. Production callers should omit it. */
  idFactory?: () => string;
}

export interface StoreImmutableDocumentPdfOptions
  extends StoreSapDocumentPdfOptions {
  namespace: ImmutableDocumentStorageNamespace;
}

export interface StoredSapDocumentPdf {
  fileName: string;
  storedFileName: string;
  relativePath: string;
  absolutePath: string;
  mimeType: 'application/pdf';
  fileSizeBytes: number;
  sha256: string;
}

export function assertContainedPath(root: string, candidate: string): void {
  const fromRoot = relative(root, candidate);
  if (
    !fromRoot ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new SapDocumentFileValidationError(
      'INVALID_STORAGE_PATH',
      'SAP document path must remain inside the configured document storage root.',
    );
  }
}

export async function ensureContainedDirectory(
  canonicalRoot: string,
  segments: readonly string[],
): Promise<string> {
  let currentDirectory = canonicalRoot;
  for (const segment of segments) {
    const candidateDirectory = join(currentDirectory, segment);
    assertContainedPath(canonicalRoot, candidateDirectory);
    await mkdir(candidateDirectory, { mode: DIRECTORY_MODE }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      },
    );
    const metadata = await lstat(candidateDirectory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new SapDocumentFileValidationError(
        'INVALID_STORAGE_PATH',
        'Immutable document storage directories must be physical directories.',
      );
    }
    const canonicalDirectory = await realpath(candidateDirectory);
    if (canonicalDirectory !== candidateDirectory) {
      throw new SapDocumentFileValidationError(
        'INVALID_STORAGE_PATH',
        'Immutable document storage directories may not use path aliases.',
      );
    }
    currentDirectory = canonicalDirectory;
    assertContainedPath(canonicalRoot, currentDirectory);
  }
  return currentDirectory;
}

export function validateStorageNamespace(
  namespace: string,
): ImmutableDocumentStorageNamespace {
  if (!DOCUMENT_STORAGE_DIRECTORIES.has(namespace)) {
    throw new SapDocumentFileValidationError(
      'INVALID_STORAGE_NAMESPACE',
      'Invalid immutable document storage namespace.',
    );
  }
  return namespace as ImmutableDocumentStorageNamespace;
}

export async function ensureImmutableDocumentStorageNamespace(
  storageRoot: string,
  namespace: ImmutableDocumentStorageNamespace,
): Promise<string> {
  const expectedNamespace = validateStorageNamespace(namespace);
  const configuredRoot = resolve(storageRoot);
  await mkdir(configuredRoot, { recursive: true, mode: DIRECTORY_MODE });
  const canonicalRoot = await realpath(configuredRoot);
  return ensureContainedDirectory(canonicalRoot, [expectedNamespace]);
}

export function resolveImmutableDocumentStoragePath(
  storageRoot: string,
  relativePath: string,
  namespace: ImmutableDocumentStorageNamespace,
): string {
  const expectedNamespace = validateStorageNamespace(namespace);
  const normalizedRoot = resolve(storageRoot);
  if (
    !relativePath ||
    relativePath.includes('\\') ||
    relativePath.startsWith('/') ||
    relativePath.split('/').some((part) => !part || part === '.' || part === '..') ||
    relativePath.split('/')[0] !== expectedNamespace
  ) {
    throw new SapDocumentFileValidationError(
      'INVALID_STORAGE_PATH',
      `Invalid ${expectedNamespace.toUpperCase()} document storage path.`,
    );
  }

  const absolutePath = resolve(normalizedRoot, ...relativePath.split('/'));
  assertContainedPath(normalizedRoot, absolutePath);
  return absolutePath;
}

export function resolveSapDocumentStoragePath(
  storageRoot: string,
  relativePath: string,
): string {
  return resolveImmutableDocumentStoragePath(
    storageRoot,
    relativePath,
    SAP_STORAGE_DIRECTORY,
  );
}

export function resolveRxoDocumentStoragePath(
  storageRoot: string,
  relativePath: string,
): string {
  return resolveImmutableDocumentStoragePath(
    storageRoot,
    relativePath,
    RXO_STORAGE_DIRECTORY,
  );
}
