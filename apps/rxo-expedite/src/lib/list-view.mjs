import { classifyLoginMessage, RxoAuthError } from './rxo-auth.mjs';
import { ExpediteError } from './workbook.mjs';

const LIST = /^\s*list\s*$/i;
const EXCEL = /^\s*export to excel\s*$/i;
const INTERACTIVE = 'button:visible, a:visible, [role="button"]:visible, [role="tab"]:visible, [role="radio"]:visible, [ng-click]:visible, [data-ng-click]:visible, [onclick]:visible, .btn:visible, .k-button:visible';

/** A lost session must return to the sign-in recovery flow, never be clicked through. */
export async function assertFreightSession(page) {
  let url;
  try { url = new URL(page.url()); } catch { throw new RxoAuthError('RXO_AUTH_ORIGIN_REVIEW'); }
  if (url.origin !== 'https://www.expedite.rxo.com') throw new RxoAuthError('RXO_AUTH_ORIGIN_REVIEW');
  if (/^\/WebClient\/Account\//i.test(url.pathname)) throw new RxoAuthError('RXO_AUTH_SESSION_REVIEW');
  for (const frame of page.frames()) {
    if (await frame.locator('input[autocomplete="one-time-code"]:visible, input[name*="otp" i]:visible, input[id*="otp" i]:visible').count()) {
      throw new RxoAuthError('RXO_AUTH_VERIFICATION_REQUIRED');
    }
    if (await frame.locator('input[type="password"]:visible').count()) throw new RxoAuthError('RXO_AUTH_SESSION_REVIEW');
    const alerts = frame.locator('[role="alert"]:visible, [role="dialog"]:visible, .validation-summary-errors:visible, .alert-danger:visible');
    for (let index = 0; index < await alerts.count(); index++) {
      const code = classifyLoginMessage(await alerts.nth(index).innerText({ timeout: 1000 }).catch(() => ''));
      if (code) throw new RxoAuthError(code);
    }
  }
  if (!/^\/WebClient\/?$/i.test(url.pathname) || !/^#\/?freight-on-the-move(?:[/?]|$)/i.test(url.hash)) {
    throw new RxoAuthError('RXO_AUTH_APP_NOT_READY');
  }
}

export function excelControls(page) { return page.locator(INTERACTIVE).filter({ hasText: EXCEL }); }

async function hasListExport(page) { return await excelControls(page).count() === 1; }

/** Select List once; native export/data checks, rather than a navigation load event, prove readiness. */
export async function openFreightList(page, { timeoutMs = 30000 } = {}) {
  await assertFreightSession(page);
  // RXO restores the previous view in a persistent profile. Re-clicking its active List
  // link can start another legacy navigation while that view is still fetching data.
  if (await hasListExport(page)) return;
  const interactive = page.locator(INTERACTIVE).filter({ hasText: LIST });
  const label = page.locator('label:visible').filter({ hasText: LIST });
  try { await interactive.or(label).first().waitFor({ state: 'visible', timeout: timeoutMs }); }
  catch {
    await assertFreightSession(page);
    throw new ExpediteError('FREIGHT_LIST_CONTROL_TIMEOUT');
  }
  await assertFreightSession(page);
  const controls = await interactive.count(), labels = await label.count();
  if (!(controls === 1 || (controls === 0 && labels === 1))) throw new ExpediteError('FREIGHT_LIST_CONTROL_REVIEW');
  const target = controls === 1 ? interactive.first() : label.first();
  const radios = page.getByRole('radio', { name: LIST }).and(page.locator('input[type="radio"]:visible'));
  const radioCount = await radios.count();
  if (radioCount > 1) throw new ExpediteError('FREIGHT_LIST_CONTROL_REVIEW');
  try {
    // A legacy Angular link can leave a document load pending after its click has
    // already rendered List. Never force a click through an RXO loading overlay.
    // Native radios can sit over their styled labels. Check the associated control
    // directly when visible; check() also leaves an already-selected List alone.
    if (radioCount === 1) await radios.first().check({ timeout: timeoutMs, noWaitAfter: true });
    else await target.click({ timeout: timeoutMs, noWaitAfter: true });
  } catch (error) {
    await assertFreightSession(page);
    if (await hasListExport(page)) return;
    if (error?.name === 'TimeoutError') throw new ExpediteError('FREIGHT_LIST_CONTROL_TIMEOUT');
    throw error;
  }
}
