import { BadRequestException } from '@nestjs/common';

export const PACKING_SLIP_DETECTION_METHODS = [
  'PYPDF_TEXT',
  'PYMUPDF_TEXT',
  'OCR',
] as const;
export const PRINT_STATUSES = ['PENDING', 'PRINTED', 'FAILED', 'SKIPPED'] as const;

export type PackingSlipDetectionMethod = typeof PACKING_SLIP_DETECTION_METHODS[number];
export type PrintStatus = typeof PRINT_STATUSES[number];

export interface PackingSlipIngestionDto {
  sourceCaptureId: string;
  documentType: 'PACKING_SLIP';
  sapDocumentId?: string;
  detectionMethod: PackingSlipDetectionMethod;
  positiveMarkersFound: string[];
  identifierCandidates: string[];
  confidence?: number;
  route: string;
  sourceQueue: string;
  outputPrinter: string;
  capturedAt: string;
  printStatus: PrintStatus;
  printError?: string;
  clientReportedSha256?: string;
  reviewReason?: string;
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
  pattern?: RegExp,
): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new BadRequestException(`${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) {
    throw new BadRequestException(`${field} has an invalid format.`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredString(value, field, maxLength);
}

function stringArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new BadRequestException(`${field} must be an array with at most ${maxItems} items.`);
  }
  return value.map((item, index) => requiredString(item, `${field}[${index}]`, maxLength));
}

export function parsePackingSlipIngestionMetadata(raw: unknown): PackingSlipIngestionDto {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) {
      throw new BadRequestException('metadata exceeds the 64 KiB limit.');
    }
    try {
      value = JSON.parse(raw);
    } catch {
      throw new BadRequestException('metadata must be valid JSON.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('metadata must be a JSON object.');
  }
  const body = value as Record<string, unknown>;
  const allowedFields = new Set([
    'sourceCaptureId', 'documentType', 'sapDocumentId', 'detectionMethod',
    'positiveMarkersFound', 'identifierCandidates', 'confidence', 'route',
    'sourceQueue', 'outputPrinter', 'capturedAt', 'printStatus', 'printError',
    'clientReportedSha256', 'reviewReason',
  ]);
  const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknownFields.length) {
    throw new BadRequestException(`metadata contains unsupported fields: ${unknownFields.join(', ')}.`);
  }

  const documentType = requiredString(body.documentType, 'documentType', 60);
  if (documentType !== 'PACKING_SLIP') {
    throw new BadRequestException('documentType must be PACKING_SLIP for this endpoint.');
  }
  const detectionMethod = requiredString(body.detectionMethod, 'detectionMethod', 80);
  if (!(PACKING_SLIP_DETECTION_METHODS as readonly string[]).includes(detectionMethod)) {
    throw new BadRequestException(`detectionMethod must be one of ${PACKING_SLIP_DETECTION_METHODS.join(', ')}.`);
  }
  const printStatus = requiredString(body.printStatus, 'printStatus', 40);
  if (!(PRINT_STATUSES as readonly string[]).includes(printStatus)) {
    throw new BadRequestException(`printStatus must be one of ${PRINT_STATUSES.join(', ')}.`);
  }
  const printError = optionalString(body.printError, 'printError', 2000);
  if (printStatus === 'FAILED' && !printError) {
    throw new BadRequestException('printError is required when printStatus is FAILED.');
  }
  if (printStatus !== 'FAILED' && printError) {
    throw new BadRequestException('printError is only accepted when printStatus is FAILED.');
  }

  const capturedAt = requiredString(body.capturedAt, 'capturedAt', 40);
  const parsedCapturedAt = new Date(capturedAt);
  if (!Number.isFinite(parsedCapturedAt.getTime())) {
    throw new BadRequestException('capturedAt must be a valid ISO-8601 timestamp.');
  }
  if (parsedCapturedAt.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new BadRequestException('capturedAt cannot be more than five minutes in the future.');
  }

  let confidence: number | undefined;
  if (body.confidence !== undefined && body.confidence !== null) {
    if (typeof body.confidence !== 'number' || !Number.isFinite(body.confidence) || body.confidence < 0 || body.confidence > 1) {
      throw new BadRequestException('confidence must be a number from 0 through 1.');
    }
    confidence = body.confidence;
  }

  const clientReportedSha256 = optionalString(body.clientReportedSha256, 'clientReportedSha256', 64);
  if (clientReportedSha256 && !/^[0-9a-f]{64}$/.test(clientReportedSha256)) {
    throw new BadRequestException('clientReportedSha256 must be 64 lowercase hexadecimal characters.');
  }

  return {
    sourceCaptureId: requiredString(body.sourceCaptureId, 'sourceCaptureId', 120, /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/),
    documentType: 'PACKING_SLIP',
    sapDocumentId: optionalString(body.sapDocumentId, 'sapDocumentId', 100),
    detectionMethod: detectionMethod as PackingSlipDetectionMethod,
    positiveMarkersFound: stringArray(body.positiveMarkersFound, 'positiveMarkersFound', 10, 80),
    identifierCandidates: stringArray(body.identifierCandidates, 'identifierCandidates', 20, 100),
    confidence,
    route: requiredString(body.route, 'route', 120),
    sourceQueue: requiredString(body.sourceQueue, 'sourceQueue', 255),
    outputPrinter: requiredString(body.outputPrinter, 'outputPrinter', 255),
    capturedAt: parsedCapturedAt.toISOString(),
    printStatus: printStatus as PrintStatus,
    printError,
    clientReportedSha256,
    reviewReason: optionalString(body.reviewReason, 'reviewReason', 2000),
  };
}
