import fs from 'node:fs';
import path from 'node:path';
import { visibleItems } from './rxo-filter-ui.mjs';
import { looksLikeXlsx, mkdirp, sha256File } from './rxo-export-runtime.mjs';
import { exportReadWorkbook } from './rxo-export-data.mjs';
import { exportSuppressSurvey } from './rxo-export-date-filter.mjs';
import { DATA_DIR, DOWNLOAD_TIMEOUT_MS } from './rxo-export-config.mjs';

// RXO_EXPORT: one page-scoped download attempt. Diagnostics contain counts and
// codes, never request URLs, query strings, headers, cookies or bodies.
function exportDownloadRoute(page, expectedUrl) {
  try {
    if (page.isClosed()) return 'PAGE_CLOSED';
    const actual = new URL(page.url()), expected = new URL(expectedUrl);
    return actual.origin === expected.origin && actual.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '')
      ? 'EXPECTED_DATASET_PAGE' : 'ROUTE_CHANGED';
  } catch { return 'UNVERIFIED_PAGE'; }
}

async function exportWaitForDownload({ page, pageCase, direction, click, timeoutMs = DOWNLOAD_TIMEOUT_MS }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('RXO download timeout is not a finite positive duration.');
  const started = Date.now(), httpStatuses = {}, rxoHttpStatuses = {}, networkFailures = {};
  let stage = 'WAITING_FOR_DOWNLOAD', settled = false, resolveWait, timer, progress;
  let popupCount = 0, observedDownload = null;
  const promise = new Promise(resolve => { resolveWait = resolve; });
  const route = () => exportDownloadRoute(page, pageCase.url);
  const snapshot = () => ({ pageKey: pageCase.key, direction: direction.direction, stage,
    timeoutMs, elapsedMs: Date.now() - started, routeState: route(), popupCount,
    httpStatuses: { ...httpStatuses }, rxoHttpStatuses: { ...rxoHttpStatuses }, networkFailures: { ...networkFailures } });
  const errorFor = (code, message) => {
    const error = new Error(`${pageCase.name} ${direction.direction}: ${message}`);
    error.code = code; error.rxoDownloadDiagnostics = { ...snapshot(), code };
    return error;
  };
  const finish = result => { if (!settled) { settled = true; clearTimeout(timer); clearInterval(progress); resolveWait(result); } };
  const onDownload = download => { observedDownload = download; stage = 'DOWNLOAD_STARTED'; finish({ download }); };
  const onClose = () => finish({ error: errorFor('RXO_DOWNLOAD_PAGE_CLOSED', 'export page closed before the download started.') });
  const onPopup = () => { popupCount++; };
  const onResponse = response => {
    try {
      const status = response.status();
      if (!Number.isInteger(status) || status < 100 || status > 599) return;
      httpStatuses[status] = (httpStatuses[status] || 0) + 1;
      const host = new URL(response.url()).hostname;
      if ((host === 'rxo.com' || host.endsWith('.rxo.com')) && ['xhr','fetch'].includes(response.request().resourceType())) {
        rxoHttpStatuses[status] = (rxoHttpStatuses[status] || 0) + 1;
      }
    } catch { /* Optional evidence must not disrupt the download. */ }
  };
  const onRequestFailed = request => {
    try {
      const raw = String(request.failure()?.errorText || '');
      const code = /^net::ERR_[A-Z_]+$/.test(raw) ? raw : 'REQUEST_FAILED';
      networkFailures[code] = (networkFailures[code] || 0) + 1;
    } catch { networkFailures.REQUEST_FAILED = (networkFailures.REQUEST_FAILED || 0) + 1; }
  };
  const handlers = [['download', onDownload], ['close', onClose], ['popup', onPopup], ['response', onResponse], ['requestfailed', onRequestFailed]];
  try {
    if (route() !== 'EXPECTED_DATASET_PAGE') throw errorFor('RXO_DOWNLOAD_WRONG_PAGE', 'dataset page could not be verified before Export.');
    for (const [event, handler] of handlers) page.on(event, handler);
    timer = setTimeout(() => finish({ error: errorFor('RXO_DOWNLOAD_START_TIMEOUT', `download did not start within ${Math.round(timeoutMs / 1000)} seconds.`) }), timeoutMs);
    progress = setInterval(() => console.log(`[RXO RXO_EXPORT] ${pageCase.name} ${direction.direction}: waiting for download (${Math.floor((Date.now() - started) / 1000)} seconds).`), 30000);
    try { await click(); }
    catch (cause) {
      stage = 'EXPORT_CLICK_FAILED';
      const error = errorFor('RXO_EXPORT_CLICK_FAILED', 'Export click failed before the download could be verified.');
      error.cause = cause; throw error;
    }
    const result = await promise;
    if (result.error) throw result.error;
    if (route() !== 'EXPECTED_DATASET_PAGE') throw errorFor('RXO_DOWNLOAD_WRONG_PAGE', 'dataset page changed while waiting for the download.');
    return { download: result.download, evidence: snapshot() };
  } catch (error) {
    // The wait promise always resolves an outcome; a failed click or closed
    // page cannot leave an unhandled rejected download promise behind.
    finish({ error });
    if (observedDownload) await observedDownload.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer); clearInterval(progress);
    for (const [event, handler] of handlers) page.removeListener(event, handler);
  }
}

