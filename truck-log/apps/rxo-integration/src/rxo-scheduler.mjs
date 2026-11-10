import { readAuthHold, consumeAuthRetry, hasPendingAuthRetry, consumeCredentialChangeRetry, authorizeManualRetry, ensureAuthFailureNotification } from './lib/rxo-auth.mjs';
import { withTimeout } from './lib/process-lock.mjs';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import {
  DATA_DIR,
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_MAX_SCAN_DURATION_MINUTES,
  DEFAULT_NO_PROGRESS_TIMEOUT_MINUTES,
  EXPORTER,
  HEALTH_FILE,
  HEARTBEAT_MS,
  MAX_AUTOMATIC_RECOVERY_ATTEMPTS,
  RECOVERY_COOLDOWN_SECONDS,
  RESCAN_FILE,
  SCHEDULER_FILE,
  SYNC_ON_START,
  TERMINATION_GRACE_MS,
  TEST_RECOVERY_COOLDOWN_MS,
  WATCHDOG_MS,
  appendRecoveryEvent,
  attemptLimits,
  cleanOutput,
  currentSettings,
  readJson,
  signalChild,
  sleep,
  writeJsonAtomic,
} from './lib/rxo-scheduler-support.mjs';

// Standard RXO scheduler: state machine, exporter child supervision and the
// main loop. Limits, file locations and helpers: lib/rxo-scheduler-support.mjs.
let shuttingDown = false;
let activeChild = null;
let lastHandledRequestId = '';
let schedulerState = {
  service: 'rxo-scheduler',
  version: process.env.TRUCK_LOG_RELEASE || '1.0.7',
  status: 'STARTING',
  schedulerStartedAt: new Date().toISOString(),
  schedulerHeartbeatAt: new Date().toISOString(),
  schedulerProcessId: process.pid,
  currentTrigger: null,
  currentPhase: 'STARTING',
  currentStartedAt: null,
  nextRunAt: null,
  syncIntervalMinutes: DEFAULT_INTERVAL_MINUTES,
  maxScanDurationMinutes: DEFAULT_MAX_SCAN_DURATION_MINUTES,
  noProgressTimeoutMinutes: DEFAULT_NO_PROGRESS_TIMEOUT_MINUTES,
  exporterChildProcessId: null,
  currentAttempt: 0,
  maxAutomaticRecoveryAttempts: MAX_AUTOMATIC_RECOVERY_ATTEMPTS,
  automaticRecoveryAttempt: 0,
  recoveryState: 'NONE',
  recoveryReason: null,
  recoveryStartedAt: null,
  stallDetectedAt: null,
  stallReason: null,
  lastExporterOutputAt: null,
  lastExporterOutput: null,
  lastExporterOutputStream: null,
  exporterOutputSequence: 0,
  lastRecoveryAt: null,
  lastRecoveryOutcome: null,
  lastRecoveryError: null,
  lastCompletedAt: null,
  lastDurationSeconds: null,
  lastExitCode: null,
  lastBatchId: null,
  lastError: null,
  lastRescanRequestId: null,
  lastRescanRequestedAt: null,
  lastRescanConsumedAt: null,
  schedulerLoopAt: new Date().toISOString(),
  schedulerLoopDeadlineAt: null,
};

// Liveness is loop progress, not the heartbeat timer: the loop records when it
// last advanced and the latest time by which it must advance again. The compose
// healthcheck fails once schedulerLoopDeadlineAt passes, even while the
// independent heartbeat keeps schedulerHeartbeatAt fresh.
const LOOP_IDLE_BOUND_MS = 120_000;
const LOOP_MARGIN_MS = 120_000;
const AUTH_NOTIFICATION_TIMEOUT_MS = 60_000;

function markLoopProgress(boundMs = LOOP_IDLE_BOUND_MS) {
  const now = Date.now();
  schedulerState = {
    ...schedulerState,
    schedulerLoopAt: new Date(now).toISOString(),
    schedulerLoopDeadlineAt: new Date(now + boundMs).toISOString(),
  };
}

