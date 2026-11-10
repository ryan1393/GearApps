import { chromium } from 'playwright';
import path from 'node:path';
import process from 'node:process';
import { authenticateStandard } from './lib/rxo-auth.mjs';
import {
  FORT_WAYNE_CODE,
  FORT_WAYNE_LEGACY,
  PAGE_CASES,
  applyFortWayneFilter,
  loadPageForFilterTest,
  settleRxoUi,
  takeShot,
} from './lib/rxo-filter-ui.mjs';
import { batchId, mkdirp, readSecret, writeJson } from './lib/rxo-export-runtime.mjs';

const RXO_BASE = 'https://customer.rxoconnect.rxo.com';
const DATA_DIR = path.resolve(process.env.RXO_DATA_DIR || '/app/data');
const PROFILE_DIR = path.resolve(process.env.RXO_PROFILE_DIR || '/app/state/profile');
const FILTER_TEST_DIR = path.join(DATA_DIR, 'filter-tests');
const USERNAME_FILE = process.env.RXO_USERNAME_FILE || '/run/secrets/rxo_username';
const PASSWORD_FILE = process.env.RXO_PASSWORD_FILE || '/run/secrets/rxo_password';
const HEADLESS = !/^(0|false|no)$/i.test(process.env.RXO_HEADLESS || 'true');
const FORCE_LOGIN_EACH_RUN = /^(1|true|yes)$/i.test(process.env.RXO_FORCE_LOGIN_EACH_RUN || 'false');
const LOGIN_TIMEOUT_MS = Math.max(30000, Number(process.env.RXO_LOGIN_TIMEOUT_MS || 120000));

let browserContext = null;
let browserPage = null;

async function launchBrowser() {
  if (browserContext) return;

  mkdirp(PROFILE_DIR);
  browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
  });

  browserPage = browserContext.pages()[0] || await browserContext.newPage();
  browserPage.setDefaultTimeout(30000);
  browserPage.setDefaultNavigationTimeout(60000);
}

async function ensureAuthenticated(page, username, password) {
  const result = await authenticateStandard(page, {
    username,
    password,
    dataRoot: DATA_DIR,
    timeoutMs: LOGIN_TIMEOUT_MS,
    forceLogin: FORCE_LOGIN_EACH_RUN,
  });
  console.log(
    '[RXO FILTER TEST] Orders sign-in verified; password submissions: ' +
      result.passwordSubmissions
  );
  await settleRxoUi(page, 'after verified sign-in');
}

async function testDirection(page, pageCase, label, caseDir) {
  await loadPageForFilterTest(page, pageCase, label);
  return await applyFortWayneFilter(page, label, caseDir);
}

async function testPage(page, testRoot, pageCase) {
  const caseDir = path.join(testRoot, pageCase.key);
  mkdirp(caseDir);

  console.log('');
  console.log('============================================================');
  console.log(`[RXO] FILTER TEST PAGE: ${pageCase.name}`);
  console.log(`[RXO] ${pageCase.url}`);
  console.log('============================================================');

  const result = {
    key: pageCase.key,
    name: pageCase.name,
    requestedUrl: pageCase.url,
    origin: null,
    destination: null,
    status: 'PASS',
  };

  try {
    console.log(`[RXO] ${pageCase.name}: testing Origin...`);
    result.origin = await testDirection(page, pageCase, 'Origin', caseDir);
    console.log(`[RXO] ${pageCase.name}: ORIGIN PASS.`);
  } catch (error) {
    result.origin = {
      status: 'FAIL',
      error: error?.message || String(error),
      actualUrl: page.url(),
    };
    result.status = 'FAIL';
    console.error(`[RXO] ${pageCase.name}: ORIGIN FAIL - ${result.origin.error}`);
    await takeShot(page, caseDir, 'origin-failure');
  }

  try {
    console.log(`[RXO] ${pageCase.name}: testing Destination...`);
    result.destination = await testDirection(page, pageCase, 'Destination', caseDir);
    console.log(`[RXO] ${pageCase.name}: DESTINATION PASS.`);
  } catch (error) {
    result.destination = {
      status: 'FAIL',
      error: error?.message || String(error),
      actualUrl: page.url(),
    };
    result.status = 'FAIL';
    console.error(`[RXO] ${pageCase.name}: DESTINATION FAIL - ${result.destination.error}`);
    await takeShot(page, caseDir, 'destination-failure');
  }

  writeJson(path.join(caseDir, 'result.json'), result);
  return result;
}

async function runFilterTest() {
  mkdirp(DATA_DIR);
  mkdirp(PROFILE_DIR);
  mkdirp(FILTER_TEST_DIR);

  const username = readSecret(USERNAME_FILE, 'RXO_USERNAME');
  const password = readSecret(PASSWORD_FILE, 'RXO_PASSWORD');
  const id = batchId();
  const testRoot = path.join(FILTER_TEST_DIR, id);
  mkdirp(testRoot);

  console.log('');
  console.log('RXO Fort Wayne Filter Test');
  console.log('--------------------------------');
  console.log('[RXO] Uses the same shared filter implementation as production.');
  console.log(`[RXO] Required: ${FORT_WAYNE_CODE} + ${FORT_WAYNE_LEGACY}.`);
  console.log('');

  await launchBrowser();

  try {
    await ensureAuthenticated(browserPage, username, password);

    const results = [];
    for (const pageCase of PAGE_CASES) {
      results.push(await testPage(browserPage, testRoot, pageCase));
    }

    const failures = results.filter(item => item.status !== 'PASS');
    const summary = {
      version: process.env.TRUCK_LOG_RELEASE || '1.0.4',
      testId: id,
      completedAt: new Date().toISOString(),
      implementation: 'SHARED_PRODUCTION_FILTER_UI',
      confirmedDom: {
        panel: '.mat-select-panel.multi-select-autocomplete-panel',
        searchInputExamples: [
          'input[placeholder="Origin"]',
          'input[data-placeholder="Origin"]',
          'input[placeholder="Destination"]',
          'input[data-placeholder="Destination"]',
        ],
        shipmentsUrl: `${RXO_BASE}/shipment-freight`,
      },
      fortWayne: {
        requiredTogether: [FORT_WAYNE_CODE, FORT_WAYNE_LEGACY],
      },
      pages: results,
      passed: failures.length === 0,
      failedPageCount: failures.length,
    };

    writeJson(path.join(testRoot, 'summary.json'), summary);
    writeJson(path.join(FILTER_TEST_DIR, 'latest-summary.json'), summary);

    console.log('');
    console.log('============================================================');
    console.log(' RXO FORT WAYNE FILTER TEST SUMMARY');
    console.log('============================================================');
    for (const result of results) {
      console.log(`[RXO] ${result.name}: ${result.status}`);
      console.log(`[RXO]   Origin: ${result.origin?.status || 'UNKNOWN'}`);
      console.log(`[RXO]   Destination: ${result.destination?.status || 'UNKNOWN'}`);
    }
    console.log('============================================================');

    if (failures.length) {
      throw new Error(`${failures.length} RXO page(s) failed the Fort Wayne filter test.`);
    }

    console.log('[RXO] ALL FORT WAYNE FILTER TESTS PASSED.');
  } finally {
    try {
      if (browserContext) await browserContext.close();
    } catch {}
  }
}

runFilterTest().catch(error => {
  console.error('');
  console.error('[RXO] FILTER TEST FAILED: ' + `${error?.message || error}`);
  process.exitCode = 1;
});
