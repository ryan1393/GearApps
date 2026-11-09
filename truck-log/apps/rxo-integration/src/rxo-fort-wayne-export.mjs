// Standard RXO Fort Wayne exporter entry point. The work lives in lib/:
//   rxo-export-config.mjs   environment, site identity, page/direction datasets
//   rxo-export-browser.mjs  persistent Chromium session and verified sign-in
//   rxo-export-download.mjs Export click, download wait/retry, workbook checks
//   rxo-export-dataset.mjs  per-direction filtering and complete-dataset merge
//   rxo-export-batch.mjs    one production batch, health, publication, retries
//   rxo-export-login.mjs    --login-only interactive bootstrap
import {
  collectFilterCandidates,
  filterPanelLocator,
  loadPageForFilterTest,
  openFilter,
  pageReadyForFilters,
} from './lib/rxo-filter-ui.mjs';
import { FORT_WAYNE_CODE, FORT_WAYNE_LEGACY } from './lib/rxo-filter-ui.mjs';
import { mkdirp, readSecret, sha256File, sleep } from './lib/rxo-export-runtime.mjs';
import { exportReadWorkbook, exportWindow } from './lib/rxo-export-data.mjs';
import { exportApplyRange } from './lib/rxo-export-date-filter.mjs';
import { exportMergeTables } from './lib/rxo-export-merge.mjs';
import {
  DATA_DIR,
  INTERVAL_MINUTES,
  LOGIN_ONLY,
  PASSWORD_FILE,
  PRODUCTION_PAGES,
  PRODUCTION_VERSION,
  PROFILE_DIR,
  RUN_ONCE,
  RXO_SITE_NAME,
  SYNC_ON_START,
  USERNAME_FILE,
} from './lib/rxo-export-config.mjs';
import { closeProductionBrowser } from './lib/rxo-export-browser.mjs';
import { exportCompleteDataset } from './lib/rxo-export-dataset.mjs';
import { exportCandidate, runBatchWithRetry, verifyLatestFortWayneExports } from './lib/rxo-export-batch.mjs';
import { bootstrapInteractiveSession } from './lib/rxo-export-login.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

let shuttingDown = false;

async function mainProduction() {
  console.log('[RXO] Runtime SHA-256: ' + sha256File(fileURLToPath(import.meta.url)));
  if (LOGIN_ONLY) { await bootstrapInteractiveSession(); return; }

  mkdirp(
    DATA_DIR
  );
  mkdirp(
    PROFILE_DIR
  );

  if (process.argv.includes('--verify-latest')) {
    verifyLatestFortWayneExports({
      printManifest: true,
    });
    return;
  }

  const username =
    readSecret(
      USERNAME_FILE,
      'RXO_USERNAME'
    );

  const password =
    readSecret(
      PASSWORD_FILE,
      'RXO_PASSWORD'
    );

  console.log('');
  console.log(
    `RXO Fort Wayne Production Export v${PRODUCTION_VERSION}`
  );
  console.log(
    '------------------------------------------'
  );
  console.log(
    `[RXO] Site: ${RXO_SITE_NAME}`
  );
  console.log(
    `[RXO] Required: ${FORT_WAYNE_CODE} + ${FORT_WAYNE_LEGACY}`
  );
  console.log(
    `[RXO] Pages: ${PRODUCTION_PAGES.map(item => item.name).join(', ')}`
  );
  console.log(
    '[RXO] Direction rule: Origin=OUTBOUND, Destination=INBOUND'
  );
  console.log(
    `[RXO] Interval: ${INTERVAL_MINUTES} minute(s)`
  );
  console.log('');

  if (
    RUN_ONCE
  ) {
    await runBatchWithRetry(
      username,
      password
    );
    return;
  }

  if (
    SYNC_ON_START
  ) {
    await runBatchWithRetry(
      username,
      password
    );
  }

  while (
    !shuttingDown
  ) {
    console.log(
      `[RXO] Next production sync in ${INTERVAL_MINUTES} minute(s).`
    );

    await sleep(
      INTERVAL_MINUTES *
      60 *
      1000
    );

    if (
      shuttingDown
    ) {
      break;
    }

    try {
      await runBatchWithRetry(
        username,
        password
      );
    } catch (error) {
      console.error(
        `[RXO] Scheduled production batch exhausted retries: ${error?.message || error}`
      );
    }
  }
}

async function shutdownProduction(
  signal
) {
  if (
    shuttingDown
  ) {
    return;
  }

  shuttingDown =
    true;

  console.log(
    `[RXO] ${signal} received; shutting down...`
  );

  await closeProductionBrowser();

  process.exit(0);
}

process.on(
  'SIGINT',
  () => {
    shutdownProduction(
      'SIGINT'
    );
  }
);

process.on(
  'SIGTERM',
  () => {
    shutdownProduction(
      'SIGTERM'
    );
  }
);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
mainProduction()
  .catch(async error => {
    console.error('');
    console.error(
      '[RXO] PRODUCTION EXPORT FAILED: ' +
      `${error?.stack || error}`
    );

    await closeProductionBrowser();

    process.exitCode =
      1;
  })
  .finally(() => {
    // A wedged Chromium child must not keep a finished one-shot run alive
    // (the scheduler would otherwise see no exit and treat it as a stall).
    setTimeout(() => process.exit(process.exitCode ?? 0), 5_000).unref();
  });

}

// Direct production-function regression tests; importing does not log in or export.
export { pageReadyForFilters, loadPageForFilterTest, openFilter, filterPanelLocator, collectFilterCandidates, exportCandidate, exportReadWorkbook, exportWindow, exportMergeTables, exportCompleteDataset, exportApplyRange };