// The auth state files are validated strictly and a malformed one throws
// RXO_AUTH_STATE_REVIEW. That must never escape the loop (the restart policy
// would turn it into a crash loop): report NEEDS_REVIEW, keep running, and do
// not start a scan until the state reads cleanly again.
let authStateProblem = null;

function reportAuthStateProblem(label, error) {
  const code = /^RXO_AUTH_[A-Z_]+$/.test(String(error?.code || '')) ? error.code : 'RXO_AUTH_STATE_REVIEW';
  const message = `${code}: RXO sign-in state could not be read (${label}). Automatic scans are paused until the auth state files in the RXO data volume are repaired or removed.`;
  if (!authStateProblem) console.error(`[RXO-SCHEDULER] ${message}`);
  authStateProblem = message;
  publishScheduler({ status: 'ERROR', currentPhase: 'NEEDS_REVIEW', nextRunAt: null,
    recoveryState: 'NEEDS_REVIEW', recoveryReason: message, lastError: message });
}

function authCall(label, operation, fallback) {
  try { return operation(); }
  catch (error) { reportAuthStateProblem(label, error); return fallback; }
}

/** { hold } when sign-in is paused, { error: true } when the state is unreadable. */
function readAuthState() {
  try {
    const hold = readAuthHold(DATA_DIR, 'standard');
    if (authStateProblem) {
      console.log('[RXO-SCHEDULER] RXO sign-in state is readable again.');
      authStateProblem = null;
      if (!hold) publishScheduler({ status: 'WAITING', currentPhase: 'WAITING', recoveryState: 'NONE', recoveryReason: null, lastError: null });
    }
    return { hold, error: false };
  } catch (error) {
    reportAuthStateProblem('hold', error);
    return { hold: null, error: true };
  }
}

async function notifyAuthFailure() {
  // Bounded: SMTP must never stall the scheduler loop.
  try { await withTimeout(ensureAuthFailureNotification(DATA_DIR, 'standard'), AUTH_NOTIFICATION_TIMEOUT_MS, 'SMTP_TIMEOUT'); } catch {}
}

function publishScheduler(patch = {}) {
  schedulerState = {
    ...schedulerState,
    ...patch,
    schedulerHeartbeatAt: new Date().toISOString(),
    schedulerProcessId: process.pid,
  };
  writeJsonAtomic(SCHEDULER_FILE, schedulerState);
}

function readManualRequest() {
  const request = readJson(RESCAN_FILE);
  const requestId = String(request?.requestId || '').trim();
  if (!requestId || requestId === lastHandledRequestId) return null;
  return {
    requestId,
    requestedAt: request?.requestedAt || null,
  };
}

function consumeManualRequest(request) {
  lastHandledRequestId = request.requestId;
  try {
    fs.unlinkSync(RESCAN_FILE);
  } catch {}
  publishScheduler({
    status: 'QUEUED',
    currentTrigger: 'manual',
    currentPhase: 'QUEUED',
    lastRescanRequestId: request.requestId,
    lastRescanRequestedAt:
      request.requestedAt || new Date().toISOString(),
    lastRescanConsumedAt: new Date().toISOString(),
    lastError: null,
  });
}

function exporterHealth() {
  return readJson(HEALTH_FILE) || {};
}

function recordExporterOutput(stream, chunk) {
  const text = chunk.toString('utf8');
  if (stream === 'stderr') process.stderr.write(chunk);
  else process.stdout.write(chunk);

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return;

  schedulerState = {
    ...schedulerState,
    lastExporterOutputAt: new Date().toISOString(),
    lastExporterOutput: cleanOutput(lines.at(-1)),
    lastExporterOutputStream: stream,
    exporterOutputSequence:
      Number(schedulerState.exporterOutputSequence || 0) + 1,
  };
}

