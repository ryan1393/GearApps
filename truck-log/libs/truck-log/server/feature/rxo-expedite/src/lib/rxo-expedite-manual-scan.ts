import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { RxoExpediteManualRunState } from '@truck-log/shared/contracts';

/** Positive allowlist for state crossing the native worker boundary. */
export function publicManualScan(value: unknown): RxoExpediteManualRunState | null {
  if (value == null) return null;
  const v = value as Record<string, unknown>;
  const date = (input: unknown) => typeof input === 'string' && Number.isFinite(Date.parse(input))
    ? new Date(input).toISOString() : null;
  const requestedAt = date(v.requestedAt);
  if (typeof v.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(v.id)
    || !['QUEUED', 'RUNNING', 'COMPLETE', 'FAILED'].includes(String(v.status)) || !requestedAt) {
    throw new ServiceUnavailableException('Expedite manual scan status requires review.');
  }
  return {
    id: v.id, status: v.status as RxoExpediteManualRunState['status'], requestedAt,
    startedAt: date(v.startedAt), completedAt: date(v.completedAt),
    error: typeof v.error === 'string' && /^[A-Z0-9_]{1,80}$/.test(v.error) ? v.error : null,
    sourceBatchId: typeof v.sourceBatchId === 'string' && /^[0-9TZ-]+[a-f0-9-]{36}$/.test(v.sourceBatchId) ? v.sourceBatchId : null,
  };
}

export function manualScanResponse(value: unknown): RxoExpediteManualRunState {
  const v = value as Record<string, unknown> | null;
  if (v?.source !== 'RXO_EXPEDITE') throw new ServiceUnavailableException('Expedite scan control returned an invalid response.');
  if (v.accepted === true) {
    const state = publicManualScan(v.manualRun);
    if (state) return state;
    throw new ServiceUnavailableException('Expedite scan control returned no request status.');
  }
  const messages: Record<string, string> = {
    SCHEDULER_BUSY: 'An Expedite scan is already running. Wait for it to finish.',
    AUTH_REVIEW: 'Expedite sign-in needs attention. Check Settings & Login or Recover connection before scanning.',
    RECOVERY_PENDING: 'Expedite connection recovery is already queued. Wait for its result.',
    COOLDOWN: 'Expedite connection recovery is cooling down. Wait before requesting another scan.',
    RETRY_LIMIT: 'Expedite recovery reached its retry limit. Review Settings & Login or wait for the limit to reset.',
    CREDENTIALS_MISSING: 'Save the Expedite sign-in details in Settings & Login first.',
    STATE_REVIEW: 'Expedite sign-in state requires review before scanning.',
    REQUEST_BUSY: 'Another Expedite scan request is being processed. Refresh its status shortly.',
  };
  const message = typeof v.errorCode === 'string' ? messages[v.errorCode] : null;
  if (message) throw new BadRequestException(message);
  throw new ServiceUnavailableException('Expedite scheduler is unavailable or stale. Check Exporter Health before scanning.');
}
