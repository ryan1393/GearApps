import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const angularRoot = process.env.DANA_TEST_ANGULAR_ROOT || path.resolve('../../..');
const angularRequire = angularRoot ? createRequire(path.resolve(angularRoot, 'package.json')) : undefined;
const bundle = await build({
  entryPoints: ['tools/browser/fixture.mjs'], bundle: true, format: 'iife',
  target: 'es2022', write: false,
  plugins: angularRequire ? [{ name: 'angular-compatibility-runtime', setup(build) {
    build.onResolve({ filter: /^@angular\// }, args => ({ path: angularRequire.resolve(args.path) }));
  } }] : [],
});
// Resolve CSS imports without a web server. Keep asset references relative to the package.
const flatten = file => fs.readFileSync(file, 'utf8')
  .replace(/url\(["']?([^"')]+)["']?\)/g, (_, rel) => {
    const asset = path.resolve(path.dirname(file), rel);
    assert.ok(fs.existsSync(asset), `Packaged CSS asset missing: ${asset}`);
    return `url("data:image/svg+xml;base64,${fs.readFileSync(asset).toString('base64')}")`;
  })
  .replace(/@import ['"]([^'"]+)['"];?/g,
    (_, rel) => flatten(path.resolve(path.dirname(file), rel)));
const executablePath = process.env.CHROMIUM_EXECUTABLE || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<style>${flatten('../../../dist/libs/shared/dana-ui/styles/dana-ui.css')}</style><dana-test-fixture></dana-test-fixture>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.fixture || window.fixtureError);
  assert.equal(await page.evaluate(() => window.fixtureError), undefined);

  assert.equal(await page.locator('[danaKpiGrid]').evaluate(el => getComputedStyle(el).display), 'grid');
  assert.equal(await page.locator('[danaKpiCard]').first().evaluate(el => getComputedStyle(el).borderTopWidth), '1px');
  assert.equal(await page.locator('[danaOperationGrid]').evaluate(el => getComputedStyle(el).display), 'grid');
  assert.equal(await page.locator('[danaOperationCard]').evaluate(el => getComputedStyle(el).display), 'grid');
  assert.equal(await page.locator('[danaOperationCard] .dana-glyph').evaluate(el => getComputedStyle(el).width), '22px');
  assert.equal(await page.locator('[danaDashboardGrid]').evaluate(el => getComputedStyle(el).display), 'grid');
  assert.equal(await page.locator('[danaDashboardPanel]').evaluate(el => getComputedStyle(el).borderTopWidth), '1px');

  // Disabled actions are neutral and readable, and say why while they stay disabled.
  const save = page.locator('#save');
  assert.equal(await save.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(236, 238, 241)');
  assert.equal(await save.evaluate(el => getComputedStyle(el).color), 'rgb(91, 101, 115)');
  assert.equal(await save.evaluate(el => getComputedStyle(el).cursor), 'not-allowed');
  assert.equal(await save.evaluate(el => getComputedStyle(el).opacity), '1');
  await page.waitForFunction(() => document.querySelector('#save + .dana-disabled-reason')?.textContent === 'Scan a tray first.');
  const reasonId = await page.locator('#save + .dana-disabled-reason').getAttribute('id');
  assert.equal(await save.getAttribute('aria-describedby'), reasonId);
  await page.evaluate(() => { window.fixture.instance.saveBlocked = false; window.fixture.changeDetectorRef.detectChanges(); });
  await page.waitForFunction(() => !document.querySelector('.dana-disabled-reason'));
  assert.equal(await save.getAttribute('aria-describedby'), null);
  await page.evaluate(() => { window.fixture.instance.saveBlocked = true; window.fixture.changeDetectorRef.detectChanges(); });
  await page.waitForFunction(() => document.querySelector('#save')?.getAttribute('aria-describedby') === document.querySelector('#save + .dana-disabled-reason')?.id);

  // Disabling an unfocused but open list must remove it and block stale actions.
  await page.locator('#direct .dana-combobox-toggle').click();
  assert.equal(await page.locator('#direct input').evaluate(el => el === document.activeElement), false);
  await page.evaluate(() => { window.fixture.instance.disabled = true; window.fixture.changeDetectorRef.detectChanges(); });
  assert.equal(await page.locator('#direct .dana-combobox-panel').count(), 0);
  assert.equal(await page.locator('#direct input').isDisabled(), true);
  await page.evaluate(() => { window.fixture.instance.disabled = false; window.fixture.changeDetectorRef.detectChanges(); });
  await page.locator('#direct input').fill('Beta');
  await page.locator('#direct input').press('Enter');
  await page.waitForFunction(() => window.fixture.instance.value === 'Beta');

  // A search without a candidate cannot submit an old selected ID; Escape restores its label.
  await page.locator('#direct input').fill('No matching option');
  await page.locator('#direct input').press('ArrowUp');
  assert.equal(await page.locator('#direct input').getAttribute('aria-activedescendant'), null);
  await page.locator('#direct input').press('Enter');
  assert.equal(await page.evaluate(() => window.fixture.instance.submitCount), 0);
  assert.equal(await page.evaluate(() => window.fixture.instance.value), 'Beta');
  await page.locator('#direct input').press('Escape');
  await page.waitForFunction(() => document.querySelector('#direct input').value === 'Beta');
  assert.equal(await page.locator('#direct input').inputValue(), 'Beta');
  assert.equal(await page.locator('#direct input').evaluate(el => getComputedStyle(el).outlineWidth), '2px');

  await page.locator('#reactive .dana-combobox-toggle').click();
  await page.evaluate(() => { window.fixture.instance.control.disable(); window.fixture.changeDetectorRef.detectChanges(); });
  assert.equal(await page.locator('#reactive .dana-combobox-panel').count(), 0);
  assert.equal(await page.locator('#reactive input').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.fixture.instance.control.value), '');

  if (!await page.locator('#direct .dana-combobox-panel').count()) await page.locator('#direct .dana-combobox-toggle').click();
  await page.locator('#direct .dana-combobox-panel').waitFor({ state: 'visible' });
  await page.locator('#overflow').evaluate(el => { el.scrollTop = 15; });
  await page.waitForFunction(() => {
    const input = document.querySelector('#direct').getBoundingClientRect();
    const panelElement = document.querySelector('#direct .dana-combobox-panel');
    if (!panelElement) return false;
    const panel = panelElement.getBoundingClientRect();
    return Math.abs(panel.top - input.bottom - 6) < 1;
  });
  await page.locator('#direct input').press('Escape');

  // Document/window listeners exist only while a filter popover is open.
  const cdp = await page.context().newCDPSession(page);
  const listenerTypes = async expression => {
    const { result } = await cdp.send('Runtime.evaluate', { expression });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    return listeners.map(listener => listener.type);
  };
  const popoverListeners = async () => {
    const types = [...await listenerTypes('document'), ...await listenerTypes('window')];
    return types.filter(type => ['keydown', 'scroll', 'resize'].includes(type)).length;
  };
  const listenersWhileClosed = await popoverListeners();

  // Use the generated filter to filter real rows, then close with Escape and restore focus.
  assert.equal(await page.locator('.dana-table-filter-popover').count(), 2);
  const trigger = page.locator('#table .dana-table-filter-trigger').first();
  await trigger.click();
  assert.equal(await popoverListeners(), listenersWhileClosed + 3, 'an open filter listens for Escape, scroll and resize');
  const popover = page.locator('.dana-table-filter-popover:visible');
  assert.equal(await popover.evaluate(el => getComputedStyle(el).position), 'fixed');
  const search = popover.locator('input');
  await search.fill('Alpha');
  await page.waitForFunction(() => [...document.querySelectorAll('#table tbody tr')].filter(el => getComputedStyle(el).display !== 'none').length === 1);
  assert.match(await page.locator('#table tbody tr:visible').textContent(), /Alpha/);
  await search.press('Escape');
  assert.equal(await popover.count(), 0);
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  assert.equal(await popoverListeners(), listenersWhileClosed, 'closing the filter removes its document/window listeners');
  assert.equal(await page.locator('#table th').first().getAttribute('role'), null, 'native column-header semantics retained');
  // Application controls in a header retain their click/keyboard behavior without sorting.
  await page.locator('#header-action').click();
  await page.locator('#header-action').press('Space');
  assert.equal(await page.evaluate(() => window.fixture.instance.headerActionCount), 2);
  assert.equal(await page.locator('#table th').first().getAttribute('aria-sort'), 'none');
  await page.locator('#table th').last().click();
  assert.equal(await page.locator('#table th').last().getAttribute('aria-sort'), 'ascending');

  // Sortable headers render a real button with the header text; the header keeps its own name.
  const firstRowName = () => page.evaluate(() => document.querySelector('#table tbody tr td').firstChild.textContent.trim());
  const loadHeader = page.locator('#table th').last();
  assert.equal(await loadHeader.getAttribute('aria-label'), null);
  assert.equal(await loadHeader.getAttribute('tabindex'), null);
  const loadSort = page.getByRole('button', { name: 'Load', exact: true });
  assert.equal(await loadSort.evaluate(el => el.matches('th > button.dana-table-sort-button[type="button"]')), true);
  assert.equal(await page.locator('#table th').first().locator('.dana-table-sort-button #header-action').count(), 0,
    'application header controls are never nested in the sort button');
  await loadSort.focus();
  await page.keyboard.press('Enter');
  assert.equal(await loadHeader.getAttribute('aria-sort'), 'descending');
  assert.equal(await firstRowName(), 'Beta');
  await page.keyboard.press('Space');
  assert.equal(await loadHeader.getAttribute('aria-sort'), 'ascending');
  assert.equal(await firstRowName(), 'Alpha');
  // A live body update keeps the existing header controls and re-sorts after its short pause.
  await page.evaluate(() => { window.sortButtonBefore = document.querySelector('#table th:last-child .dana-table-sort-button'); });
  await page.evaluate(() => { window.fixture.instance.loads = [0, 1]; window.fixture.changeDetectorRef.detectChanges(); });
  await page.waitForFunction(() => document.querySelector('#table tbody tr td').firstChild.textContent.trim() === 'Beta');
  assert.equal(await page.evaluate(() => window.sortButtonBefore === document.querySelector('#table th:last-child .dana-table-sort-button')), true);
  await page.evaluate(() => { window.fixture.instance.loads = [2, 1]; window.fixture.changeDetectorRef.detectChanges(); });
  await page.waitForFunction(() => document.querySelector('#table tbody tr td').firstChild.textContent.trim() === 'Alpha');

  // Reapplying an established order on a live cell update preserves a row control's focus.
  await page.locator('#row-action').focus();
  await page.evaluate(() => { window.fixture.instance.rowSuffix = 'Updated'; window.fixture.changeDetectorRef.detectChanges(); });
  await page.waitForFunction(() => document.querySelector('#table tbody').textContent.includes('Updated'));
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  assert.equal(await page.locator('#row-action').evaluate(el => el === document.activeElement), true);

  // A reused header opting out restores unchanged Angular bindings rather than deleting them.
  await page.evaluate(() => { window.fixture.instance.staticHeader = true; window.fixture.changeDetectorRef.detectChanges(); });
  await page.waitForFunction(() => !document.querySelector('#table th:first-child .dana-table-header-tools'));
  assert.equal(await page.locator('#table th').first().getAttribute('aria-label'), 'Application heading');
  assert.equal(await page.locator('#table th').first().getAttribute('tabindex'), '7');
  assert.equal(await page.locator('#table th').first().getAttribute('aria-sort'), 'other');
  assert.equal(await page.locator('.dana-table-filter-popover').count(), 1);
  await page.evaluate(() => { window.fixture.instance.staticHeader = false; window.fixture.changeDetectorRef.detectChanges(); });
  await page.waitForFunction(() => document.querySelectorAll('.dana-table-filter-popover').length === 2);
  // New application values on the opt-out transition must also survive cleanup.
  await page.evaluate(() => {
    Object.assign(window.fixture.instance, { staticHeader: true, headerLabel: 'Updated heading', headerTabindex: 4, headerSort: 'descending' });
    window.fixture.changeDetectorRef.detectChanges();
  });
  await page.waitForFunction(() => !document.querySelector('#table th:first-child .dana-table-header-tools'));
  assert.equal(await page.locator('#table th').first().getAttribute('aria-label'), 'Updated heading');
  assert.equal(await page.locator('#table th').first().getAttribute('tabindex'), '4');
  assert.equal(await page.locator('#table th').first().getAttribute('aria-sort'), 'descending');
  await page.evaluate(() => { window.fixture.instance.staticHeader = false; window.fixture.changeDetectorRef.detectChanges(); });
  await page.waitForFunction(() => document.querySelectorAll('.dana-table-filter-popover').length === 2);

  // Replaced Angular headers release detached controls/listeners and their body overlays.
  await trigger.click();
  await page.evaluate(() => {
    window.detachedHeader = document.querySelector('#table th');
    window.fixture.instance.alternateHeader = true; window.fixture.changeDetectorRef.detectChanges();
  });
  await page.waitForFunction(() => document.querySelector('#table th')?.textContent.includes('Replacement'));
  await page.waitForFunction(() => document.querySelectorAll('.dana-table-filter-popover').length === 2);
  assert.equal(await page.locator('.dana-table-filter-popover:visible').count(), 0);
  assert.equal(await page.evaluate(() => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    window.detachedHeader.dispatchEvent(event); return event.defaultPrevented;
  }), false);
  await page.evaluate(() => { window.fixture.instance.alternateHeader = false; window.fixture.changeDetectorRef.detectChanges(); });
  await page.waitForFunction(() => document.querySelectorAll('.dana-table-filter-popover').length === 2);

  // Every header popup must be removed, whether or not one is open at destruction.
  await page.evaluate(() => { window.fixture.instance.showTable = false; window.fixture.changeDetectorRef.detectChanges(); });
  assert.equal(await page.locator('.dana-table-filter-popover').count(), 0);
  assert.equal(await popoverListeners(), listenersWhileClosed, 'tables with closed filters add no document/window listeners');
  await page.evaluate(() => { window.fixture.instance.showTable = true; window.fixture.changeDetectorRef.detectChanges(); });
  await page.waitForFunction(() => document.querySelectorAll('.dana-table-filter-popover').length === 2);
  await page.locator('#table .dana-table-filter-trigger').first().click();
  await page.evaluate(() => { window.fixture.instance.showTable = false; window.fixture.changeDetectorRef.detectChanges(); });
  assert.equal(await page.locator('.dana-table-filter-popover').count(), 0);
  // Deferred initialization must not recreate popups after an immediate destroy.
  await page.evaluate(() => {
    window.fixture.instance.showSecondTable = true; window.fixture.changeDetectorRef.detectChanges();
    window.fixture.instance.showSecondTable = false; window.fixture.changeDetectorRef.detectChanges();
  });
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  assert.equal(await page.locator('.dana-table-filter-popover').count(), 0);

  await page.locator('#launch').click();
  const dialog = page.locator('.dana-confirm-dialog');
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Cancel');
  assert.equal(await dialog.evaluate(el => el.matches(':modal')), true);
  assert.equal(await dialog.evaluate(el => document.getElementById(el.getAttribute('aria-describedby')).textContent), 'Confirm this action.');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Confirm');
  await page.keyboard.press('Tab');
  // Some browsers briefly focus the document at the end of a native modal cycle;
  // the next Tab must stay inside the dialog, never reaching background controls.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#launch').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.fixture.instance.cancelCount), 1);
  await page.locator('#launch').click();
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('.dana-table-filter-trigger').click();
  const modalFilter = dialog.locator('.dana-table-filter-popover:visible');
  await modalFilter.locator('input').fill('Alpha');
  assert.equal(await page.locator('#modal-table tbody tr:visible').count(), 1);
  await modalFilter.locator('input').press('Escape');
  assert.equal(await dialog.isVisible(), true, 'filter Escape must not dismiss its containing confirmation');
  await dialog.locator('.dana-dialog-actions button').first().click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('#launch').click();
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('.dana-dialog-actions button').last().click();
  await dialog.waitFor({ state: 'hidden' });

  await page.locator('#launch').click();
  await dialog.waitFor({ state: 'visible' });
  await page.evaluate(() => { window.fixture.instance.showDialog = false; window.fixture.changeDetectorRef.detectChanges(); });
  assert.equal(await page.locator(':modal').count(), 0);
  await page.locator('#background').focus();
  assert.equal(await page.locator('#background').evaluate(el => el === document.activeElement), true);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('[danaKpiGrid]').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
  assert.equal(await page.locator('[danaOperationGrid]').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
  // Each app can align navigation state with its own CSS desktop boundary.
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.locator('#default-nav-toggle').click();
  await page.locator('#gear-nav-toggle').click();
  await page.waitForFunction(() => document.querySelector('#default-nav-toggle').textContent === 'true');
  assert.equal(await page.locator('#default-nav-toggle').textContent(), 'true');
  assert.equal(await page.locator('#gear-nav-toggle').textContent(), 'false');
  await page.setViewportSize({ width: 1025, height: 900 });
  await page.waitForFunction(() => document.querySelector('#default-nav-toggle').textContent === 'false');
  await page.setViewportSize({ width: 1023, height: 900 });
  await page.locator('#gear-nav-toggle').click();
  await page.waitForFunction(() => document.querySelector('#gear-nav-toggle').textContent === 'true');
  assert.equal(await page.locator('#gear-nav-toggle').textContent(), 'true');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#gear-nav-toggle').textContent === 'false');
  assert.equal(await page.locator('#gear-nav-toggle').textContent(), 'false');

  // Opt-in modal drawers enter/contain/restore focus while desktop navigation stays unchanged.
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#modal-nav').evaluate(el => getComputedStyle(el).visibility), 'hidden');
  await page.locator('#drawer-opener').click();
  await page.waitForFunction(() => document.activeElement?.id === 'drawer-close');
  assert.equal(await page.locator('#modal-nav').getAttribute('role'), 'dialog');
  assert.equal(await page.locator('#modal-nav').getAttribute('aria-modal'), 'true');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'drawer-last');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'drawer-close');
  await page.keyboard.press('Escape');
  await page.locator('#modal-nav').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#modal-nav').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'drawer-opener');
  await page.locator('#drawer-opener').click();
  await page.locator('#drawer-close').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'drawer-opener');
  await page.locator('#drawer-opener').click();
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForFunction(() => document.querySelector('#modal-nav').getAttribute('aria-modal') === null);

  // Skip links appear only on explicit focus, and reduced-motion removes moving transitions.
  assert.equal(await page.locator('#skip-link').evaluate(el => el.getBoundingClientRect().bottom < 0), true);
  await page.locator('#skip-link').focus();
  assert.equal(await page.locator('#skip-link').evaluate(el => el.getBoundingClientRect().top >= 0), true);
  await page.locator('#skip-link').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'fixture-main');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.ok(await page.locator('#direct .dana-combobox-toggle span').evaluate(el => parseFloat(getComputedStyle(el).transitionDuration) <= .00001));
  assert.deepEqual(errors, []);
  console.log('[PASS] Canonical layout, table controls/header cleanup/stable focus, combobox form safety, modal drawer keyboard focus, skip link, reduced motion, and confirmation regressions.');
} finally {
  await browser.close();
}
