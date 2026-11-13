import { createHmac, randomBytes } from 'node:crypto';

/**
 * A 32-byte HMAC key for short-lived workflow tokens (checkout print proof,
 * dock scan preview). Derived from the setup-generated
 * TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET with a per-purpose label, so tokens
 * survive an API restart and are valid across replicas. These tokens bind a
 * browser workflow to one visit/document revision; they are not authentication.
 * Without a configured secret (development) a random per-process key is used.
 */
export function workflowSigningKey(label: string, env: Record<string, string | undefined> = process.env): Buffer {
  const secret = (env.TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return createHmac('sha256', Buffer.from(secret, 'hex')).update(`truck-log-workflow-key\n${label}`).digest();
  }
  return randomBytes(32);
}
