import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { canonicalJson } from '@truck-log/server/data-access';
import type { AuthenticatedTruckLogPrincipal } from '@truck-log/server/auth/access';
import { DriverPrintService } from '@truck-log/server/domain/driver-print';
import {
  readVerifiedRxoPdf,
  type StoredSapDocumentPdf, removeIfUncommitted } from '@truck-log/server/infrastructure/sap-documents';
import { SapDocumentStorageService } from '@truck-log/server/infrastructure/sap-documents';
import { rxoShipmentLockKey } from '@truck-log/server/domain/rxo';

import { ensureRxoBrowserUploadActor, RXO_BROWSER_UPLOAD_PRINCIPAL } from './rxo-browser-upload-actor';
import { RxoDocumentOrphanReconciler } from './rxo-document-orphan-reconciler';
import { RxoDocumentOrphanSchedule } from './rxo-document-orphan-schedule';
import {
  validateRxoDriverDocumentPdf,
  type UploadedRxoDriverDocumentFile,
} from './rxo-document-pdf-validation';
import {
  IDEMPOTENCY_KEY_PATTERN,
  MATERIALS_UPLOAD_SOURCE,
  RXO_DRIVER_DOCUMENT_TYPE,
  normalizeIdentity,
  normalizedUploadMimeType,
  type CredentialRow,
} from './rxo-document.model';
import {
  advisoryLock,
  priorIdempotentResponse,
  revalidateRxoUploadCredential,
} from './rxo-document-idempotency.store';
import { RxoDocumentQueries } from './rxo-document.queries';
import { RxoDocumentUploadCommand } from './rxo-document-upload.command';

export type { UploadedRxoDriverDocumentFile } from './rxo-document-pdf-validation';

/**
 * Coordinates RXO driver-document ownership, versioning, association and audit.
 *
 * Security-sensitive byte validation is isolated in rxo-document-pdf-validation
 * and crash-window filesystem cleanup is isolated in the orphan reconciler.
 * Reads live in rxo-document.queries, the versioned write in
 * rxo-document-upload.command, and idempotency/credential helpers in
 * rxo-document-idempotency.store. Keep those concerns out of request/transaction
 * orchestration so each boundary can be reviewed and tested independently.
 */
