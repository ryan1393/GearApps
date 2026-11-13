import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import {
  deleteStoredRxoTemporaryPdf,
  deleteStoredRxoDocumentPdf,
  deleteStoredSapDocumentPdf,
  ensureImmutableDocumentStorageNamespace,
  resolveRxoDocumentStoragePath,
  resolveSapDocumentStoragePath,
  storeRxoDocumentPdf,
  storeSapDocumentPdf,
} from './sap-document-file-storage';
import type {
  SapDocumentPdfInput,
  StoredSapDocumentPdf,
} from './sap-document-file-storage';

const DEFAULT_MAX_DOCUMENT_MB = 25;

@Injectable()
export class SapDocumentStorageService {
  constructor(private readonly config: ConfigService) {}

  storageRoot(): string {
    return resolve(
      this.config.get<string>('TRUCK_LOG_DOCUMENT_STORAGE_ROOT') ||
        './data/documents',
    );
  }

  maxBytes(): number {
    const configuredMb = Number(
      this.config.get('TRUCK_LOG_MAX_DOCUMENT_MB', DEFAULT_MAX_DOCUMENT_MB),
    );
    const safeMb =
      Number.isFinite(configuredMb) && configuredMb > 0
        ? configuredMb
        : DEFAULT_MAX_DOCUMENT_MB;
    return Math.max(1, Math.floor(safeMb * 1024 * 1024));
  }

  storePdf(input: SapDocumentPdfInput): Promise<StoredSapDocumentPdf> {
    return storeSapDocumentPdf(input, {
      storageRoot: this.storageRoot(),
      maxBytes: this.maxBytes(),
    });
  }

  /**
   * Store a Materials-uploaded RXO PDF in the same immutable document volume,
   * but under a distinct namespace. Existing SAP callers continue to use
   * storePdf() and cannot select an arbitrary storage directory.
   */
  storeRxoPdf(input: SapDocumentPdfInput): Promise<StoredSapDocumentPdf> {
    return storeRxoDocumentPdf(input, {
      storageRoot: this.storageRoot(),
      maxBytes: this.maxBytes(),
    });
  }

  resolvePath(relativePath: string): string {
    return resolveSapDocumentStoragePath(this.storageRoot(), relativePath);
  }

  resolveRxoPath(relativePath: string): string {
    return resolveRxoDocumentStoragePath(this.storageRoot(), relativePath);
  }

  deletePdf(relativePath: string): Promise<void> {
    return deleteStoredSapDocumentPdf(this.storageRoot(), relativePath);
  }

  deleteRxoPdf(relativePath: string): Promise<void> {
    return deleteStoredRxoDocumentPdf(this.storageRoot(), relativePath);
  }

  deleteRxoTemporaryPdf(relativePath: string): Promise<void> {
    return deleteStoredRxoTemporaryPdf(this.storageRoot(), relativePath);
  }

  ensureRxoNamespace(): Promise<string> {
    return ensureImmutableDocumentStorageNamespace(this.storageRoot(), 'rxo');
  }
}
