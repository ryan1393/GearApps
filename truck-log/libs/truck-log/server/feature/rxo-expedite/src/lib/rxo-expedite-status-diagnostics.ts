/** Public status metadata must never include upstream messages, URLs or source values. */
const STAGES = new Set([
  'PREPARATION', 'BROWSER_LAUNCH', 'AUTHENTICATION', 'LIST_CONTROL', 'LIST_DATA',
  'EXPORT_CONTROL', 'EXPORT_DOWNLOAD', 'DOWNLOAD_SAVE', 'WORKBOOK_VALIDATION', 'PUBLICATION',
]);
const CAUSES = new Set([
  'TIMEOUT', 'PROFILE_BUSY', 'BROWSER_CLOSED', 'BROWSER_EXECUTABLE_MISSING', 'NETWORK_ERROR',
  'DISK_FULL', 'PERMISSION_DENIED', 'FILESYSTEM_ERROR', 'DOWNLOAD_FAILED', 'VALIDATION_FAILED',
  'AUTHENTICATION_FAILED', 'UNEXPECTED',
]);

export function publicAcquisitionDiagnostic(value: unknown): { stage: string; cause: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.stage !== 'string' || !STAGES.has(record.stage)
    || typeof record.cause !== 'string' || !CAUSES.has(record.cause)) return null;
  return { stage: record.stage, cause: record.cause };
}