async function runExporterAttempt(trigger, attempt, recoveryAttempt) {
  const settings = currentSettings();
  const limits = attemptLimits(settings);
  const startedAt = new Date();
  const initialPhase = recoveryAttempt > 0 ? 'RETRYING' : 'EXPORTING';
  const initialRecoveryState =
    recoveryAttempt > 0 ? 'RETRYING' : 'NONE';

  publishScheduler({
    status: recoveryAttempt > 0 ? 'RECOVERING' : 'RUNNING',
    currentTrigger: trigger,
    currentPhase: initialPhase,
    currentStartedAt: startedAt.toISOString(),
    nextRunAt: null,
    syncIntervalMinutes: settings.syncIntervalMinutes,
    maxScanDurationMinutes: settings.maxScanDurationMinutes,
    noProgressTimeoutMinutes: settings.noProgressTimeoutMinutes,
    exporterChildProcessId: null,
    currentAttempt: attempt,
    automaticRecoveryAttempt: recoveryAttempt,
    recoveryState: initialRecoveryState,
    recoveryReason:
      recoveryAttempt > 0 ? schedulerState.recoveryReason : null,
    recoveryStartedAt:
      recoveryAttempt > 0
        ? schedulerState.recoveryStartedAt || new Date().toISOString()
        : null,
    stallDetectedAt: recoveryAttempt > 0 ? schedulerState.stallDetectedAt : null,
    stallReason: recoveryAttempt > 0 ? schedulerState.stallReason : null,
    lastExporterOutputAt: startedAt.toISOString(),
    lastExporterOutput:
      recoveryAttempt > 0
        ? 'Automatic recovery retry started.'
        : 'Exporter process started.',
    lastExporterOutputStream: 'scheduler',
    exporterOutputSequence:
      Number(schedulerState.exporterOutputSequence || 0) + 1,
    lastError: null,
  });

  console.log(
    `[RXO-SCHEDULER] Starting ${trigger} scan attempt ${attempt} at ${startedAt.toISOString()}.`,
  );

  return await new Promise((resolve) => {
    let settled = false;
    let stallReason = null;
    let stallDetectedAt = null;
    let terminateTimer = null;
    let hardStopTimer = null;

    const child = spawn(process.execPath, [EXPORTER, '--once'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      detached: process.platform !== 'win32',
    });
    activeChild = child;

    publishScheduler({
      exporterChildProcessId: child.pid ?? null,
    });

    child.stdout?.on('data', (chunk) =>
      recordExporterOutput('stdout', chunk),
    );
    child.stderr?.on('data', (chunk) =>
      recordExporterOutput('stderr', chunk),
    );

    const finish = (exitCode, startError = null) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      if (terminateTimer) clearTimeout(terminateTimer);
      if (hardStopTimer) clearTimeout(hardStopTimer);
      if (activeChild === child) activeChild = null;

      const completedAt = new Date();
      resolve({
        exitCode:
          typeof exitCode === 'number'
            ? exitCode
            : stallReason
              ? 124
              : 1,
        startedAt,
        completedAt,
        durationSeconds: Math.max(
          0,
          (completedAt.getTime() - startedAt.getTime()) / 1000,
        ),
        stalled: Boolean(stallReason),
        stallReason,
        stallDetectedAt,
        startError,
      });
    };

    const markStalled = (reason) => {
      if (stallReason || settled) return;
      stallReason = reason;
      stallDetectedAt = new Date().toISOString();
      const recoveryStartedAt = new Date().toISOString();

      publishScheduler({
        status: 'RECOVERING',
        currentPhase: 'STALLED',
        recoveryState: 'TERMINATING',
        recoveryReason: reason,
        recoveryStartedAt,
        stallDetectedAt,
        stallReason: reason,
        lastRecoveryAt: recoveryStartedAt,
        lastRecoveryOutcome: 'IN_PROGRESS',
        lastRecoveryError: null,
        lastError: null,
      });
      appendRecoveryEvent({
        event: 'STALL_DETECTED',
        trigger,
        attempt,
        recoveryAttempt,
        childProcessId: child.pid ?? null,
        reason,
      });
      console.error(`[RXO-SCHEDULER] STALL DETECTED: ${reason}`);

      signalChild(child, 'SIGTERM');
      terminateTimer = setTimeout(() => {
        if (child.exitCode === null) {
          publishScheduler({
            recoveryState: 'FORCE_TERMINATING',
          });
          appendRecoveryEvent({
            event: 'FORCE_TERMINATE',
            childProcessId: child.pid ?? null,
            reason,
          });
          signalChild(child, 'SIGKILL');
        }
      }, TERMINATION_GRACE_MS);
      terminateTimer.unref?.();

      hardStopTimer = setTimeout(() => {
        finish(124);
      }, TERMINATION_GRACE_MS + 5_000);
      hardStopTimer.unref?.();
    };

    const watchdog = setInterval(() => {
      if (settled || shuttingDown) return;
      const now = Date.now();
      const elapsed = now - startedAt.getTime();
      const progressAt = Date.parse(
        schedulerState.lastExporterOutputAt || startedAt.toISOString(),
      );
      const noProgress = now - progressAt;

      if (elapsed > limits.maxDurationMs) {
        markStalled(
          `Maximum scan duration of ${settings.maxScanDurationMinutes} minute(s) was exceeded.`,
        );
        return;
      }

      if (noProgress > limits.noProgressMs) {
        markStalled(
          `No exporter output was observed for ${settings.noProgressTimeoutMinutes} minute(s).`,
        );
      }
    }, WATCHDOG_MS);
    watchdog.unref?.();

    child.once('exit', (code) => finish(code));
    child.once('error', (error) => {
      console.error(
        `[RXO-SCHEDULER] Could not start exporter: ${error.message}`,
      );
      finish(127, error.message);
    });
  });
}

