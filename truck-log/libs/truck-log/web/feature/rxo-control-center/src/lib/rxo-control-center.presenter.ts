import type {
  RxoControlStatusData,
  RxoFreightRecord,
  RxoImportStatusData,
  RxoOrderRecord,
  RxoShipmentRecord,
} from '@truck-log/shared/contracts';

type ShipmentLike = RxoShipmentRecord | RxoFreightRecord;
type RxoRow = RxoOrderRecord | RxoShipmentRecord | RxoFreightRecord;

export function rxoDirectionalRouteLabel(direction: string | null | undefined): string {
  const value = String(direction ?? '').trim().toUpperCase();
  return value === 'OUTBOUND' ? 'To' : value === 'INBOUND' ? 'From' : 'Route';
}

export function rxoDirectionalRouteValue(
  direction: string | null | undefined,
  origin: string | null | undefined,
  destination: string | null | undefined,
): string {
  const value = String(direction ?? '').trim().toUpperCase();
  const from = String(origin ?? '').trim() || '-';
  const to = String(destination ?? '').trim() || '-';
  if (value === 'OUTBOUND') return to;
  if (value === 'INBOUND') return from;
  return `${from} → ${to}`;
}

export function statusTone(value?: string | null): 'neutral' | 'warning' | 'good' | 'info' | 'planned' {
  const status = String(value ?? '').trim().toLowerCase();
  if (!status) return 'neutral';
  if (/risk|late|past due|delayed|exception|watch/.test(status)) return 'warning';
  if (/tender accepted|accepted|on time|ready/.test(status)) return 'good';
  if (/in transit|transit|moving|departed|arrived/.test(status)) return 'info';
  if (/planned|planning|scheduled|booked/.test(status)) return 'planned';
  return 'neutral';
}

/** Dana UI tone for an RXO load status. */
export function danaStatusTone(value?: string | null): 'success' | 'warning' | 'info' | 'neutral' {
  const tone = statusTone(value);
  if (tone === 'good') return 'success';
  if (tone === 'warning') return 'warning';
  if (tone === 'info') return 'info';
  return 'neutral';
}

/** Dana UI tone for the integration activity state. */
export function integrationTone(state: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (state === 'healthy') return 'success';
  if (state === 'warning' || state === 'degraded') return 'warning';
  if (state === 'error') return 'danger';
  if (state === 'working') return 'info';
  return 'neutral';
}

export function statusSummaryDetail(value?: string | null): string {
  const tone = statusTone(value);
  if (tone === 'warning') return 'Needs attention';
  if (tone === 'good') return 'Healthy active load';
  if (tone === 'info') return 'Moving / in transit';
  if (tone === 'planned') return 'Planned active load';
  return 'Current active status';
}

export function rxoSiteTimeLabel(direction: string | null | undefined): string {
  const value = String(direction ?? '').trim().toUpperCase();
  if (value === 'OUTBOUND') return 'Pickup';
  if (value === 'INBOUND') return 'Drop-off';
  return 'Time';
}

export function formatEasternRxoTime(value: string | null | undefined): string {
  if (!value?.trim()) return '-';

  const raw = value.trim();
  const wallClock = raw.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(ET|CT|MT|PT)$/i,
  );

  if (wallClock) {
    const [, monthName, dayText, yearText, hourText, minuteText, zone] = wallClock;
    const month = [
      'jan', 'feb', 'mar', 'apr', 'may', 'jun',
      'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    ].indexOf(monthName.toLowerCase());
    const day = Number(dayText);
    const year = Number(yearText);
    const easternShiftHours: Record<string, number> = { ET: 0, CT: 1, MT: 2, PT: 3 };
    const hour = Number(hourText) + easternShiftHours[zone.toUpperCase()];
    const minute = Number(minuteText);
    const easternWallClock = new Date(Date.UTC(year, month, day, hour, minute));
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(easternWallClock).replace(/, (?=\d{2}:\d{2}$)/, ' ');
    return `${formatted} ET`;
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;

  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(parsed)).replace(/, (?=\d{2}:\d{2}$)/, ' ');
  return `${formatted} ET`;
}

