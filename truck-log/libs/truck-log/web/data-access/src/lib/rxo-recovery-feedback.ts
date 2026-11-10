import type { RxoConnectionRecoveryInfo } from '@truck-log/shared/contracts';

/** Never echo server exceptions, raw navigation URLs or credential text into recovery feedback. */
export function rxoRecoveryErrorMessage(error: unknown): string {
  const response = error as { status?: number; error?: { requiresCredentials?: boolean; requiresInteractiveLogin?: boolean } } | null;
  if (response?.error?.requiresCredentials) return 'The saved RXO login needs attention. Update this exporter’s credentials under Settings & Login, then try again.';
  if (response?.error?.requiresInteractiveLogin) return 'RXO requires approval or an interactive sign-in. Complete it with your administrator before recovering again.';
  if (response?.status === 401) return 'Your administrator session ended. Sign in again before requesting recovery.';
  if (response?.status === 403) return 'Administrator access at this address is required to recover this connection.';
  if (response?.status === 429) return 'Recovery requests are limited. Wait for the current attempt and refresh status.';
  if (response?.status === 409) return 'Recovery is currently blocked. Check the recovery status and Settings & Login before trying again.';
  if (response?.status === 503) return 'The exporter cannot be reached for recovery. Refresh status and check the service connection.';
  return 'Recovery was not confirmed. Refresh status before retrying.';
}

/** Both limits publish an expiry, but only COOLDOWN is the short delivery wait. */
export function rxoRecoveryWaitFeedback(info: RxoConnectionRecoveryInfo | undefined, now: number) {
  const until = Date.parse(info?.cooldownUntil || '');
  if (!Number.isFinite(until) || until <= now) return null;
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remaining = `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  const resumeLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Indiana/Indianapolis', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  }).format(new Date(until));
  return {
    title: info?.reason === 'RETRY_LIMIT' ? 'Hourly connection recovery limit reached.'
      : info?.reason === 'COOLDOWN' ? 'One-minute connection recovery cooldown.' : 'Connection recovery waiting period.',
    detail: info?.reason === 'RETRY_LIMIT' ? 'The hourly limit applies to manual connection resets. Another request becomes available at'
      : 'Another connection recovery request becomes available at',
    until: new Date(until).toISOString(), resumeLabel, remaining,
  };
}
