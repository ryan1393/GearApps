import fs from 'node:fs';
import path from 'node:path';
import { acquireExportLock, batchId, mkdirp, readSecret, sleep, writeJson } from './rxo-export-runtime.mjs';
import { pruneBatchDirectories } from './batch-retention.mjs';
import { exportAssertWindow, exportDatasetEvidence, exportWindow } from './rxo-export-data.mjs';
import { publishLatestExports, recoverLatestPublication, verifyLatestExports } from './rxo-export-publication.mjs';
import {
  FORT_WAYNE_CODE,
  FORT_WAYNE_LEGACY,
} from './rxo-filter-ui.mjs';
import {
  CAPTURE_FAILURE_SCREENSHOT,
  DATA_DIR,
  EXPORT_DIRECTIONS,
  MAX_ATTEMPTS,
  PASSWORD_FILE,
  PRODUCTION_PAGES,
  PRODUCTION_VERSION,
  RETRY_DELAY_SECONDS,
  RXO_SITE_KEY,
  RXO_SITE_NAME,
  USERNAME_FILE,
} from './rxo-export-config.mjs';
import { browserSession, closeProductionBrowser, ensureAuthenticated, launchBrowser } from './rxo-export-browser.mjs';
import { exportOneDirection } from './rxo-export-dataset.mjs';

/** One production batch: sign in, export six datasets, publish, verify. */
let syncInProgress = false;

function healthFile() {
  return path.join(DATA_DIR, 'health.json');
}

function readHealth() {
  try {
    return JSON.parse(fs.readFileSync(healthFile(), 'utf8'));
  } catch {
    return {};
  }
}

async function exportCandidate(onProgress = () => {}) {
  const username = readSecret(USERNAME_FILE, 'RXO_USERNAME');
  const password = readSecret(PASSWORD_FILE, 'RXO_PASSWORD');
  try {
    const manifest = await performProductionBatch(username, password, onProgress);
    if (!manifest || manifest.exports.length !== 6 || manifest.exports.some(item => !item.completeness?.complete)) {
      throw new Error('RXO_EXPORT: all six independent datasets must be complete before deployment.');
    }
    return { status: 'PASS', isolated: true, productionDataChanged: false, version: PRODUCTION_VERSION,
      batchId: manifest.batchId, completedAt: manifest.completedAt,
      datasets: manifest.exports.map(exportDatasetEvidence) };
  } finally { await closeProductionBrowser(); }
}

function productionHealth(
  patch
) {
  writeJson(
    healthFile(),
    {
      // Earlier fields first so service/version/updatedAt always reflect this write.
      ...readHealth(),
      service:
        'rxo-fort-wayne-export',
      version:
        PRODUCTION_VERSION,
      updatedAt:
        new Date()
          .toISOString(),
      ...patch,
    }
  );
}

function publishLatest(batchDir, manifest) {
  return publishLatestExports({
    dataDir: DATA_DIR,
    productionPages: PRODUCTION_PAGES,
    exportDirections: EXPORT_DIRECTIONS,
    batchDir,
    manifest,
  });
}

function verifyLatestFortWayneExports(options = {}) {
  return verifyLatestExports({
    dataDir: DATA_DIR,
    productionPages: PRODUCTION_PAGES,
    exportDirections: EXPORT_DIRECTIONS,
    ...options,
  });
}

