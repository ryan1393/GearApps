import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { basename, extname, resolve, sep } from 'node:path';
import type { VisitDocument } from '@truck-log/server/data-access';

/** Legacy per-visit document folders under TRUCK_LOG_DOCUMENT_STORAGE_ROOT. */
export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'image/bmp',
]);
export const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
    '.pdf',
    '.jpg',
    '.jpeg',
    '.png',
    '.tif',
    '.tiff',
    '.bmp',
]);

/** Path resolution and naming for legacy visit paperwork. A plain class (not a Nest provider). */
export class VisitDocumentFileStorage {
    constructor(private readonly config: ConfigService) { }
    packingSlipFileAvailable(document: VisitDocument | null): boolean {
        if (!document || document.storageStatus !== 'STORED' || document.retentionStatus === 'PURGED') return false;
        try { return statSync(this.resolveStoragePath(document.relativePath)).isFile(); }
        catch { return false; }
    }
    storageRoot() {
        return resolve(this.config.get<string>('TRUCK_LOG_DOCUMENT_STORAGE_ROOT') || './data/documents');
    }
    resolveStoragePath(relativePath: string) {
        const root = this.storageRoot();
        const absolute = resolve(root, ...relativePath.split('/'));
        if (!absolute.startsWith(root + sep) && absolute !== root) {
            throw new BadRequestException('Invalid document storage path.');
        }
        return absolute;
    }
    ensureVisitFolder(folderKey: string) {
        const folder = this.resolveStoragePath(folderKey);
        mkdirSync(folder, { recursive: true });
        return folder;
    }
    sanitizeDocumentFileName(originalName: string) {
        const cleaned = basename(originalName)
            .replace(/[^\w.\- ()]/g, '_')
            .trim() || 'paperwork';
        const extension = extname(cleaned).toLowerCase();
        if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
            throw new BadRequestException('Unsupported paperwork file extension.');
        }
        const rawStem = cleaned.slice(0, Math.max(0, cleaned.length - extension.length)).trim() || 'paperwork';
        const maxOriginalStemLength = Math.max(1, 255 - extension.length);
        const originalStem = rawStem.slice(0, maxOriginalStemLength);
        const fileName = `${originalStem}${extension}`;
        const prefix = `${Date.now()}_${randomBytes(3).toString('hex')}_`;
        const maxStoredStemLength = Math.max(1, 255 - prefix.length - extension.length);
        const storedStem = originalStem.slice(0, maxStoredStemLength);
        const storedFileName = `${prefix}${storedStem}${extension}`;
        return { fileName, storedFileName };
    }
    packingSlipStoredName(documentId: string | null) {
        const stem = documentId || 'packing-slip-review';
        return `${stem}_${Date.now()}_${randomBytes(3).toString('hex')}.pdf`;
    }
}