function exportCanRetryDownload(error) {
  const evidence = error?.rxoDownloadDiagnostics;
  return error?.code === 'RXO_DOWNLOAD_START_TIMEOUT' && evidence?.stage === 'WAITING_FOR_DOWNLOAD' &&
    evidence.routeState === 'EXPECTED_DATASET_PAGE' && !evidence.rxoHttpStatuses?.[401] &&
    !evidence.rxoHttpStatuses?.[403] && !evidence.rxoHttpStatuses?.[429];
}

async function exportFreshDownloadPage(previous) {
  if (previous.isClosed()) throw new Error('RXO retry cannot reuse a closed browser page.');
  const fresh = await previous.context().newPage();
  try {
    fresh.setDefaultTimeout(30000);
    await previous.close({ runBeforeUnload: false });
    if (!previous.isClosed()) throw new Error('RXO retry could not close the timed-out page.');
    return fresh;
  } catch (error) {
    await fresh.close({ runBeforeUnload: false }).catch(() => {});
    throw error;
  }
}

async function exportDownloadVerified(options, verifyState = async () => {}) {
  const attempts = [], downloadFailures = [];
  let downloadAttempts = 0, retried = false;
  const attach = error => {
    if (downloadFailures.length) error.rxoDownloadDiagnostics = {
      ...(error.rxoDownloadDiagnostics || {}), pageKey: options.pageCase.key, direction: options.direction.direction,
      downloadAttempts, freshPageRetryUsed: retried, priorFailures: downloadFailures,
    };
    return error;
  };
  for (let attempt = 1; attempt <= 3;) {
    let download;
    try {
      await verifyState();
      downloadAttempts++;
      download = await clickExportAndSave(options);
    } catch (error) {
      if (exportCanRetryDownload(error) && !retried && typeof options.recoverDownload === 'function') {
        downloadFailures.push({ code: error.code, ...error.rxoDownloadDiagnostics });
        retried = true;
        console.log(`[RXO RXO_EXPORT] ${options.pageCase.key} ${options.direction.direction}: download timed out; one retry will close the old page and reverify all filters.`);
        try { await options.recoverDownload(); }
        catch (recoveryError) { throw attach(recoveryError); }
        continue;
      }
      throw attach(error);
    }
    try {
      const table = exportReadWorkbook(options.destination, options.pageCase.key);
      return { ...download, downloadValidation: { verified: true, attempts: downloadAttempts,
        freshPageRetryUsed: retried, priorFailures: downloadFailures, lastAttempt: download.transport ?? null },
        workbookValidation: { verified: true, attempts: attempt,
        sourceRows: table.sourceRows, sha256: table.sha256, failedDownloads: attempts } };
    } catch (cause) {
      const retained = options.destination + '.unreadable-' + attempt + '.xlsx';
      fs.copyFileSync(options.destination, retained);
      attempts.push({ attempt, file: path.basename(retained), sha256: sha256File(retained),
        error: String(cause?.message || cause).slice(0, 400) });
      if (attempt === 3) {
        const error = new Error(`RXO_EXPORT ${options.pageCase.key} ${options.direction.direction}: workbook could not be parsed after 3 downloads; no export was accepted.`);
        error.rxoWorkbookDiagnostics = { pageKey: options.pageCase.key, direction: options.direction.direction, attempts };
        throw attach(error);
      }
      console.log(`[RXO RXO_EXPORT] ${options.pageCase.key} ${options.direction.direction}: unreadable workbook retained; downloading again (${attempt + 1}/3).`);
      await options.page.waitForTimeout(1200);
      attempt++;
    }
  }
}