export function rxoPickupTime(row: ShipmentLike): string {
  return formatEasternRxoTime(
    row.pickup_appointment_arrival_raw?.trim() ||
      row.pickup_estimated_arrival_raw?.trim() ||
      null,
  );
}

export function rxoDropOffTime(row: ShipmentLike): string {
  return formatEasternRxoTime(
    row.delivery_appointment_arrival_raw?.trim() ||
      row.delivery_estimated_arrival_raw?.trim() ||
      null,
  );
}

export function rxoSiteTime(row: RxoRow): string {
  const direction = String(row.direction ?? '').trim().toUpperCase();

  if ('order_number' in row) {
    const pickup = formatEasternRxoTime(row.pickup_at);
    const dropOff = formatEasternRxoTime(row.delivery_at);
    if (direction === 'OUTBOUND') return pickup;
    if (direction === 'INBOUND') return dropOff;
    return pickup !== '-' ? pickup : dropOff;
  }

  if ('orders_site_time' in row) {
    const ordersSiteTime = formatEasternRxoTime(row.orders_site_time);
    if (ordersSiteTime !== '-') return ordersSiteTime;
  }

  const pickup = rxoPickupTime(row);
  const dropOff = rxoDropOffTime(row);
  if (direction === 'OUTBOUND') return pickup;
  if (direction === 'INBOUND') return dropOff;
  return pickup !== '-' ? pickup : dropOff;
}

export function formatClockDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatAge(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return 'Unknown';
  if (milliseconds < 1000) return 'Just now';
  const seconds = Math.floor(milliseconds / 1000);
  return seconds < 60
    ? `${seconds}s ago`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleString()
    : '-';
}

