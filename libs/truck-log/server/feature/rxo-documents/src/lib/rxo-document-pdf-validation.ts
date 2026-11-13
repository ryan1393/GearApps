import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

/** Hard safety ceiling shared by HTTP upload limits and service validation. */
export const MAX_RXO_PDF_BYTES = 25 * 1024 * 1024;

export interface UploadedRxoDriverDocumentFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size?: number;
}

const PDF_HEADER = Buffer.from('%PDF-', 'ascii');
const PDF_EOF = Buffer.from('%%EOF', 'ascii');
const ACCEPTED_PDF_MIME_TYPES = new Set([
  'application/pdf',
  'application/octet-stream',
]);

// Defense-in-depth only. Truck Log does not need active PDF features, so reject
// them lexically before storage. This is intentionally not presented as a
// replacement for malware scanning or a sandboxed PDF parser.
const ACTIVE_PDF_TOKEN_PATTERN =
  /\/(?:Encrypt|JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|OpenAction|AA|ObjStm|AcroForm|XFA|RichMedia|SubmitForm|ImportData)\b/;

function normalizeMimeType(value: string | undefined): string {
  return String(value || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function trailingPdfWhitespace(byte: number): boolean {
  return byte === 0x00
    || byte === 0x09
    || byte === 0x0a
    || byte === 0x0c
    || byte === 0x0d
    || byte === 0x20;
}

function hasTerminalPdfEof(buffer: Buffer): boolean {
  let finalByte = buffer.length - 1;
  while (finalByte >= 0 && trailingPdfWhitespace(buffer[finalByte])) finalByte -= 1;
  if (finalByte + 1 < PDF_EOF.length) return false;
  return buffer
    .subarray(finalByte + 1 - PDF_EOF.length, finalByte + 1)
    .equals(PDF_EOF);
}

function decodePdfNameEscapes(content: string): string {
  return content.replace(/#([0-9a-f]{2})/gi, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function terminalStartXref(buffer: Buffer): number | null {
  const tailStart = Math.max(0, buffer.length - 64 * 1024);
  const tail = buffer.subarray(tailStart).toString('latin1');
  const match = /startxref[\x00\x09\x0a\x0c\x0d\x20]+([0-9]+)[\x00\x09\x0a\x0c\x0d\x20]+%%EOF[\x00\x09\x0a\x0c\x0d\x20]*$/.exec(tail);
  if (!match) return null;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) && offset >= 0 && offset < buffer.length
    ? offset
    : null;
}

function hasPlausibleXrefTarget(buffer: Buffer, offset: number): boolean {
  const rawTarget = buffer
    .subarray(offset, Math.min(buffer.length, offset + 8192))
    .toString('latin1');
  if (/^xref\b/.test(rawTarget)) return true;
  const decodedTarget = decodePdfNameEscapes(rawTarget);
  return /^[0-9]+[\x00\x09\x0a\x0c\x0d\x20]+[0-9]+[\x00\x09\x0a\x0c\x0d\x20]+obj\b[\s\S]{0,4096}\/Type[\x00\x09\x0a\x0c\x0d\x20]*\/XRef\b/.test(
    decodedTarget,
  );
}

/**
 * Validate an RXO driver-document PDF before immutable storage.
 *
 * The caller supplies the storage-configured limit so the effective limit is
 * always the stricter of the deployment setting and Truck Log's 25 MiB ceiling.
 * A SHA-256 digest is returned for idempotency and later integrity checks.
 */
export function validateRxoDriverDocumentPdf(
  file: UploadedRxoDriverDocumentFile | undefined,
  configuredMaxBytes: number,
): string {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new BadRequestException(
      'One non-empty PDF file is required in the file field.',
    );
  }
  if (
    !file.originalname
    || file.originalname.length > 255
    || /[\u0000-\u001f\u007f]/.test(file.originalname)
  ) {
    throw new BadRequestException(
      'The original PDF filename is required and must be at most 255 safe characters.',
    );
  }

  const maxBytes = Math.min(configuredMaxBytes, MAX_RXO_PDF_BYTES);
  if (file.buffer.length > maxBytes) {
    throw new PayloadTooLargeException(
      `The RXO driver document exceeds the configured ${maxBytes}-byte limit.`,
    );
  }
  if (file.size !== undefined && file.size !== file.buffer.length) {
    throw new UnprocessableEntityException(
      'The uploaded file size does not match the received PDF content.',
    );
  }

  const mimeType = normalizeMimeType(file.mimetype);
  if (mimeType && !ACCEPTED_PDF_MIME_TYPES.has(mimeType)) {
    throw new UnsupportedMediaTypeException(
      'Only PDF content is accepted for RXO driver documents.',
    );
  }
  if (
    file.buffer.length < PDF_HEADER.length
    || !file.buffer.subarray(0, PDF_HEADER.length).equals(PDF_HEADER)
  ) {
    throw new UnprocessableEntityException(
      'The uploaded file must begin with a PDF header at byte zero.',
    );
  }
  if (!hasTerminalPdfEof(file.buffer)) {
    throw new UnprocessableEntityException(
      'The uploaded file must end with a terminal PDF end-of-file marker.',
    );
  }

  const startXref = terminalStartXref(file.buffer);
  if (startXref === null || !hasPlausibleXrefTarget(file.buffer, startXref)) {
    throw new UnprocessableEntityException(
      'The uploaded file does not contain a valid terminal PDF cross-reference target.',
    );
  }

  const decodedPdfNames = decodePdfNameEscapes(file.buffer.toString('latin1'));
  if (ACTIVE_PDF_TOKEN_PATTERN.test(decodedPdfNames)) {
    throw new UnprocessableEntityException(
      'Encrypted PDFs and PDFs containing active or embedded content are not accepted.',
    );
  }

  return createHash('sha256').update(file.buffer).digest('hex');
}