async function findExportControl(
  page
) {
  const candidates = [
    page.getByRole(
      'button',
      {
        name:
          /^Export$/i,
      }
    ),
    page.getByRole(
      'link',
      {
        name:
          /^Export$/i,
      }
    ),
    page.locator(
      'button[aria-label*="export" i]'
    ),
    page.locator(
      'a[aria-label*="export" i]'
    ),
    page.locator(
      '[title*="export" i]'
    ),
    page
      .locator('button')
      .filter({
        hasText:
          /^Export$/i,
      }),
    page
      .locator('a')
      .filter({
        hasText:
          /^Export$/i,
      }),
    page.getByText(
      /^Export$/i
    ),
  ];

  const deadline =
    Date.now() +
    30000;

  while (
    Date.now() <
    deadline
  ) {
    for (
      const locator
      of candidates
    ) {
      const items =
        await visibleItems(
          locator
        );

      if (
        items.length
      ) {
        return items[
          items.length -
          1
        ];
      }
    }

    await page.waitForTimeout(
      400
    );
  }

  return null;
}

async function clickExportAndSave({
  page,
  pageCase,
  direction,
  destination,
}) {
  const exportControl =
    await findExportControl(
      page
    );

  if (
    !exportControl
  ) {
    throw new Error(
      `${pageCase.name} ${direction.direction}: Export control did not appear within 30 seconds.`
    );
  }

  console.log(
    `[RXO] ${pageCase.name} ${direction.direction}: clicking Export...`
  );

  await exportSuppressSurvey(page);
  const received = await exportWaitForDownload({ page, pageCase, direction,
    click: () => exportControl.click({ timeout: 10000 }) });
  const download = received.download;

  const failure =
    await download.failure();

  if (
    failure
  ) {
    throw new Error(
      `${pageCase.name} ${direction.direction}: RXO download failed: ${failure}`
    );
  }

  mkdirp(
    path.dirname(
      destination
    )
  );

  await download.saveAs(
    destination
  );

  const stat =
    fs.statSync(
      destination
    );

  if (
    !stat.isFile() ||
    stat.size <= 0
  ) {
    throw new Error(
      `${pageCase.name} ${direction.direction}: downloaded file is empty.`
    );
  }

  if (
    !looksLikeXlsx(
      destination
    )
  ) {
    throw new Error(
      `${pageCase.name} ${direction.direction}: RXO download is not an XLSX file.`
    );
  }

  console.log(
    `[RXO] ${pageCase.name} ${direction.direction}: saved ` +
    `${stat.size.toLocaleString()} bytes.`
  );

  return {
    file:
      path.basename(
        destination
      ),
    relativePath:
      path.relative(
        DATA_DIR,
        destination
      ),
    transport: received.evidence,
    suggestedFilename:
      download.suggestedFilename(),
    bytes:
      stat.size,
    sha256:
      sha256File(
        destination
      ),
  };
}

export {
  exportDownloadRoute,
  exportWaitForDownload,
  exportCanRetryDownload,
  exportFreshDownloadPage,
  exportDownloadVerified,
  findExportControl,
  clickExportAndSave,
};