export function normalizeLocationAddress(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function orderLocationShortName(
  address: string | null | undefined,
  locationNames: Readonly<Record<string, string>>,
): string {
  const stop = normalizeLocationAddress(address);
  if (!stop) return '';

  let bestAddress = '';
  let bestName = '';
  for (const [orderAddress, name] of Object.entries(locationNames)) {
    if (!orderAddress || !name) continue;
    if (
      stop === orderAddress
      || stop.endsWith(` ${orderAddress}`)
      || stop.endsWith(orderAddress)
    ) {
      if (orderAddress.length > bestAddress.length) {
        bestAddress = orderAddress;
        bestName = name;
      }
    }
  }
  return bestName;
}

export function readableStopName(value: string | null | undefined): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '-';

  const firstDigit = text.search(/\d/);
  if (firstDigit > 0) {
    let prefix = text
      .slice(0, firstDigit)
      .replace(/[,\-]+\s*$/, '')
      .trim();

    // Native RXO stop strings can place the street phrase before the number.
    prefix = prefix.replace(
      /\s+[A-Z0-9.'-]+\s+(?:DRIVE|DR|ROAD|RD|STREET|ST|AVENUE|AVE|BOULEVARD|BLVD|LANE|LN|PARKWAY|PKWY|HIGHWAY|HWY|COURT|CT|CIRCLE|CIR|WAY|PLACE|PL|TRAIL|TRL)\s*$/i,
      '',
    ).trim();

    // Mexican exports can use ACCESSO/ACCESO as the first address token.
    prefix = prefix.replace(/\s+(?:ACCESSO|ACCESO|ACCESS)\s*$/i, '').trim();

    if (prefix) return prefix;
  }

  return text;
}

export function canonicalShortRouteName(
  row: ShipmentLike,
  locationNames: Readonly<Record<string, string>>,
): string {
  const direction = String(row.direction ?? '').trim().toUpperCase();

  const directOrderName = String(
    direction === 'OUTBOUND' ? (row.destination_name ?? '') : (row.origin_name ?? ''),
  ).trim();
  if (directOrderName) return directOrderName;

  const nativeStopName = String(
    direction === 'OUTBOUND' ? (row.last_stop_name ?? '') : (row.first_stop_name ?? ''),
  ).trim();
  if (nativeStopName) return nativeStopName;

  const stopAddress = String(
    direction === 'OUTBOUND'
      ? (row.last_stop_address ?? row.destination_address ?? '')
      : (row.first_stop_address ?? row.origin_address ?? ''),
  ).trim();

  const orderLocationName = orderLocationShortName(stopAddress, locationNames);
  if (orderLocationName) return orderLocationName;
  return readableStopName(stopAddress);
}

export function orderRouteLookupKey(
  direction: string | null | undefined,
  shipmentId: string | null | undefined,
): string {
  return `${String(direction ?? '').trim().toUpperCase()}|${String(shipmentId ?? '').trim()}`;
}

export function orderShortRouteName(
  row: ShipmentLike,
  routeNames: Readonly<Record<string, string>>,
): string {
  const direction = String(row.direction ?? '').trim().toUpperCase();
  const shipmentId = String(row.shipment_id ?? '').trim();
  const orderName = routeNames[orderRouteLookupKey(direction, shipmentId)];
  if (orderName) return orderName;

  if ('destination_name' in row) {
    if (direction === 'OUTBOUND') return String(row.destination_name ?? row.destination_address ?? '-');
    if (direction === 'INBOUND') return String(row.origin_name ?? row.origin_address ?? '-');
    return `${String(row.origin_name ?? row.origin_address ?? '-')} → ${String(row.destination_name ?? row.destination_address ?? '-')}`;
  }

  if (direction === 'OUTBOUND') return String(row.last_stop_address ?? '-');
  if (direction === 'INBOUND') return String(row.first_stop_address ?? '-');
  return `${String(row.first_stop_address ?? '-')} → ${String(row.last_stop_address ?? '-')}`;
}

// ---------------------------------------------------------------------------
// Control Center status view model.
// Computed once per status update / clock tick instead of ~70 template getters
// re-evaluated on every change-detection pass.
// ---------------------------------------------------------------------------

export interface RxoControlInputs {
  control: RxoControlStatusData | null;
  importStatus: RxoImportStatusData | null;
  /** Page clock (updated every second). */
  clockNow: number;
  /** Wall clock at compute time. */
  now: number;
  statusReceivedAt: number;
  serverClockOffsetMs: number;
  /** True while the first load or a page action is running. */
  busy: boolean;
  lastUpdated: Date | null;
  /** Saved/edited settings used only when the API does not report a value. */
  fallbackSettings: { syncIntervalMinutes: number; maxScanDurationMinutes: number; noProgressTimeoutMinutes: number };
}

export type RxoControlView = ReturnType<typeof buildRxoControlView>;

const ACTIVE_TIMER_PHASES = ['QUEUED', 'EXPORTING', 'SYNCING', 'IMPORTING', 'STALLED', 'RECOVERING', 'RETRYING'];

export function buildRxoControlView(input: RxoControlInputs) {
  const { control, importStatus, busy } = input;
  const siteCounts =
    importStatus?.countsBySite?.find((row) => row.site_key === 'fort-wayne') ?? importStatus?.countsBySite?.[0];
  const scheduler = control?.scheduler ?? null;
  const remoteNow = input.clockNow + input.serverClockOffsetMs;
  const apiRefreshAgeMs = input.statusReceivedAt
    ? Math.max(0, input.now - input.statusReceivedAt)
    : Number.POSITIVE_INFINITY;
  const heartbeat = scheduler?.schedulerHeartbeatAt;
  const schedulerHeartbeatAgeMs = heartbeat
    ? Math.max(0, remoteNow - Date.parse(heartbeat))
    : Number.POSITIVE_INFINITY;

  const timerStatusStale = (() => {
    if (!control || apiRefreshAgeMs > 15_000) return true;
    if (!control.exporterRunning) return false;
    return schedulerHeartbeatAgeMs > 30_000;
  })();

  const scheduledWaiting = control?.exporterRunning === true && !control.recovery?.requiresCredentials
    && !control.recovery?.requiresInteractiveLogin && String(scheduler?.status ?? '').toUpperCase() === 'WAITING'
    && Number.isFinite(Date.parse(scheduler?.nextRunAt || ''));
  const schedulerPhase = String(scheduler?.currentPhase ?? '').toUpperCase();
  const recoveryState = String(scheduler?.recoveryState ?? '').toUpperCase();
  const scanRecoveryActive = !scheduledWaiting && (['STALLED', 'RECOVERING', 'RETRYING'].includes(schedulerPhase)
    || ['TERMINATING', 'FORCE_TERMINATING', 'COOLDOWN', 'RETRYING'].includes(recoveryState));
  const scanNeedsReview = !scheduledWaiting && (schedulerPhase === 'NEEDS_REVIEW' || recoveryState === 'NEEDS_REVIEW');

  const activeTimerPhase = (() => {
    if (scanNeedsReview) return 'NEEDS_REVIEW';
    if (scanRecoveryActive) return schedulerPhase || 'RECOVERING';
    const manual = control?.manualRun?.status ?? 'IDLE';
    if (['QUEUED', 'EXPORTING', 'SYNCING', 'IMPORTING'].includes(manual)) return manual;
    if (scheduledWaiting) return 'IDLE';
    if (ACTIVE_TIMER_PHASES.includes(schedulerPhase)) return schedulerPhase;
    if (String(control?.exporterHealth?.status ?? '').toLowerCase() === 'running') return 'EXPORTING';
    return 'IDLE';
  })();

  const scanRunning = ACTIVE_TIMER_PHASES.includes(activeTimerPhase);
  const scanTimerRunning = scanRunning;

  const activeStartedAt = (() => {
    const manualStatus = control?.manualRun?.status ?? '';
    if (['SYNCING', 'IMPORTING'].includes(manualStatus)) return control?.manualRun?.startedAt ?? null;
    return (
      (scanRecoveryActive ? scheduler?.recoveryStartedAt : null) ??
      scheduler?.currentStartedAt ??
      control?.exporterHealth?.currentStartedAt ??
      control?.manualRun?.startedAt ??
      null
    );
  })();

  const nextRunAt = scheduler?.nextRunAt ?? control?.exporterHealth?.nextRunAt ?? null;

  const hasCurrentRxoRows = Boolean(
    Number(siteCounts?.orders_visible ?? 0) ||
      Number(siteCounts?.shipments_visible ?? 0) ||
      Number(siteCounts?.freight_visible ?? 0),
  );

  const importHealthStatus = importStatus?.importHealth?.status;
  const importNeedsReview = importHealthStatus === 'PARTIAL' || importHealthStatus === 'UNKNOWN';

  const recoveryReasonLabel = String(
    scheduler?.recoveryReason ??
      scheduler?.stallReason ??
      scheduler?.lastRecoveryError ??
      'No recovery reason reported.',
  );

  const recovery = Number(scheduler?.automaticRecoveryAttempt ?? 0);
  const maxRecovery = Number(scheduler?.maxAutomaticRecoveryAttempts ?? 1);
  const attempt = Number(scheduler?.currentAttempt ?? 0);
  const exporterAttemptLabel = attempt
    ? `Attempt ${attempt}; recovery ${recovery}/${maxRecovery}`
    : `Recovery ${recovery}/${maxRecovery}`;

  const schedulerTriggerLabel = String(scheduler?.currentTrigger ?? (scanRunning ? 'manual' : 'scheduled')).toUpperCase();
  const schedulerPhaseLabel = String(scheduler?.currentPhase ?? activeTimerPhase).toUpperCase();

  const durationSeconds = Number(control?.exporterHealth?.lastDurationSeconds ?? 0);
  const durationLabel = !durationSeconds
    ? '-'
    : durationSeconds >= 60
      ? `${Math.floor(durationSeconds / 60)}m ${Math.round(durationSeconds % 60)}s`
      : `${durationSeconds.toFixed(1)}s`;

  const scanTimerTitle = (() => {
    if (!control && busy) return 'Checking RXO status';
    if (timerStatusStale) return 'Timer status';
    if (scanNeedsReview) return 'Scan needs review';
    if (scanRecoveryActive) return 'Recovery elapsed';
    if (scanTimerRunning) return ['SYNCING', 'IMPORTING'].includes(activeTimerPhase) ? 'Sync / import elapsed' : 'Scan elapsed';
    return 'Next scan in';
  })();

  const scanTimerLabel = (() => {
    if (!control && busy) return '--:--';
    if (timerStatusStale) return 'STALE';
    if (scanNeedsReview) return 'STOPPED';
    if (scanTimerRunning) {
      return formatClockDuration(activeStartedAt ? Math.max(0, remoteNow - Date.parse(activeStartedAt)) : 0);
    }
    if (!nextRunAt) return '--:--';
    return formatClockDuration(Math.max(0, Date.parse(nextRunAt) - remoteNow));
  })();

  const scanTimerDetail = (() => {
    if (!control && busy) return 'Waiting for the first live RXO status response.';
    if (timerStatusStale) return 'Waiting for a fresh scheduler heartbeat and API status response.';
    if (scanNeedsReview) return recoveryReasonLabel;
    if (scanRecoveryActive) return `Automatic recovery ${exporterAttemptLabel.toLowerCase()}. ${recoveryReasonLabel}`;
    if (scanTimerRunning) return `${schedulerTriggerLabel} / ${schedulerPhaseLabel} - last completed scan ${durationLabel}`;
    if (nextRunAt) return `Next automatic scan ${new Date(nextRunAt).toLocaleString()}`;
    const minutes = control?.settings?.syncIntervalMinutes ?? input.fallbackSettings.syncIntervalMinutes;
    return `Automatic interval: every ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  })();

  const runFailed =
    control?.manualRun?.status === 'FAILED' ||
    String(control?.exporterHealth?.status ?? '').toLowerCase() === 'error';

  const integrationState = (() => {
    // No response is not a stale or failed RXO scan. The initial request is still pending.
    if (!control) return busy ? 'idle' : 'degraded';
    if (scanRecoveryActive || scanNeedsReview) return 'warning';
    if (scanRunning) return 'working';
    if (!control?.controlAvailable) return 'degraded';
    if (runFailed) return hasCurrentRxoRows ? 'warning' : 'error';
    if (importNeedsReview || control?.manualRun?.status === 'PARTIAL') return 'warning';
    if (timerStatusStale) return 'warning';
    if (hasCurrentRxoRows) return 'healthy';
    return 'idle';
  })();

  const integrationStatus = (() => {
    if (!control) return busy ? 'Checking RXO status…' : 'RXO status unavailable';
    if (scanNeedsReview) return 'RXO scan needs review';
    if (scanRecoveryActive) return 'RXO scan stalled - automatic recovery in progress';
    if (scanRunning) return 'RXO scan / import is running';
    if (!control?.controlAvailable) {
      return hasCurrentRxoRows ? 'RXO data available - remote controls offline' : 'Remote RXO controls are unavailable';
    }
    if (runFailed) {
      return hasCurrentRxoRows
        ? 'Latest refresh needs attention - existing RXO data is still available'
        : 'RXO refresh failed';
    }
    if (timerStatusStale) return 'RXO data available - timer status is stale';
    if (importNeedsReview || control?.manualRun?.status === 'PARTIAL') return 'RXO import is incomplete — review affected datasets';
    if (hasCurrentRxoRows) return 'RXO data is current';
    return 'RXO integration is waiting';
  })();

  const integrationDetail = (() => {
    if (!control) return busy
      ? 'Waiting for the first exporter and scheduler status response.'
      : 'Exporter health could not be confirmed. Try Refresh; saved RXO data is not changed.';
    if (scanNeedsReview) {
      return `The controlled retry did not complete. ${recoveryReasonLabel} Existing PostgreSQL data remains available.`;
    }
    if (scanRecoveryActive) {
      return `The exporter stopped making progress and is being recovered automatically. ${recoveryReasonLabel} Existing PostgreSQL data remains available.`;
    }
    if (scanRunning) return 'Truck Log is refreshing RXO data. Current PostgreSQL data remains available while the refresh runs.';
    if (!control?.controlAvailable) return 'Truck Log is running, but the remote Docker control channel is unavailable.';
    if (timerStatusStale) {
      return 'The page paused its countdown because the scheduler heartbeat or API refresh is stale. Open Timer Diagnostics for details.';
    }
    if (control?.manualRun?.status === 'FAILED') {
      return control.manualRun.error ?? 'The latest scan/import failed. Existing PostgreSQL data remains available.';
    }
    if (importNeedsReview || control?.manualRun?.status === 'PARTIAL') {
      return 'Some datasets were skipped or their completeness is unverified. Retained data may be from an older batch; see Import details.';
    }
    if (hasCurrentRxoRows) return 'The latest RXO data is available in PostgreSQL and the scheduler heartbeat is current.';
    return 'No scan is running. Truck Log is waiting for the next scheduled or manual RXO refresh.';
  })();

  const integrationUpdated = input.lastUpdated
    ? `Updated ${input.lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
    : 'Waiting for status';

  const configuredInterval =
    scheduler?.syncIntervalMinutes ?? control?.settings?.syncIntervalMinutes ?? input.fallbackSettings.syncIntervalMinutes;

  const lastCompletedSeconds = Number(scheduler?.lastDurationSeconds ?? control?.exporterHealth?.lastDurationSeconds ?? 0);

  const exporterProgressAgeMs = scheduler?.lastExporterOutputAt
    ? Math.max(0, remoteNow - Date.parse(scheduler.lastExporterOutputAt))
    : Number.POSITIVE_INFINITY;

  const offsetSeconds = input.serverClockOffsetMs / 1000;
  const manualStatus = control?.manualRun?.status;
  const exporterHealthStatus = String(control?.exporterHealth?.status ?? 'unknown').toUpperCase();
  const lastImportedAt = importStatus?.lastImport?.['imported_at'];

  return {
    siteCounts,
    scheduler,
    remoteNow,
    apiRefreshAgeMs,
    schedulerHeartbeatAgeMs,
    timerStatusStale,
    schedulerPhase,
    recoveryState,
    scanRecoveryActive,
    scanNeedsReview,
    activeTimerPhase,
    scanRunning,
    scanTimerRunning,
    scanTimerTitle,
    activeStartedAt,
    nextRunAt,
    scanTimerLabel,
    scanTimerDetail,
    integrationState,
    integrationTone: integrationTone(integrationState),
    integrationStatus,
    integrationDetail,
    integrationUpdated,
    hasCurrentRxoRows,
    timerDiagnosticsState: timerStatusStale
      ? 'STATUS STALE'
      : scanNeedsReview ? 'NEEDS REVIEW' : scanRecoveryActive ? 'RECOVERING' : scanTimerRunning ? 'LIVE - RUNNING' : 'LIVE - WAITING',
    schedulerHeartbeatLabel: Number.isFinite(schedulerHeartbeatAgeMs) ? formatAge(schedulerHeartbeatAgeMs) : 'Not received',
    schedulerHeartbeatTimeLabel: formatDateTime(scheduler?.schedulerHeartbeatAt ?? null),
    apiRefreshAgeLabel: Number.isFinite(apiRefreshAgeMs) ? formatAge(apiRefreshAgeMs) : 'Not received',
    statusGeneratedLabel: control?.statusGeneratedAt ? `Generated ${formatDateTime(control.statusGeneratedAt)}` : 'No API timestamp',
    configuredIntervalLabel: `${configuredInterval} minute${configuredInterval === 1 ? '' : 's'}`,
    schedulerTriggerLabel,
    schedulerPhaseLabel,
    scanStartedLabel: formatDateTime(activeStartedAt),
    nextScheduledLabel: formatDateTime(nextRunAt),
    lastCompletedDurationLabel: lastCompletedSeconds ? formatClockDuration(lastCompletedSeconds * 1000) : '-',
    lastCompletedLabel: formatDateTime(scheduler?.lastCompletedAt ?? control?.exporterHealth?.lastSuccessAt ?? null),
    browserTimeLabel: new Date(input.clockNow).toLocaleTimeString(),
    serverTimeLabel: new Date(remoteNow).toLocaleTimeString(),
    clockOffsetLabel: `${offsetSeconds >= 0 ? '+' : '-'}${Math.abs(offsetSeconds).toFixed(1)}s`,
    schedulerProcessLabel: scheduler?.schedulerProcessId ? `PID ${scheduler.schedulerProcessId}` : 'Not reported',
    schedulerStartedLabel: scheduler?.schedulerStartedAt
      ? `Started ${formatDateTime(scheduler.schedulerStartedAt)}`
      : 'Start time not reported',
    exporterChildProcessLabel: scheduler?.exporterChildProcessId ? `PID ${scheduler.exporterChildProcessId}` : 'No active exporter child',
    exporterAttemptLabel,
    exporterProgressAgeMs,
    exporterProgressAgeLabel: Number.isFinite(exporterProgressAgeMs) ? formatAge(exporterProgressAgeMs) : 'Not reported',
    exporterProgressLabel: scheduler?.lastExporterOutput ? String(scheduler.lastExporterOutput) : 'Waiting for exporter output',
    stallLimitsLabel: `${Number(
      scheduler?.maxScanDurationMinutes ?? control?.settings?.maxScanDurationMinutes ?? input.fallbackSettings.maxScanDurationMinutes,
    )}m max / ${Number(
      scheduler?.noProgressTimeoutMinutes ?? control?.settings?.noProgressTimeoutMinutes ?? input.fallbackSettings.noProgressTimeoutMinutes,
    )}m no output`,
    recoveryStateLabel: String(scheduler?.recoveryState ?? (scanRecoveryActive ? 'RECOVERING' : 'NONE')).toUpperCase(),
    recoveryReasonLabel,
    lastRecoveryOutcomeLabel: String(scheduler?.lastRecoveryOutcome ?? 'None').toUpperCase(),
    lastRecoveryTimeLabel: scheduler?.lastRecoveryAt ? formatDateTime(scheduler.lastRecoveryAt) : 'No recovery recorded',
    manualRequestLabel: scheduler?.lastRescanRequestId ?? control?.manualRun?.id ?? 'None',
    manualRequestConsumedLabel: scheduler?.lastRescanConsumedAt
      ? `Consumed ${formatDateTime(scheduler.lastRescanConsumedAt)}`
      : 'No consumed request reported',
    schedulerErrorLabel:
      scheduler?.lastRecoveryError ??
      scheduler?.lastError ??
      control?.manualRun?.error ??
      control?.exporterHealth?.lastError ??
      '-',
    importNeedsReview,
    manualRunLabel: manualStatus === 'PARTIAL'
      ? 'RXO import needs review'
      : manualStatus === 'COMPLETE'
        ? 'RXO scan/import complete'
        : manualStatus === 'FAILED' ? 'RXO scan/import failed' : 'RXO scan/import in progress',
    exporterHealthy: Boolean(control?.exporterRunning && control?.exporterHealth?.status === 'ok'),
    runtimeIntegrityLabel: !control?.runtime?.checked ? 'NOT CHECKED' : control?.runtime?.verified ? 'VERIFIED' : 'CHANGED',
    exporterStatusLabel: !control?.exporterRunning ? 'STOPPED' : exporterHealthStatus === 'OK' ? 'HEALTHY' : exporterHealthStatus,
    durationLabel,
    datasetHealthEntries: Object.entries(control?.exporterHealth?.lastDatasetRows ?? {})
      .map(([key, value]) => ({ label: key.replace(':', ' '), rows: Number(value) || 0 })),
    lastImportDate: typeof lastImportedAt === 'string' ? lastImportedAt : null,
  };
}