async function runExporter(trigger) {
  markLoopProgress(LOOP_IDLE_BOUND_MS);
  const auth = readAuthState();
  if (auth.error) return { success: false, recovered: false, error: 'RXO_AUTH_STATE_REVIEW' };
  const authHold = auth.hold;
  if (authHold) {
    await notifyAuthFailure();
    publishScheduler({ status: 'ERROR', currentPhase: 'NEEDS_REVIEW',
      recoveryState: 'NEEDS_REVIEW', recoveryReason: authHold.code + ': Automatic sign-in paused for operator review.',
      nextRunAt: null, lastError: authHold.code + ': Sign-in paused. Review auth status before Run Scan Now.' });
    return { success: false, recovered: false, error: authHold.code };
  }
  const cycleStartedAt = new Date();
  let finalResult = null;

  for (
    let recoveryAttempt = 0;
    recoveryAttempt <= MAX_AUTOMATIC_RECOVERY_ATTEMPTS;
    recoveryAttempt += 1
  ) {
    if (recoveryAttempt > 0) {
      const cooldownMs =
        TEST_RECOVERY_COOLDOWN_MS ??
        RECOVERY_COOLDOWN_SECONDS * 1000;
      publishScheduler({
        status: 'RECOVERING',
        currentPhase: 'RECOVERING',
        recoveryState: 'COOLDOWN',
        automaticRecoveryAttempt: recoveryAttempt,
        recoveryStartedAt:
          schedulerState.recoveryStartedAt || new Date().toISOString(),
        lastExporterOutputAt: new Date().toISOString(),
        lastExporterOutput: `Automatic retry ${recoveryAttempt}/${MAX_AUTOMATIC_RECOVERY_ATTEMPTS} begins after a ${Math.round(
          cooldownMs / 1000,
        )}-second cooldown.`,
        lastExporterOutputStream: 'scheduler',
        exporterOutputSequence:
          Number(schedulerState.exporterOutputSequence || 0) + 1,
      });
      appendRecoveryEvent({
        event: 'RECOVERY_COOLDOWN',
        trigger,
        recoveryAttempt,
        cooldownMs,
        reason: schedulerState.recoveryReason,
      });
      markLoopProgress(cooldownMs + LOOP_MARGIN_MS);
      await sleep(cooldownMs);
      if (shuttingDown) break;
    }

    // runExporterAttempt always settles: the watchdog stops the child after the
    // maximum duration, then SIGKILL after the grace period, then hard-stops.
    const bound = attemptLimits(currentSettings());
    markLoopProgress(bound.maxDurationMs + WATCHDOG_MS + TERMINATION_GRACE_MS + 5_000 + LOOP_MARGIN_MS);
    const result = await runExporterAttempt(
      trigger,
      recoveryAttempt + 1,
      recoveryAttempt,
    );
    markLoopProgress(LOOP_IDLE_BOUND_MS);
    finalResult = result;
    const health = exporterHealth();
    const healthError =
      health?.status === 'error'
        ? String(health?.lastError || 'Exporter reported an error.')
        : null;
    const success =
      result.exitCode === 0 && !result.stalled && !healthError;

    if (success) {
      const completedAt = new Date();
      const durationSeconds = Math.max(
        0,
        (completedAt.getTime() - cycleStartedAt.getTime()) / 1000,
      );
      const recovered = recoveryAttempt > 0;

      publishScheduler({
        status: 'WAITING',
        currentTrigger: trigger,
        currentPhase: 'COMPLETE',
        currentStartedAt: null,
        exporterChildProcessId: null,
        currentAttempt: recoveryAttempt + 1,
        automaticRecoveryAttempt: recoveryAttempt,
        recoveryState: recovered ? 'RECOVERED' : 'NONE',
        lastRecoveryAt: recovered
          ? new Date().toISOString()
          : schedulerState.lastRecoveryAt,
        lastRecoveryOutcome: recovered
          ? 'RECOVERED'
          : schedulerState.lastRecoveryOutcome,
        lastRecoveryError: null,
        lastCompletedAt: completedAt.toISOString(),
        lastDurationSeconds: Number(durationSeconds.toFixed(1)),
        lastExitCode: 0,
        lastBatchId: health?.lastBatchId || null,
        lastError: null,
        syncIntervalMinutes: currentSettings().syncIntervalMinutes,
      });
      if (recovered) {
        appendRecoveryEvent({
          event: 'RECOVERED',
          trigger,
          recoveryAttempt,
          durationSeconds,
          batchId: health?.lastBatchId || null,
        });
      }
      console.log(
        `[RXO-SCHEDULER] ${trigger} scan completed in ${durationSeconds.toFixed(
          1,
        )}s${recovered ? ' after automatic recovery' : ''}.`,
      );
      return { success: true, recovered, result };
    }

    const error =
      result.stallReason ||
      healthError ||
      result.startError ||
      `Exporter exited with code ${result.exitCode}.`;

    if (
      result.stalled &&
      recoveryAttempt < MAX_AUTOMATIC_RECOVERY_ATTEMPTS
    ) {
      publishScheduler({
        status: 'RECOVERING',
        currentPhase: 'RECOVERING',
        recoveryState: 'COOLDOWN',
        recoveryReason: error,
        automaticRecoveryAttempt: recoveryAttempt + 1,
        lastRecoveryAt: new Date().toISOString(),
        lastRecoveryOutcome: 'RETRY_SCHEDULED',
        lastRecoveryError: error,
        exporterChildProcessId: null,
      });
      continue;
    }

    const completedAt = new Date();
    const durationSeconds = Math.max(
      0,
      (completedAt.getTime() - cycleStartedAt.getTime()) / 1000,
    );
    const needsReview = result.stalled;

    publishScheduler({
      status: 'ERROR',
      currentTrigger: trigger,
      currentPhase: needsReview ? 'NEEDS_REVIEW' : 'FAILED',
      currentStartedAt: null,
      exporterChildProcessId: null,
      recoveryState: needsReview ? 'NEEDS_REVIEW' : 'FAILED',
      recoveryReason: error,
      lastRecoveryAt: needsReview
        ? new Date().toISOString()
        : schedulerState.lastRecoveryAt,
      lastRecoveryOutcome: needsReview
        ? 'NEEDS_REVIEW'
        : schedulerState.lastRecoveryOutcome,
      lastRecoveryError: error,
      lastCompletedAt: completedAt.toISOString(),
      lastDurationSeconds: Number(durationSeconds.toFixed(1)),
      lastExitCode: result.exitCode,
      lastBatchId: health?.lastBatchId || null,
      lastError: error,
      syncIntervalMinutes: currentSettings().syncIntervalMinutes,
    });
    appendRecoveryEvent({
      event: needsReview ? 'NEEDS_REVIEW' : 'FAILED',
      trigger,
      automaticRecoveryAttempt: recoveryAttempt,
      durationSeconds,
      exitCode: result.exitCode,
      error,
    });
    console.error(`[RXO-SCHEDULER] ${error}`);
    return { success: false, recovered: false, result, error };
  }

  return {
    success: false,
    recovered: false,
    result: finalResult,
    error: 'Scheduler stopped before the scan completed.',
  };
}