@Injectable()
export class RxoDocumentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RxoDocumentsService.name);
  private readonly orphanSchedule: RxoDocumentOrphanSchedule;
  private readonly queries: RxoDocumentQueries;
  private readonly uploadCommand: RxoDocumentUploadCommand;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly storage: SapDocumentStorageService,
    private readonly driverPrint: DriverPrintService,
  ) {
    this.orphanSchedule = new RxoDocumentOrphanSchedule(
      new RxoDocumentOrphanReconciler(
        this.dataSource,
        this.storage,
        this.logger,
      ),
      this.logger,
    );
    this.queries = new RxoDocumentQueries(this.dataSource, this.config);
    this.uploadCommand = new RxoDocumentUploadCommand(
      this.storage,
      this.driverPrint,
      this.queries,
    );
  }

  onModuleInit(): void {
    this.orphanSchedule.start();
  }

  onModuleDestroy(): void {
    this.orphanSchedule.stop();
  }

  async status(
    siteKey: string,
    direction: string,
    shipmentId: string,
    historyBeforeVersion?: string,
    historyLimit?: string,
  ) {
    return this.queries.status(
      siteKey,
      direction,
      shipmentId,
      historyBeforeVersion,
      historyLimit,
    );
  }

  /** Same PDF/versioning/audit transaction as the authenticated integration route. */
  async uploadFromBrowser(
    idempotencyKey: string | undefined,
    siteKey: string,
    direction: string,
    shipmentId: string,
    file: UploadedRxoDriverDocumentFile | undefined,
  ) {
    return this.upload(RXO_BROWSER_UPLOAD_PRINCIPAL, idempotencyKey, siteKey, direction, shipmentId, file);
  }

  async upload(
    principal: AuthenticatedTruckLogPrincipal,
    idempotencyKey: string | undefined,
    siteKey: string,
    direction: string,
    shipmentId: string,
    file: UploadedRxoDriverDocumentFile | undefined,
  ) {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException(
        'X-Idempotency-Key is required and must be 16-128 safe characters.',
      );
    }
    const identity = normalizeIdentity(siteKey, direction, shipmentId);
    const pdfSha256 = this.validatePdf(file);
    const requestSha256 = createHash('sha256')
      .update(canonicalJson({
        endpoint: 'rxo-driver-document-upload-v1',
        identity,
        keyId: principal.keyId,
        originalName: file!.originalname,
        mimeType: normalizedUploadMimeType(file!.mimetype),
        pdfSha256,
      }))
      .digest('hex');
    const now = new Date();
    const staged: { stored: StoredSapDocumentPdf | null } = { stored: null };

    try {
      const response = await this.dataSource.transaction(async (manager) => {
        await this.advisoryLock(manager, rxoShipmentLockKey(identity));
        await this.advisoryLock(
          manager,
          `truck-log:access-idempotency:${principal.keyId}:${idempotencyKey}`,
        );

        const actor = principal === RXO_BROWSER_UPLOAD_PRINCIPAL
          ? await ensureRxoBrowserUploadActor(manager)
          : await this.revalidateCredential(manager, principal.keyId);
        const prior = await this.priorIdempotentResponse(
          manager,
          actor.key_id,
          idempotencyKey,
          requestSha256,
        );
        if (prior) return prior;

        return this.uploadCommand.storeNewVersion(
          manager,
          { identity, file, pdfSha256, actor, idempotencyKey, requestSha256, now },
          staged,
        );
      });
      return response;
    } catch (error) {
      if (staged.stored) {
        // A lost connection during COMMIT has an uncertain outcome; removeIfUncommitted keeps the file unless proven unreferenced.
        const file = staged.stored;
        await removeIfUncommitted(this.dataSource, file.relativePath, () => this.storage.deleteRxoPdf(file.relativePath), this.logger);
      }
      throw error;
    }
  }

  async download(documentIdValue: string) {
    if (!/^[1-9][0-9]*$/.test(String(documentIdValue || ''))) {
      throw new BadRequestException('documentId must be a positive integer.');
    }
    const documentId = Number(documentIdValue);
    if (!Number.isSafeInteger(documentId)) {
      throw new BadRequestException('documentId must be a positive integer.');
    }

    const rows = await this.dataSource.query(
      `SELECT id, file_name, relative_path, file_size_bytes, sha256
         FROM visit_documents
        WHERE id = $1
          AND document_type = $2
          AND source_kind = $3
          AND storage_status = 'STORED'`,
      [documentId, RXO_DRIVER_DOCUMENT_TYPE, MATERIALS_UPLOAD_SOURCE],
    ) as Array<{
      id: number | string;
      file_name: string;
      relative_path: string;
      file_size_bytes: number | string;
      sha256: string;
    }>;
    const document = rows[0];
    if (!document) throw new NotFoundException('RXO driver document not found.');

    try {
      const expectedSize = Number(document.file_size_bytes);
      if (!Number.isSafeInteger(expectedSize)) {
        throw new Error('Stored RXO PDF size does not match immutable metadata.');
      }
      // Confined, no-follow, descriptor-anchored read with size and SHA-256 checks.
      const { buffer } = await readVerifiedRxoPdf(
        this.storage,
        document.relative_path,
        expectedSize,
        document.sha256,
      );
      return {
        buffer,
        fileName: document.file_name,
        fileSizeBytes: expectedSize,
      };
    } catch (error) {
      this.logger.error(
        `Stored RXO PDF ${documentId} is unavailable or failed integrity checks.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ConflictException(
        'The stored RXO driver document is unavailable or failed integrity checks.',
      );
    }
  }

  private validatePdf(
    file: UploadedRxoDriverDocumentFile | undefined,
  ): string {
    return validateRxoDriverDocumentPdf(file, this.storage.maxBytes());
  }

  private async advisoryLock(manager: EntityManager, key: string): Promise<void> {
    await advisoryLock(manager, key);
  }

  private async revalidateCredential(
    manager: EntityManager,
    keyId: string,
  ): Promise<CredentialRow> {
    return revalidateRxoUploadCredential(manager, keyId);
  }

  private async priorIdempotentResponse(
    manager: EntityManager,
    keyId: string,
    idempotencyKey: string,
    requestSha256: string,
  ): Promise<Record<string, unknown> | null> {
    return priorIdempotentResponse(manager, keyId, idempotencyKey, requestSha256);
  }
}
