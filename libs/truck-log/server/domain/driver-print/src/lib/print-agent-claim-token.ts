import { createHmac } from 'node:crypto';

const CLAIM_TOKEN_SECRET_PATTERN = /^[0-9a-fA-F]{64}$/;

export interface PrintAgentClaimLeaseContext {
  agentId: string;
  idempotencyKey: string;
  requestSha256: string;
  job: {
    itemId: string;
    packageId: string;
    attemptNumber: number;
    route: string;
    printer: string;
    fileSizeBytes: number;
    sha256: string;
    leaseExpiresAt: string;
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function normalizePrintAgentClaimTokenSecret(secretHex: string): string {
  if (!CLAIM_TOKEN_SECRET_PATTERN.test(secretHex)) {
    throw new TypeError(
      'Print Agent claim-token secret must contain exactly 64 hexadecimal characters.',
    );
  }
  return secretHex.toLowerCase();
}

export function derivePrintAgentClaimToken(
  secretHex: string,
  context: PrintAgentClaimLeaseContext,
): string {
  const key = Buffer.from(normalizePrintAgentClaimTokenSecret(secretHex), 'hex');
  try {
    return createHmac('sha256', key)
      .update(
        canonicalJson({
          purpose: 'TRUCK_LOG_PRINT_JOB_CLAIM_V1',
          agentId: context.agentId,
          idempotencyKey: context.idempotencyKey,
          requestSha256: context.requestSha256,
          itemId: context.job.itemId,
          packageId: context.job.packageId,
          attemptNumber: context.job.attemptNumber,
          route: context.job.route,
          printer: context.job.printer,
          fileSizeBytes: context.job.fileSizeBytes,
          sha256: context.job.sha256,
          leaseExpiresAt: context.job.leaseExpiresAt,
        }),
      )
      .digest('hex');
  } finally {
    key.fill(0);
  }
}

export function redactPrintAgentClaimResponseForPersistence<
  TJob extends object,
>(response: { job: (TJob & { claimToken: string }) | null }): { job: TJob | null } {
  if (!response.job) return { job: null };
  const { claimToken: _discardedClaimToken, ...persistedJob } = response.job;
  return { job: persistedJob as TJob };
}
