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
