// RXO_EXPORT: the RXO date-range controls (Anytime, date column, range input)
// and the survey overlay. Page-interacting; workbook logic is in rxo-export-data.mjs.
import { visibleItems } from './rxo-filter-ui.mjs';
import { EXPORT_ZONE, exportDateColumns } from './rxo-export-data.mjs';

function exportMmdd(iso) { const [year, month, day] = iso.split('-'); return `${month}/${day}/${year}`; }
function exportDisplayContains(display, iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const tokens = [exportMmdd(iso), `${month}/${day}/${year}`, iso,
    ...['short', 'long'].map(length => new Intl.DateTimeFormat('en-US', {
      month: length, day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(date))];
  const normalized = display.replace(/\s+/g, ' ').toLowerCase();
  return tokens.some(token => normalized.includes(token.toLowerCase()));
}

async function exportAnytime(page) {
  const locator = page.locator('input[placeholder="Anytime"]:visible');
  await locator.first().waitFor({ state: 'visible', timeout: 8000 });
  if (await locator.count() !== 1) throw new Error('RXO_EXPORT: expected one visible Anytime control; date selection is ambiguous.');
  return locator.first();
}

async function exportRequireUnwindowed(page, kind) {
  if (!['orders','shipments'].includes(kind)) return;
  const anytime = await exportAnytime(page);
  const value = (await anytime.inputValue()).trim();
  if (value && !/^anytime$/i.test(value)) {
    throw new Error('RXO_EXPORT: a previous date range survived the normal RXO filter reset. Export stopped rather than treating a restricted baseline as complete.');
  }
}

function exportRequestedDateColumn(direction, options = {}) {
  const kind = options.pageKey || 'orders';
  const allowed = exportDateColumns(kind, direction);
  const expected = options.dateColumn || (kind === 'orders' ? allowed[0] : null);
  if (!allowed.includes(expected)) throw new Error('RXO_EXPORT: explicit supported dataset/date column is required.');
  return expected;
}

// RXO date input semantics. A generic placeholder is never a direction signal.
const EXPORT_DATE_INPUT_BASE = 'input[placeholder="Pick-up" i], input[placeholder="Pickup" i], input[placeholder="Pick-up date" i], input[placeholder="Drop-off" i], input[placeholder="Delivery" i], input[placeholder="Delivery date" i], input[placeholder="Select date range" i], input[aria-label="Date range input field" i]';
const EXPORT_DATE_INPUTS = EXPORT_DATE_INPUT_BASE.split(', ').map(selector => selector + ':visible').join(', ');
const EXPORT_DATE_CHOICE_BASE = '[role="tab"], input[type="radio"], [role="radio"], button[aria-pressed], select';
const EXPORT_DATE_CHOICES = EXPORT_DATE_CHOICE_BASE.split(', ').map(selector => selector + ':visible').join(', ');
const EXPORT_DATE_COLUMN_BASE = 'mat-select, [role="combobox"], select';
const EXPORT_DATE_COLUMNS = EXPORT_DATE_COLUMN_BASE.split(', ').map(selector => selector + ':visible').join(', ');

function exportDescribeDateColumn(node) {
  // RXO screenshots show the explicitly labelled Select Date column control.
  // Return only recognized date labels, never arbitrary form text.
  const tidy = value => String(value || '').replace(/\s+/g, ' ').trim();
  const exactLabel = value => /^select date column$/i.test(tidy(value));
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const selector = 'mat-select, [role="combobox"], select';
  const primary = el => !(el.closest('mat-select') && el.closest('mat-select') !== el);
  const labels = [node.getAttribute('aria-label'), ...[...(node.labels || [])].map(el => el.textContent),
    ...tidy(node.getAttribute('aria-labelledby')).split(' ').filter(Boolean).map(id => document.getElementById(id)?.textContent)];
  let labelVerified = labels.some(exactLabel);
  for (let parent = node.parentElement, depth = 0; !labelVerified && parent && depth < 5; parent = parent.parentElement, depth++) {
    if (/^(?:body|html)$/i.test(parent.tagName)) break;
    const peers = [...parent.querySelectorAll(selector)].filter(el => visible(el) && primary(el));
    if (peers.length !== 1 || peers[0] !== node) break;
    labelVerified = [...parent.querySelectorAll('label, mat-label, legend, span, div, p')]
      .some(el => visible(el) && !el.contains(node) && !el.closest('[role="option"], mat-option, select') && exactLabel(el.textContent));
  }
  const native = /^select$/i.test(node.tagName);
  const valueNode = node.querySelector('.mat-select-value-text, .mat-mdc-select-value-text');
  const selected = tidy(native ? [...node.options].find(option => option.selected)?.textContent : valueNode?.textContent || node.textContent);
  const recognized = ['Created On', 'Pickup Date', 'Delivery Date',
    'Pickup Appointment Arrival', 'Pickup Estimated Arrival',
    'Delivery Appointment Arrival', 'Delivery Estimated Arrival'];
  const selection = recognized.find(text => text.toLowerCase() === selected.toLowerCase()) || 'UNKNOWN';
  return { labelVerified, primary: primary(node), type: native ? 'select' : 'combobox', selection,
    kind: selection.startsWith('Pickup ') ? 'OUTBOUND' : selection.startsWith('Delivery ') ? 'INBOUND' : null,
    expanded: node.getAttribute('aria-expanded') === 'true',
    disabled: node.disabled === true || node.getAttribute('aria-disabled') === 'true',
    panelId: node.getAttribute('aria-controls') || node.getAttribute('aria-owns') || null };
}

function exportDescribeDateInput(el, { inputSelector, choiceSelector }) {
  // This function executes in the page. Return only date-control structure;
  // never body text, load rows, form values, cookies or login information.
  const tidy = value => String(value || '').replace(/\s+/g, ' ').trim();
  const kind = value => {
    const text = tidy(value).toLowerCase().replace(/[-_:]/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ')
      .replace(/\s+(?:date(?:s)?(?:\s+range)?|range)(?:\s+input(?:\s+field)?)?$/, '').trim();
    return /^(?:pick up|pickup)$/.test(text) ? 'OUTBOUND'
      : /^(?:drop off|dropoff|delivery)$/.test(text) ? 'INBOUND' : null;
  };
  const visible = node => !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const name = node => {
    const labelled = tidy(node.getAttribute('aria-labelledby')).split(' ').filter(Boolean)
      .map(id => document.getElementById(id)?.textContent || '').join(' ');
    const labels = [...(node.labels || [])].map(label => label.textContent).join(' ');
    return tidy(node.getAttribute('aria-label') || labelled || labels || node.textContent);
  };
  const evidence = [];
  const add = (text, method) => { const side = kind(text); if (side) evidence.push({ kind: side, method }); };
  add(el.getAttribute('placeholder'), 'NAMED_PLACEHOLDER');
  add(el.getAttribute('aria-label'), 'ARIA_LABEL');
  for (const label of [...(el.labels || [])]) add(label.textContent, 'HTML_LABEL');
  for (const id of tidy(el.getAttribute('aria-labelledby')).split(' ').filter(Boolean)) add(document.getElementById(id)?.textContent, 'ARIA_LABELLEDBY');

  const controls = [...document.querySelectorAll(choiceSelector)].filter(visible);
  let choices = [], structural = [], scopeFound = false;
  const observedLabels = [];
  for (let parent = el.parentElement, depth = 0; parent && depth < 6; parent = parent.parentElement, depth++) {
    if (/^(?:body|html)$/i.test(parent.tagName)) break;
    if ([...parent.querySelectorAll(inputSelector)].filter(visible).length !== 1) break;
    // Static field captions are useful for custom Angular controls. Do not
    // mistake an unselected tab/radio/menu option for the field's meaning.
    for (const node of parent.querySelectorAll('button, label, mat-label, legend, span, p, h1, h2, h3, h4, h5, h6')) {
      const side = kind(node.textContent);
      if (visible(node) && side && observedLabels.length < 20 && !observedLabels.some(item => item.node === node)) {
        observedLabels.push({ node, kind: side, tag: node.tagName.toLowerCase(), role: node.getAttribute('role'),
          selected: node.getAttribute('aria-selected'), pressed: node.getAttribute('aria-pressed') });
      }
    }
    const labels = [...parent.querySelectorAll('label, mat-label, legend, span, div, p, h1, h2, h3, h4, h5, h6')]
      .filter(node => visible(node) && !node.contains(el) && !node.closest('button, [role="tab"], [role="radio"], [role="option"], select, [role="combobox"]')
        && !node.querySelector('input[type="radio"], input[type="checkbox"]')
        && !(node.control && /^(?:radio|checkbox)$/i.test(node.control.type)));
    structural = labels.map(node => kind(node.textContent)).filter(Boolean);
    const local = controls.filter(node => parent.contains(node));
    choices = local.flatMap(node => {
      const index = controls.indexOf(node);
      if (node.getAttribute('role') === 'radio' && [...node.querySelectorAll('input[type="radio"]')].some(visible)) return [];
      if (/^select$/i.test(node.tagName)) {
        const options = [...node.options].map(option => ({ kind: kind(option.textContent), value: option.value, selected: option.selected, disabled: option.disabled })).filter(option => option.kind);
        return options.map(option => ({ index, type: 'select', ...option, disabled: option.disabled || node.disabled }));
      }
      const side = kind(name(node));
      if (!side) return [];
      return [{ index, kind: side, type: 'click', selected: node.checked === true || node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-pressed') === 'true',
        disabled: node.disabled === true || node.getAttribute('aria-disabled') === 'true' }];
    });
    if (structural.length || choices.length) { scopeFound = true; break; }
  }
  const selected = choices.filter(choice => choice.selected);
  if (selected.length) for (const choice of selected) evidence.push({ kind: choice.kind, method: 'SELECTED_DATE_TYPE' });
  for (const side of structural) evidence.push({ kind: side, method: 'SCOPED_STATIC_CAPTION' });
  const kinds = [...new Set(evidence.map(item => item.kind))];
  return { kind: kinds.length === 1 ? kinds[0] : null, ambiguous: kinds.length > 1,
    placeholder: tidy(el.getAttribute('placeholder')).slice(0,80),
    readOnly: el.readOnly === true, disabled: el.disabled === true,
    hasValue: Boolean(tidy(el.value)), evidence, scopeFound, choices,
    observedDateLabels: observedLabels.map(({ node, ...label }) => label) };
}

async function exportDateInventory(page) {
  const columnLocator = page.locator(EXPORT_DATE_COLUMNS), columns = [];
  for (let index = 0; index < await columnLocator.count(); index++) {
    const info = await columnLocator.nth(index).evaluate(exportDescribeDateColumn);
    if (info.primary && info.labelVerified) columns.push({ index, ...info });
  }
  const fields = page.locator(EXPORT_DATE_INPUTS), descriptions = [];
  for (let index = 0; index < await fields.count(); index++) {
    const info = await fields.nth(index).evaluate(exportDescribeDateInput,
      { inputSelector: EXPORT_DATE_INPUT_BASE, choiceSelector: EXPORT_DATE_CHOICE_BASE });
    const associated = await fields.nth(index).evaluate((el, { inputSelector, columnSelector, validIndices }) => {
      const visible = node => !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
      const all = [...document.querySelectorAll(columnSelector)].filter(visible);
      for (let parent = el.parentElement, depth = 0; parent && depth < 12; parent = parent.parentElement, depth++) {
        if (/^(?:body|html)$/i.test(parent.tagName)) break;
        if ([...parent.querySelectorAll(inputSelector)].filter(visible).length !== 1) break;
        const indices = validIndices.filter(i => parent.contains(all[i]));
        if (indices.length) return indices;
      }
      return [];
    }, { inputSelector: EXPORT_DATE_INPUT_BASE, columnSelector: EXPORT_DATE_COLUMN_BASE, validIndices: columns.map(column => column.index) });
    const dateColumns = columns.filter(column => associated.includes(column.index));
    if (dateColumns.length) {
      // An explicit column dropdown takes precedence over nearby static text.
      // Created On / unknown / open dropdown cannot prove a pickup date range.
      const selected = dateColumns.length === 1 && !dateColumns[0].expanded ? dateColumns[0] : null;
      const conflict = selected?.kind && info.evidence.some(item => item.kind !== selected.kind);
      info.kind = selected?.kind && !conflict ? selected.kind : null;
      info.ambiguous = dateColumns.length !== 1 || Boolean(conflict);
      if (info.kind) info.evidence.push({ kind: info.kind, method: 'SELECT_DATE_COLUMN', selection: selected.selection });
    }
    descriptions.push({ index, ...info, dateColumns });
  }
  return descriptions;
}

function exportSafeDateInventory(inventory) {
  return inventory.map(({ choices, dateColumns, ...field }) => ({ ...field,
    dateColumns: (dateColumns || []).map(({ panelId, ...column }) => column),
    choices: choices.map(({ value, ...choice }) => choice) }));
}

async function exportSelectDateColumn(page, direction, inventory, expected) {
  const fields = inventory.filter(field => field.dateColumns.length);
  if (!fields.length) return inventory; // Preserve the previously supported named inputs.
  if (fields.length !== 1 || fields[0].dateColumns.length !== 1) {
    throw exportDateError('RXO_EXPORT: Select Date column is ambiguous; no range was applied.', direction, inventory);
  }
  const column = fields[0].dateColumns[0];
  if (column.disabled) throw exportDateError('RXO_EXPORT: Select Date column is disabled.', direction, inventory);
  const locator = page.locator(EXPORT_DATE_COLUMNS).nth(column.index);
  if (column.selection !== expected || column.expanded) {
    if (column.type === 'select') {
      const nativeOptions = await locator.evaluate(el => [...el.options].map(option => ({
        text: String(option.textContent || '').replace(/\s+/g, ' ').trim(), disabled: option.disabled === true })));
      const matches = nativeOptions.filter(option => option.text === expected);
      if (matches.length !== 1 || matches[0].disabled) {
        const error = exportDateError('RXO_EXPORT: native date-column option is missing, duplicate or disabled.', direction, inventory);
        error.rxoDateControlDiagnostics.dateColumnOptions = nativeOptions.slice(0, 20);
        throw error;
      }
      await locator.selectOption({ label: expected }, { timeout: 5000 });
    } else {
      if (!column.expanded) await locator.click({ timeout: 5000 });
      const opened = await locator.evaluate(exportDescribeDateColumn);
      let panel;
      if (opened.panelId && /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(opened.panelId)) {
        panel = page.locator('[id="' + opened.panelId + '"]:visible');
      } else {
        panel = page.locator('[role="listbox"]:visible, .mat-select-panel:visible, .mat-mdc-select-panel:visible');
      }
      await panel.first().waitFor({ state: 'visible', timeout: 5000 });
      if (await panel.count() !== 1) throw exportDateError('RXO_EXPORT: date-column option panel is ambiguous.', direction, inventory);
      const options = panel.locator('[role="option"]:visible, mat-option:visible');
      let states = [], matches = [];
      // The labelled selector and its own option panel establish scope. A
      // shipment menu need not contain every Orders-menu option. Wait for the
      // exact required option, then verify the selected value and reopen it.
      for (let poll = 0; poll < 20; poll++) {
        states = [];
        for (let index = 0; index < await options.count(); index++) {
          const state = await options.nth(index).evaluate(el => ({ text: String(el.textContent || '').replace(/\s+/g, ' ').trim(),
            disabled: el.getAttribute('aria-disabled') === 'true' || el.disabled === true }));
          states.push({ index, ...state });
        }
        matches = states.filter(option => option.text.toLowerCase() === expected.toLowerCase());
        if (matches.length) break;
        await page.waitForTimeout(250);
      }
      if (matches.length !== 1) {
        const error = exportDateError(`RXO_EXPORT: ${expected} options could not be verified uniquely in the date-column panel.`, direction, inventory);
        error.rxoDateControlDiagnostics.dateColumnOptions = states.slice(0, 20).map(option => ({ text: option.text.slice(0, 80), disabled: option.disabled }));
        throw error;
      }
      const target = matches[0];
      if (target.disabled) throw exportDateError('RXO_EXPORT: required date-column option is disabled.', direction, inventory);
      await options.nth(target.index).click({ timeout: 5000 });
    }
  }
  for (let attempt = 0; attempt < 16; attempt++) {
    inventory = await exportDateInventory(page);
    const selected = inventory.filter(field => field.dateColumns.length === 1 && field.dateColumns[0].selection === expected &&
      !field.dateColumns[0].expanded && field.kind === direction && !field.ambiguous);
    if (selected.length === 1) return inventory;
    await page.waitForTimeout(250);
  }
  throw exportDateError(`RXO_EXPORT: ${expected} did not become the verified selected date column.`, direction, inventory);
}

function exportDateError(message, direction, inventory) {
  const error = new Error(message);
  error.rxoDateControlDiagnostics = { direction, controls: exportSafeDateInventory(inventory) };
  return error;
}

async function exportResolveDateField(page, direction, options = {}) {
  const expected = exportRequestedDateColumn(direction, options);
  await page.locator(EXPORT_DATE_INPUTS).first().waitFor({ state: 'visible', timeout: 8000 });
  let inventory = await exportDateInventory(page);
  if (options.pageKey === 'shipments' && !inventory.some(field => field.dateColumns.length)) {
    throw exportDateError('RXO_EXPORT: Shipments requires an explicitly labelled date-column selector.', direction, inventory);
  }
  inventory = await exportSelectDateColumn(page, direction, inventory, expected);
  let matches = inventory.filter(field => field.kind === direction && !field.ambiguous);
  if (matches.length > 1) throw exportDateError(`RXO_EXPORT ${direction}: multiple date fields have the required meaning.`, direction, inventory);
  // A single shared range input can be switched only through an explicitly
  // identified date-type tab/radio/select group; never click an arbitrary text.
  if (!matches.length && inventory.length === 1 && !inventory[0].ambiguous) {
    const choices = inventory[0].choices;
    const targets = choices.filter(choice => choice.kind === direction && !choice.disabled);
    const sides = new Set(choices.map(choice => choice.kind));
    if (targets.length === 1 && sides.has('OUTBOUND') && sides.has('INBOUND')) {
      const target = targets[0], locator = page.locator(EXPORT_DATE_CHOICES).nth(target.index);
      if (target.type === 'select') await locator.selectOption(target.value, { timeout: 5000 });
      else await locator.click({ timeout: 5000 });
      // Selection must be reflected by the input's semantic proof after render.
      for (let attempt = 0; attempt < 12; attempt++) {
        await page.waitForTimeout(250);
        inventory = await exportDateInventory(page);
        matches = inventory.filter(field => field.kind === direction && !field.ambiguous);
        if (matches.length) break;
      }
    }
  }
  if (matches.length !== 1) throw exportDateError(`RXO_EXPORT ${direction}: date field meaning could not be verified as ${direction === 'OUTBOUND' ? 'Pickup' : 'Delivery'}. The result JSON includes date-control labels and selection state.`, direction, inventory);
  const chosen = matches[0];
  if (chosen.readOnly || chosen.disabled) throw exportDateError(`RXO_EXPORT ${direction}: verified date field is not editable.`, direction, inventory);
  if (inventory.some(field => field.index !== chosen.index && field.hasValue)) {
    throw exportDateError('RXO_EXPORT: another date field already has a constraint; intersected pickup/delivery windows are not accepted.', direction, inventory);
  }
  return { field: page.locator(EXPORT_DATE_INPUTS).nth(chosen.index), proof: chosen, inventory };
}

async function exportApplyRange(page, direction, range, options = {}) {
  const expected = exportRequestedDateColumn(direction, options);
  const anytime = await exportAnytime(page);
  await anytime.click({ timeout: 5000 });
  let inventory = [];
  try {
    const resolved = await exportResolveDateField(page, direction, options);
    const { field, proof } = resolved; inventory = resolved.inventory;
    const requested = `${exportMmdd(range.startDate)} - ${exportMmdd(range.endDate)}`;
    await field.fill(requested, { timeout: 5000 });
    await field.press('Tab');
    await page.waitForTimeout(500);
    const state = await field.evaluate(el => ({ value: el.value, invalid: el.getAttribute('aria-invalid') === 'true', validation: Boolean(el.validationMessage) }));
    if (state.invalid || state.validation || !exportDisplayContains(state.value, range.startDate) || !exportDisplayContains(state.value, range.endDate)) {
      throw new Error(`RXO_EXPORT ${direction}: RXO did not accept both entered dates.`);
    }
    inventory = await exportDateInventory(page);
    const afterFill = inventory.find(item => item.index === proof.index);
    if (!afterFill || afterFill.ambiguous || afterFill.kind !== direction ||
        (proof.dateColumns.length && (afterFill.dateColumns.length !== 1 ||
          afterFill.dateColumns[0].selection !== expected || afterFill.dateColumns[0].expanded))) {
      throw new Error(`RXO_EXPORT ${direction}: date field meaning changed while entering the range.`);
    }
    const done = await visibleItems(page.getByRole('button', { name: /^Done$/i }));
    if (done.length !== 1) throw new Error('RXO_EXPORT: one visible date-range Done button is required.');
    await exportSuppressSurvey(page);
    await done[0].click({ timeout: 5000 });
    await page.waitForTimeout(900);
    const displayed = (await anytime.inputValue()) + ' ' + await anytime.evaluate(el =>
      el.parentElement?.parentElement?.innerText || el.parentElement?.innerText || '');
    if (!exportDisplayContains(displayed, range.startDate) || !exportDisplayContains(displayed, range.endDate)) {
      throw new Error(`RXO_EXPORT ${direction}: applied date display does not retain both boundaries.`);
    }
    if (await field.isVisible().catch(() => false)) throw new Error('RXO_EXPORT: date editor stayed open after Done; application is not verified.');
    let reopenedColumnVerified = false;
    if (proof.dateColumns.length) {
      // Observe the committed selection without automatically changing it again.
      await anytime.click({ timeout: 5000 });
      await page.locator(EXPORT_DATE_INPUTS).first().waitFor({ state: 'visible', timeout: 8000 });
      inventory = await exportDateInventory(page);
      const retained = inventory.filter(item => item.kind === direction && !item.ambiguous && item.dateColumns.length === 1 &&
        item.dateColumns[0].selection === expected && !item.dateColumns[0].expanded);
      if (retained.length !== 1) throw exportDateError('RXO_EXPORT: selected date column was not retained after Done.', direction, inventory);
      const retainedField = page.locator(EXPORT_DATE_INPUTS).nth(retained[0].index);
      const retainedValue = await retainedField.inputValue();
      if (!exportDisplayContains(retainedValue, range.startDate) || !exportDisplayContains(retainedValue, range.endDate)) {
        throw exportDateError('RXO_EXPORT: date boundaries were not retained when reopening the picker.', direction, inventory);
      }
      const close = await visibleItems(page.getByRole('button', { name: /^Done$/i }));
      if (close.length !== 1) throw exportDateError('RXO_EXPORT: could not close the verified date picker.', direction, inventory);
      await close[0].click({ timeout: 5000 });
      await page.waitForTimeout(900);
      if (await retainedField.isVisible().catch(() => false)) throw new Error('RXO_EXPORT: verified date picker did not close.');
      const finalDisplay = await anytime.inputValue();
      if (!exportDisplayContains(finalDisplay, range.startDate) || !exportDisplayContains(finalDisplay, range.endDate)) {
        throw new Error('RXO_EXPORT: applied boundaries changed after verification.');
      }
      reopenedColumnVerified = true;
    }
    return { verified: true, method: 'ASSOCIATED_DATE_KIND_AND_BOTH_APPLIED_DATES', field: direction === 'OUTBOUND' ? 'Pickup' : 'Delivery',
      pageKey: options.pageKey || 'orders', requestedDateColumn: expected,
      inputPlaceholder: proof.placeholder, semanticEvidence: proof.evidence,
      selectedDateColumn: proof.dateColumns[0]?.selection || null, reopenedColumnVerified, ...range, timeZone: EXPORT_ZONE };
  } catch (error) {
    if (!error.rxoDateControlDiagnostics) {
      if (!inventory.length) inventory = await exportDateInventory(page).catch(() => []);
      error.rxoDateControlDiagnostics = { direction, controls: exportSafeDateInventory(inventory) };
    }
    throw error;
  }
}

async function exportSuppressSurvey(page) {
  // Same identified survey-only iframe handling used by the earlier range test.
  const frames = page.locator('iframe[name*="survey" i], iframe[id*="survey" i], iframe[src*="survey" i]');
  for (let i = 0; i < await frames.count(); i++) {
    const frame = frames.nth(i);
    if (await frame.isVisible().catch(() => false)) await frame.evaluate(el => {
      el.style.setProperty('pointer-events', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
    });
  }
}

export {
  exportApplyRange,
  exportRequestedDateColumn,
  exportRequireUnwindowed,
  exportSuppressSurvey,
};
