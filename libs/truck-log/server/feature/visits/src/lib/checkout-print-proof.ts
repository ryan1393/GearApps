/** short-lived, server-issued acknowledgement that the
 * attached packing-slip PDF was fetched for the active checkout visit.
 * This is NOT a guarantee of physical printing, and not an authentication
 * control. The key comes from workflowSigningKey() so tokens survive restarts.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface CheckoutPrintDocument {
  id: number;
  truckVisitId: number | null;
  sha256: string | null;
  updatedAt: Date;
}

export const CHECKOUT_PRINT_PROOF_MAX_AGE_MS = 10 * 60 * 1000;
const TOKEN_PATTERN = /^tlcp1\.([A-Za-z0-9_-]{12,512})\.([0-9a-f]{64})$/;

function version(document: CheckoutPrintDocument): string {
  return `${document.updatedAt.getTime()}:${document.sha256 ?? '-'}`;
}

/** A compact signed proof is sufficient; no schema changes or shared browser secrets. */
export class CheckoutPrintProof {
  private readonly secret: Buffer;

  constructor(secret: Buffer = randomBytes(32)) {
    if (!Buffer.isBuffer(secret) || secret.length !== 32) throw new Error('Invalid checkout proof signing key.');
    this.secret = Buffer.from(secret);
  }

  issue(document: CheckoutPrintDocument, now = Date.now()): string {
    if (!Number.isSafeInteger(document.id) || document.id <= 0
      || !Number.isSafeInteger(document.truckVisitId) || Number(document.truckVisitId) <= 0
      || !Number.isSafeInteger(now) || now < 0
      || !Number.isFinite(document.updatedAt.getTime())) {
      throw new Error('Cannot issue a checkout proof for an invalid document.');
    }
    const payload = JSON.stringify([document.truckVisitId, document.id, now, version(document)]);
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.secret).update(encoded).digest('hex');
    return `tlcp1.${encoded}.${signature}`;
  }

  verify(proof: unknown, document: CheckoutPrintDocument, now = Date.now()): boolean {
    if (typeof proof !== 'string' || proof.length > 640 || !Number.isSafeInteger(now)) return false;
    const match = TOKEN_PATTERN.exec(proof);
    if (!match) return false;
    const [, encoded, signature] = match;
    const expected = createHmac('sha256', this.secret).update(encoded).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return false;
    let claims: unknown;
    try { claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
    catch { return false; }
    if (!Array.isArray(claims) || claims.length !== 4) return false;
    const [visitId, documentId, issuedAt, boundVersion] = claims;
    if (typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) || issuedAt > now + 15_000
      || now - issuedAt > CHECKOUT_PRINT_PROOF_MAX_AGE_MS) return false;
    return visitId === document.truckVisitId && documentId === document.id
      && boundVersion === version(document);
  }
}
