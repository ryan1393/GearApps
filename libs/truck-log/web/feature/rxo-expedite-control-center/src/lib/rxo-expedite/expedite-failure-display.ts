import type { ExpediteAcquisitionCause, ExpediteAcquisitionDiagnostic, ExpediteAcquisitionStage } from '@truck-log/shared/contracts';

const stages: Record<ExpediteAcquisitionStage, string> = {
  PREPARATION: 'Preparing the export', BROWSER_LAUNCH: 'Starting the browser', AUTHENTICATION: 'Signing in',
  LIST_CONTROL: 'Opening Freight on the Move', LIST_DATA: 'Reading freight rows',
  EXPORT_CONTROL: 'Finding the Excel export', EXPORT_DOWNLOAD: 'Waiting for the Excel download',
  DOWNLOAD_SAVE: 'Saving the downloaded workbook', WORKBOOK_VALIDATION: 'Validating the workbook',
  PUBLICATION: 'Publishing the verified batch',
};
const causes: Record<ExpediteAcquisitionCause, string> = {
  TIMEOUT: 'Timed out', PROFILE_BUSY: 'Browser profile is in use', BROWSER_CLOSED: 'Browser closed unexpectedly',
  BROWSER_EXECUTABLE_MISSING: 'Browser executable is unavailable', NETWORK_ERROR: 'Network request failed',
  DISK_FULL: 'Storage is full', PERMISSION_DENIED: 'Storage permission denied', FILESYSTEM_ERROR: 'Storage operation failed',
  DOWNLOAD_FAILED: 'Download failed', VALIDATION_FAILED: 'Workbook verification failed',
  AUTHENTICATION_FAILED: 'Sign-in failed', UNEXPECTED: 'Unexpected acquisition failure',
};
/** Fixed labels only: never print an upstream URL, exception message, or unknown enum. */
export function expediteFailureDetail(diagnostic: ExpediteAcquisitionDiagnostic | undefined): string {
  if (!diagnostic || !Object.hasOwn(stages, diagnostic.stage) || !Object.hasOwn(causes, diagnostic.cause)) {
    return 'This attempt did not record a detailed stage and cause. Review Exporter Health; a later scan will record the new diagnostics.';
  }
  return `${stages[diagnostic.stage]} — ${causes[diagnostic.cause]}.`;
}

export function expediteFailureTime(completedAt: string | null | undefined, schedulerFailureAt: string | null | undefined): string | null {
  const times = [completedAt, schedulerFailureAt].map(value => Date.parse(value || '')).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}