async function waitForTrigger(anchorMs) {
  let shownDeadline = 0;
  let shownInterval = -1;
  const preserveReviewState = ['NEEDS_REVIEW', 'FAILED'].includes(
    String(schedulerState.currentPhase || '').toUpperCase(),
  );

  publishScheduler({
    status: preserveReviewState ? 'ERROR' : 'WAITING',
    currentTrigger: null,
    currentPhase: preserveReviewState
      ? schedulerState.currentPhase
      : 'WAITING',
    currentStartedAt: null,
    exporterChildProcessId: null,
  });

  while (!shuttingDown) {
    markLoopProgress(LOOP_IDLE_BOUND_MS);
    const manual = readManualRequest();
    if (authCall('retry request', () => consumeAuthRetry(DATA_DIR, 'standard'), false)) {
      // One connection recovery also satisfies a queued legacy Run Scan Now.
      if (manual) consumeManualRequest(manual);
      return 'connection-recovery';
    }
    if (authCall('pending retry', () => hasPendingAuthRetry(DATA_DIR, 'standard'), true)) {
      await sleep(1000);
      continue;
    }
    if (manual) {
      consumeManualRequest(manual);
      if (authCall('manual retry', () => authorizeManualRetry(DATA_DIR, 'standard'), false)) return 'manual';
      // A rejected/locked credential version cannot be resubmitted by repeatedly pressing Run Scan Now.
      continue;
    }
    if (authCall('credential change', () => consumeCredentialChangeRetry(DATA_DIR, 'standard'), false)) return 'credential-update';
    const auth = readAuthState();
    if (auth.error) {
      await sleep(5000);
      continue;
    }
    const authHold = auth.hold;
    if (authHold) {
      await notifyAuthFailure();
      publishScheduler({ status: 'ERROR', currentPhase: 'NEEDS_REVIEW', nextRunAt: null,
        recoveryState: 'NEEDS_REVIEW', recoveryReason: authHold.code + ': Automatic sign-in paused for operator review.',
        lastError: authHold.code + ': Sign-in paused. Review auth status before Run Scan Now.' });
      await sleep(1000);
      continue;
    }

    const settings = currentSettings();
    const deadline = anchorMs + settings.syncIntervalMinutes * 60_000;

    if (
      deadline !== shownDeadline ||
      settings.syncIntervalMinutes !== shownInterval
    ) {
      shownDeadline = deadline;
      shownInterval = settings.syncIntervalMinutes;
      const keepReview = ['NEEDS_REVIEW', 'FAILED'].includes(
        String(schedulerState.currentPhase || '').toUpperCase(),
      );

      publishScheduler({
        status: keepReview ? 'ERROR' : 'WAITING',
        currentTrigger: null,
        currentPhase: keepReview
          ? schedulerState.currentPhase
          : 'WAITING',
        nextRunAt: new Date(deadline).toISOString(),
        syncIntervalMinutes: settings.syncIntervalMinutes,
        maxScanDurationMinutes: settings.maxScanDurationMinutes,
        noProgressTimeoutMinutes: settings.noProgressTimeoutMinutes,
      });

      console.log(
        `[RXO-SCHEDULER] Next scan in ${settings.syncIntervalMinutes} minute(s) at ${new Date(
          deadline,
        ).toISOString()}.`,
      );
    }

    if (Date.now() >= deadline) return 'scheduled';
    await sleep(1000);
  }

  return null;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const settings = currentSettings();

  publishScheduler({
    status: 'STARTING',
    currentPhase: 'STARTING',
    syncIntervalMinutes: settings.syncIntervalMinutes,
    maxScanDurationMinutes: settings.maxScanDurationMinutes,
    noProgressTimeoutMinutes: settings.noProgressTimeoutMinutes,
  });

  markLoopProgress(LOOP_IDLE_BOUND_MS);
  const heartbeat = setInterval(() => {
    try {
      publishScheduler();
    } catch (error) {
      console.error(
        `[RXO-SCHEDULER] Heartbeat write failed: ${
          error?.message || error
        }`,
      );
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  console.log('[RXO-SCHEDULER] Stall watchdog enabled.');
  console.log(
    '[RXO-SCHEDULER] Scheduler diagnostics: /app/data/scheduler-status.json.',
  );
  console.log(
    '[RXO-SCHEDULER] Recovery events: /app/data/scheduler-recovery.log.',
  );
  console.log(
    '[RXO-SCHEDULER] Interval/recovery settings: /app/data/control-settings.json.',
  );
  console.log(
    '[RXO-SCHEDULER] Manual trigger source: /app/data/rescan-request.json.',
  );

  let anchorMs = Date.now();

  // A queued operator request consumes the first run instead of following a
  // failed startup scan with an unintended second password attempt.
  const startupManual = readManualRequest();
  if (authCall('startup retry', () => consumeAuthRetry(DATA_DIR, 'standard'), false)) {
    if (startupManual) consumeManualRequest(startupManual);
    await runExporter('connection-recovery');
    anchorMs = Date.now();
  } else if (authCall('pending startup retry', () => hasPendingAuthRetry(DATA_DIR, 'standard'), true)) {
    // The request is still being handed off (or requires review). The wait loop
    // will consume it; never follow it with an independent startup attempt.
    anchorMs = Date.now();
  } else if (startupManual) {
    consumeManualRequest(startupManual);
    if (authCall('manual retry', () => authorizeManualRetry(DATA_DIR, 'standard'), false)) await runExporter('manual');
    anchorMs = Date.now();
  } else if (authCall('credential change', () => consumeCredentialChangeRetry(DATA_DIR, 'standard'), false)) {
    await runExporter('credential-update');
    anchorMs = Date.now();
  } else if (SYNC_ON_START) {
    await runExporter('startup');
    anchorMs = Date.now();
  } else {
    publishScheduler({
      status: 'WAITING',
      currentPhase: 'WAITING',
      syncIntervalMinutes: settings.syncIntervalMinutes,
    });
  }

  while (!shuttingDown) {
    const trigger = await waitForTrigger(anchorMs);
    if (!trigger || shuttingDown) break;
    await runExporter(trigger);
    anchorMs = Date.now();
  }

  clearInterval(heartbeat);
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  publishScheduler({
    status: 'STOPPING',
    currentPhase: 'STOPPING',
    nextRunAt: null,
  });

  console.log(`[RXO-SCHEDULER] ${signal} received; stopping.`);

  if (activeChild && activeChild.exitCode === null) {
    signalChild(activeChild, 'SIGTERM');
    await sleep(Math.min(TERMINATION_GRACE_MS, 2_000));
    if (activeChild && activeChild.exitCode === null) {
      signalChild(activeChild, 'SIGKILL');
    }
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((error) => {
  console.error(
    `[RXO-SCHEDULER] Fatal error: ${error?.stack || error}`,
  );

  try {
    publishScheduler({
      status: 'ERROR',
      currentPhase: 'FAILED',
      currentStartedAt: null,
      exporterChildProcessId: null,
      nextRunAt: null,
      lastError: error?.message || String(error),
      recoveryState: 'FAILED',
      lastRecoveryError: error?.message || String(error),
    });
  } catch {}

  process.exitCode = 1;
});
