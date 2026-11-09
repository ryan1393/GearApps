import { Logger } from '@nestjs/common';
import { constants as fsConstants, type Dirent } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { SapDocumentStorageService } from '@truck-log/server/infrastructure/sap-documents';

const ORPHAN_RECONCILIATION_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_ORPHAN_SCAN_FILES = 10_000;
const ORPHAN_RECONCILIATION_CURSOR_KEY = 'rxo_orphan_reconciliation_cursor';
const ORPHAN_RECONCILIATION_LOCK_KEY = 'truck-log:rxo-orphan-reconciliation:v1';
const STORED_PDF_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/;
const TEMPORARY_PDF_NAME_PATTERN =
  /^\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;

interface OrphanStorageCandidate {
  relativePath: string;
  mtimeMs: number;
  temporary: boolean;
}

/**
 * Reconciles the narrow crash window where an immutable RXO PDF can reach disk
 * before its database row commits.
 *
 * Safety rules live here rather than in the request service because cleanup has
 * a different trust boundary: one process owns the advisory lock, only files
 * older than the 24-hour grace are considered, database references win, and
 * all directory traversal is descriptor-anchored with O_NOFOLLOW.
 */
export class RxoDocumentOrphanReconciler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: SapDocumentStorageService,
    private readonly logger: Logger,
  ) {}

  async reconcile(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    let lockHeld = false;
    let removedFiles = 0;
    let removedTemporaryFiles = 0;
    await queryRunner.connect();
    try {
      const lockRows = await queryRunner.query(
        `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
        [ORPHAN_RECONCILIATION_LOCK_KEY],
      ) as Array<{ locked: boolean }>;
      if (lockRows[0]?.locked !== true) return;
      lockHeld = true;

      const cursorRows = await queryRunner.query(
        `SELECT value
           FROM app_settings
          WHERE key = $1
          LIMIT 1`,
        [ORPHAN_RECONCILIATION_CURSOR_KEY],
      ) as Array<{ value: string | null }>;
      const cursor = this.validCursor(cursorRows[0]?.value);
      const namespaceRoot = await this.storage.ensureRxoNamespace();
      const page = await this.candidatePage(namespaceRoot, cursor);
      const cutoff = Date.now() - ORPHAN_RECONCILIATION_GRACE_MS;
      const storedCandidates = page.candidates.filter(
        (candidate) => !candidate.temporary && candidate.mtimeMs <= cutoff,
      );
      const referencedPaths = new Set<string>();
      if (storedCandidates.length > 0) {
        const referenceRows = await queryRunner.query(
          `SELECT relative_path
             FROM visit_documents
            WHERE relative_path = ANY($1::text[])`,
          [storedCandidates.map((candidate) => candidate.relativePath)],
        ) as Array<{ relative_path: string }>;
        for (const row of referenceRows) referencedPaths.add(row.relative_path);
      }

      for (const candidate of page.candidates) {
        if (candidate.mtimeMs > cutoff) continue;
        try {
          if (candidate.temporary) {
            await this.storage.deleteRxoTemporaryPdf(candidate.relativePath);
            removedTemporaryFiles += 1;
          } else if (!referencedPaths.has(candidate.relativePath)) {
            await this.storage.deleteRxoPdf(candidate.relativePath);
            removedFiles += 1;
          }
        } catch (error) {
          // Keep uncertain files. The persisted cursor still advances so one
          // problematic entry cannot starve every later orphan indefinitely.
          this.logger.warn(
            `RXO orphan reconciliation retained ${candidate.relativePath}: ${
              error instanceof Error ? error.message : 'cleanup failed safely'
            }`,
          );
        }
      }

      const nextCursor = page.hasMore && page.candidates.length > 0
        ? page.candidates[page.candidates.length - 1].relativePath
        : null;
      await queryRunner.query(
        `INSERT INTO app_settings(key, value, description, updated_at)
         VALUES($1, $2, 'Persistent keyset cursor for fair RXO orphan-document reconciliation', NOW())
         ON CONFLICT(key) DO UPDATE
           SET value = EXCLUDED.value,
               description = EXCLUDED.description,
               updated_at = NOW()`,
        [ORPHAN_RECONCILIATION_CURSOR_KEY, nextCursor],
      );

      if (page.hasMore) {
        this.logger.log(
          `RXO orphan reconciliation processed ${MAX_ORPHAN_SCAN_FILES} candidates and persisted its continuation cursor.`,
        );
      }
      if (removedFiles > 0) {
        this.logger.log(
          `Removed ${removedFiles} unreferenced RXO PDF${removedFiles === 1 ? '' : 's'} after the 24-hour safety grace.`,
        );
      }
      if (removedTemporaryFiles > 0) {
        this.logger.log(
          `Removed ${removedTemporaryFiles} stale RXO temporary file${removedTemporaryFiles === 1 ? '' : 's'} after the 24-hour safety grace.`,
        );
      }
    } finally {
      if (lockHeld) {
        await queryRunner.query(
          `SELECT pg_advisory_unlock(hashtextextended($1, 0))`,
          [ORPHAN_RECONCILIATION_LOCK_KEY],
        ).catch((error: unknown) => {
          this.logger.error(
            'RXO orphan reconciliation advisory lock release failed; the dedicated connection will be released.',
            error instanceof Error ? error.stack : undefined,
          );
        });
      }
      await queryRunner.release();
    }
  }

  private validCursor(value: string | null | undefined): string | null {
    const cursor = String(value || '');
    return /^rxo\/[0-9]{4}\/(0[1-9]|1[0-2])\/(0[1-9]|[12][0-9]|3[01])\/(?:[0-9a-f-]{36}\.pdf|\.[0-9a-f-]{36}\.pdf\.[0-9a-f-]{36}\.tmp)$/.test(cursor)
      ? cursor
      : null;
  }

  private async candidatePage(
    namespaceRoot: string,
    cursor: string | null,
  ): Promise<{ candidates: OrphanStorageCandidate[]; hasMore: boolean }> {
    const candidates: OrphanStorageCandidate[] = [];
    let hasMore = false;
    const years = await this.safeDirectoryEntries(namespaceRoot);

    scan: for (const year of years) {
      if (!year.isDirectory() || !/^[0-9]{4}$/.test(year.name)) continue;
      const yearPath = join(namespaceRoot, year.name);
      const months = await this.safeDirectoryEntries(yearPath);
      for (const month of months) {
        if (!month.isDirectory() || !/^(0[1-9]|1[0-2])$/.test(month.name)) continue;
        const monthPath = join(yearPath, month.name);
        const days = await this.safeDirectoryEntries(monthPath);
        for (const day of days) {
          if (!day.isDirectory() || !/^(0[1-9]|[12][0-9]|3[01])$/.test(day.name)) continue;
          const dayPath = join(monthPath, day.name);
          const files = await this.safeDocumentEntries(dayPath);
          for (const file of files) {
            const relativePath = ['rxo', year.name, month.name, day.name, file.name].join('/');
            if (cursor && relativePath <= cursor) continue;
            if (candidates.length >= MAX_ORPHAN_SCAN_FILES) {
              hasMore = true;
              break scan;
            }
            candidates.push({
              relativePath,
              mtimeMs: file.mtimeMs,
              temporary: file.temporary,
            });
          }
        }
      }
    }

    return { candidates, hasMore };
  }

  private async safeDirectoryEntries(directory: string): Promise<Dirent[]> {
    return this.withCanonicalDirectory(directory, async (descriptorPath) => {
      const entries = await readdir(descriptorPath, { withFileTypes: true });
      return entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    }, []);
  }

  private async safeDocumentEntries(
    directory: string,
  ): Promise<Array<{ name: string; mtimeMs: number; temporary: boolean }>> {
    return this.withCanonicalDirectory(directory, async (descriptorPath) => {
      const entries = await readdir(descriptorPath, { withFileTypes: true });
      const candidates: Array<{ name: string; mtimeMs: number; temporary: boolean }> = [];
      for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
        const stored = STORED_PDF_NAME_PATTERN.test(entry.name);
        const temporary = TEMPORARY_PDF_NAME_PATTERN.test(entry.name);
        if (!stored && !temporary) continue;
        try {
          const metadata = await lstat(join(descriptorPath, entry.name));
          if (!metadata.isSymbolicLink() && metadata.isFile()) {
            candidates.push({ name: entry.name, mtimeMs: metadata.mtimeMs, temporary });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      return candidates;
    }, []);
  }

  private async withCanonicalDirectory<T>(
    directory: string,
    read: (descriptorPath: string) => Promise<T>,
    missingValue: T,
  ): Promise<T> {
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(
        directory,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
      );
      const metadata = await handle.stat();
      const descriptorPath = `/proc/self/fd/${handle.fd}`;
      const openedPath = await realpath(descriptorPath);
      if (!metadata.isDirectory() || openedPath !== directory) {
        this.logger.warn(`RXO orphan reconciliation skipped non-canonical directory ${directory}.`);
        return missingValue;
      }
      return await read(descriptorPath);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code || '')) {
        return missingValue;
      }
      throw error;
    } finally {
      if (handle) await handle.close().catch(() => undefined);
    }
  }
}