async function performProductionBatch(
  username,
  password,
  onProgress = () => {}
) {
  if (
    syncInProgress
  ) {
    console.log(
      '[RXO] A production batch is already in progress; skipping overlapping trigger.'
    );

    return null;
  }

  // Cross-process guard: throws RXO_EXPORT_BUSY (without touching health.json)
  // while another exporter, a one-off test run or the interactive login holds it.
  const exportLock = acquireExportLock(DATA_DIR, 'production batch');

  syncInProgress =
    true;

  let id, batchDir;
  try {
    recoverLatestPublication(DATA_DIR);

    id =
      batchId();

    batchDir =
      path.join(
        DATA_DIR,
        'batches',
        id
      );

    mkdirp(
      batchDir
    );
  } catch (error) {
    syncInProgress = false;
    exportLock.release();
    throw error;
  }

  productionHealth({
    status:
      'running',
    currentBatchId:
      id,
    currentStartedAt:
      new Date()
        .toISOString(),
    lastError:
      null,
  });

  console.log('');
  console.log(
    '============================================================'
  );
  console.log(
    ` RXO FORT WAYNE PRODUCTION EXPORT v${PRODUCTION_VERSION}`
  );
  console.log(
    ` Batch: ${id}`
  );
  console.log(
    '============================================================'
  );

  const exports = [];
  const batchWindow = exportWindow();

  try {
    await launchBrowser();

    await ensureAuthenticated(
      browserSession.page,
      username,
      password
    );

    for (
      const pageCase
      of PRODUCTION_PAGES
    ) {
      for (
        const direction
        of EXPORT_DIRECTIONS
      ) {
        onProgress({ status: 'RUNNING', currentDataset: { pageKey: pageCase.key, direction: direction.direction }, completedDatasets: exports.map(exportDatasetEvidence) });
        exports.push(
          await exportOneDirection({
            page:
              browserSession.page,
            pageCase,
            direction,
            batchDir,
            batchWindow,
          }).catch(error => { const wrapped = new Error(`RXO_EXPORT ${pageCase.key} ${direction.direction}: ${error.message}`); wrapped.rxoDateControlDiagnostics = error.rxoDateControlDiagnostics ?? null; wrapped.rxoCoverageDiagnostics = error.rxoCoverageDiagnostics ?? null; wrapped.rxoWorkbookDiagnostics = error.rxoWorkbookDiagnostics ?? null; wrapped.rxoHeaderDiagnostics = error.rxoHeaderDiagnostics ?? null; wrapped.rxoMergeDiagnostics = error.rxoMergeDiagnostics ?? null; wrapped.rxoDownloadDiagnostics = error.rxoDownloadDiagnostics ?? null; wrapped.rxoCompletedDatasets = exports.map(exportDatasetEvidence); throw wrapped; })
        );
        onProgress({ status: 'RUNNING', currentDataset: null, completedDatasets: exports.map(exportDatasetEvidence) });
      }
    }

    onProgress({ status: 'COMPLETE', currentDataset: null, completedDatasets: exports.map(exportDatasetEvidence) });
    exportAssertWindow(batchWindow);
    const manifest = {
      operationalWindow: batchWindow,
      version:
        PRODUCTION_VERSION,
      batchId:
        id,
      source:
        'RXO Connect',
      completedAt:
        new Date()
          .toISOString(),
      status:
        'complete',
      site: {
        key:
          RXO_SITE_KEY,
        name:
          RXO_SITE_NAME,
        requiredIdentifiers: [
          FORT_WAYNE_CODE,
          FORT_WAYNE_LEGACY,
        ],
        rule:
          'Dana Fort Wayne always selects BOTH 12808 and DANA_USA_FORT_WAYNE_IN.',
      },
      directionRule: {
        Origin:
          'OUTBOUND',
        Destination:
          'INBOUND',
      },
      pages:
        PRODUCTION_PAGES.map(
          pageCase => ({
            key:
              pageCase.key,
            name:
              pageCase.name,
            url:
              pageCase.url,
          })
        ),
      exports,
    };

    writeJson(
      path.join(
        batchDir,
        'manifest.json'
      ),
      manifest
    );

    publishLatest(
      batchDir,
      manifest
    );

    // Verify the six XLSX files and manifest from inside the same
    // exporter process while /app/data is already mounted. This avoids a
    // second chain of Docker/SSH verification calls after a successful run.
    verifyLatestFortWayneExports({
      expectedBatchId: id,
      printManifest: false,
    });

    productionHealth({
      status:
        'ok',
      currentBatchId:
        null,
      currentStartedAt:
        null,
      lastSuccessAt:
        new Date()
          .toISOString(),
      lastBatchId:
        id,
      lastError:
        null,
      lastExportCount:
        exports.length,
    });

    console.log('');
    console.log(
      '============================================================'
    );
    console.log(
      `[RXO] PRODUCTION BATCH COMPLETE - ${id}`
    );
    console.log(
      `[RXO] ${exports.length} Fort Wayne export file(s) created.`
    );
    console.log(
      '============================================================'
    );

    return manifest;
  } catch (error) {
    const message =
      error?.message ||
      String(error);

    productionHealth({
      status:
        'error',
      currentBatchId:
        null,
      currentStartedAt:
        null,
      lastFailureAt:
        new Date()
          .toISOString(),
      lastError:
        message,
    });

    try {
      const failedDir =
        path.join(
          DATA_DIR,
          'failed',
          id
        );

      mkdirp(
        failedDir
      );

      if (
        CAPTURE_FAILURE_SCREENSHOT &&
        browserSession.page
      ) {
        await browserSession.page.screenshot({
          path:
            path.join(
              failedDir,
              'failure.png'
            ),
          fullPage:
            true,
        });
      }

      writeJson(
        path.join(
          failedDir,
          'failure.json'
        ),
        {
          batchId:
            id,
          failedAt:
            new Date()
              .toISOString(),
          url:
            browserSession.page
              ?.url?.() ||
            null,
          error:
            message,
          stack:
            error?.stack ||
            null,
        }
      );
    } catch {}

    throw error;
  } finally {
    await closeProductionBrowser();
    pruneExportBatches(id);
    exportLock.release();
    syncInProgress =
      false;
  }
}

