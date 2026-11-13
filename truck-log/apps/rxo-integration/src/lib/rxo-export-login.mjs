import path from 'node:path';
import process from 'node:process';
import { PAGE_CASES, collectFilterCandidates } from './rxo-filter-ui.mjs';
import { waitForNamedFilter } from './rxo-filter-readiness.mjs';
import { acquireExportLock, sleep, writeJson } from './rxo-export-runtime.mjs';
import { DATA_DIR, HEADLESS, PROFILE_DIR } from './rxo-export-config.mjs';
import { browserSession, closeProductionBrowser, dashboardReady, goToRxo, launchBrowser } from './rxo-export-browser.mjs';

/** --login-only: a human completes RXO sign-in in the interactive rxo-browser profile. */
async function bootstrapInteractiveSession() {
  if (HEADLESS) throw new Error('--login-only requires the interactive rxo-browser profile. Use BOOTSTRAP-RXO-BROWSER.cmd.');
  const statusFile = path.join(path.dirname(PROFILE_DIR), 'browser-bootstrap.json');
  const status = patch => writeJson(statusFile, { version: process.env.TRUCK_LOG_RELEASE || '1.0.9', session: process.env.RXO_BOOTSTRAP_SESSION || 'manual', updatedAt: new Date().toISOString(), ...patch });
  // Same profile and lock as the exporter: never sign in while an export runs.
  let exportLock;
  try {
    exportLock = acquireExportLock(DATA_DIR, 'interactive login');
  } catch (error) {
    status({ status: 'FAILED', authenticated: false, reason: error?.code === 'RXO_EXPORT_BUSY' ? 'RXO_EXPORT_BUSY' : 'LOCK_FAILED' });
    throw error;
  }
  status({ status: 'WAITING_FOR_LOGIN', authenticated: false });
  try {
    await launchBrowser();
    await goToRxo(browserSession.page);
    // Interactive flow is deliberately human-driven: never fight the user with
    // automated clicks while they resolve consent, organization selection or MFA.
    console.log('[RXO] Complete RXO sign-in in the browser. No password is written to logs.');
    const deadline = Date.now() + 15 * 60 * 1000;
    let lastProbe = 0;
    while (Date.now() < deadline) {
      if (await dashboardReady(browserSession.page, 1000)) {
        if (Date.now() - lastProbe > 15000) {
          lastProbe = Date.now();
          await browserSession.page.goto(PAGE_CASES[0].url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        }
        try {
          await waitForNamedFilter(browserSession.page, 'Origin', { timeoutMs: 3000, legacyCollect: collectFilterCandidates });
          await waitForNamedFilter(browserSession.page, 'Destination', { timeoutMs: 3000, legacyCollect: collectFilterCandidates });
          await closeProductionBrowser(); // flush the shared persistent Chromium profile
          status({ status: 'READY', authenticated: true, originFilterVisible: true, destinationFilterVisible: true });
          console.log('[PASS] RXO browser profile saved; Origin and Destination controls are visible. Export remains untested.');
          return;
        } catch {}
      }
      await sleep(1000);
    }
    status({ status: 'TIMEOUT', authenticated: false });
    throw new Error('Interactive RXO login timed out. The scheduler will be restored by the launcher.');
  } catch (error) {
    status({ status: 'FAILED', authenticated: false });
    throw error;
  } finally { await closeProductionBrowser(); exportLock.release(); }
}

export { bootstrapInteractiveSession };
