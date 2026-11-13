import { chromium } from 'playwright';
import { authenticateStandard } from './rxo-auth.mjs';
import { settleRxoUi } from './rxo-filter-ui.mjs';
import { mkdirp } from './rxo-export-runtime.mjs';
import { withTimeout } from './process-lock.mjs';
import { DATA_DIR, FORCE_LOGIN_EACH_RUN, HEADLESS, LOGIN_TIMEOUT_MS, PROFILE_DIR, RXO_URL } from './rxo-export-config.mjs';

/**
 * The one persistent Chromium session of an exporter process. Other modules
 * read and replace the current page through browserSession.
 */
export const browserSession = { context: null, page: null };

async function launchBrowser() {
  if (browserSession.context) {
    return;
  }

  mkdirp(PROFILE_DIR);

  console.log('[RXO] Launching persistent Chromium session...');

  browserSession.context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    acceptDownloads: true,
    viewport: { width: 1600, height: 1000 },
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  browserSession.context.on('close', () => {
    browserSession.context = null;
    browserSession.page = null;
  });

  browserSession.page =
    browserSession.context.pages()[0] ||
    await browserSession.context.newPage();

  browserSession.page.setDefaultTimeout(30000);
}

async function dashboardReady(page, timeout = 5000) {
  try {
    await page
      .getByText(/^Export$/i)
      .last()
      .waitFor({
        state: 'visible',
        timeout,
      });

    return true;
  } catch {
    return false;
  }
}

async function goToRxo(page) {
  await page.goto(RXO_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
}

// RXO_AUTH: the shared gate verifies Orders, NOT Export on the scorecard.
async function ensureAuthenticated(page, username, password) {
  const result = await authenticateStandard(page, {
    username, password, dataRoot: DATA_DIR, timeoutMs: LOGIN_TIMEOUT_MS,
    forceLogin: FORCE_LOGIN_EACH_RUN,
  });
  console.log('[RXO AUTH RXO_AUTH] Orders sign-in verified; password submissions: ' + result.passwordSubmissions);
  await settleRxoUi(page, 'after verified sign-in');
}

// Chromium can hang on close; never let that hold the batch, the export lock
// or the process exit. The entry point force-exits shortly after main settles.
const BROWSER_CLOSE_TIMEOUT_MS = 30_000;

async function closeProductionBrowser() {
  try {
    if (
      browserSession.context
    ) {
      await withTimeout(browserSession.context.close(), BROWSER_CLOSE_TIMEOUT_MS, 'RXO_BROWSER_CLOSE_TIMEOUT');
    }
  } catch (error) {
    if (error?.code === 'RXO_BROWSER_CLOSE_TIMEOUT') console.error('[RXO] Chromium did not close within 30 seconds; continuing.');
  }

  browserSession.context =
    null;

  browserSession.page =
    null;
}

export { launchBrowser, dashboardReady, goToRxo, ensureAuthenticated, closeProductionBrowser };