// Retention: batches/ keeps the newest successful (manifest.json present) and
// failed/partial batch directories; failed/ keeps the newest failure reports.
// The running batch and the batch latest/ was published from are never removed.
const BATCH_ID = /^\d{8}-\d{6}$/;
const KEEP_SUCCESSFUL_BATCHES = 48;
const KEEP_FAILED_BATCHES = 20;

function publishedBatchId() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'latest', 'manifest.json'), 'utf8')).batchId ?? null;
  } catch {
    return null;
  }
}

function pruneExportBatches(currentId) {
  const log = message => console.log(`[RXO] ${message}`);
  const protect = [currentId, publishedBatchId()];
  try {
    pruneBatchDirectories(path.join(DATA_DIR, 'batches'), {
      keepSuccessful: KEEP_SUCCESSFUL_BATCHES, keepFailed: KEEP_FAILED_BATCHES, protect, log,
      validName: name => BATCH_ID.test(name),
      isSuccessful: (name, dir) => fs.statSync(path.join(dir, 'manifest.json')).isFile(),
    });
    pruneBatchDirectories(path.join(DATA_DIR, 'failed'), {
      keepSuccessful: 1, keepFailed: KEEP_FAILED_BATCHES, protect, log,
      validName: name => BATCH_ID.test(name),
    });
  } catch (error) {
    log(`Batch retention skipped: ${error?.message || error}`);
  }
}

async function runBatchWithRetry(
  username,
  password
) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      if (
        attempt > 1
      ) {
        console.log(
          `[RXO] Retrying production batch - attempt ${attempt}/${MAX_ATTEMPTS}.`
        );
      }

      return await performProductionBatch(
        username,
        password
      );
    } catch (error) {
      lastError =
        error;

      console.error(
        `[RXO] Production attempt ${attempt}/${MAX_ATTEMPTS} failed: ` +
        `${error?.message || error}`
      );

      if (error?.code === 'RXO_EXPORT_BUSY') {
        console.error('[RXO] Another RXO export or interactive login is running; this run did not start and will not retry.');
        throw error;
      }

      if (error?.rxoAuthFailure === true) {
        console.error('[RXO AUTH RXO_AUTH] Sign-in paused for review; no password retry in this batch or future scheduled scans.');
        throw error;
      }

      if (
        attempt <
        MAX_ATTEMPTS
      ) {
        console.log(
          `[RXO] Waiting ${RETRY_DELAY_SECONDS} second(s) before retry...`
        );

        await sleep(
          RETRY_DELAY_SECONDS *
          1000
        );
      }
    }
  }

  throw lastError;
}

export {
  healthFile,
  readHealth,
  productionHealth,
  publishLatest,
  verifyLatestFortWayneExports,
  performProductionBatch,
  runBatchWithRetry,
  exportCandidate,
};
