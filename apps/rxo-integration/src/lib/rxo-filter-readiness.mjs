// Readiness is the requested Origin/Destination control, never an unrelated
// status selector. Only DOM/accessibility APIs are used; no Angular debug hooks.
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function safePageUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.origin}${u.pathname}` : u.protocol; }
  catch { return '(unavailable)'; }
}
const scopes = page => typeof page.frames === 'function' ? page.frames() : [page];
async function visible(locator) { try { return await locator.isVisible(); } catch { return false; } }

export async function collectLabeledControls(page, label) {
  if (!['Origin', 'Destination'].includes(label)) throw new Error('Unknown RXO direction filter.');
  const labelRx = new RegExp(`^${escapeRegex(label)}(?:\\s|:|$)`, 'i');
  const result = [];
  for (const frame of scopes(page)) {
    const candidates = [
      ['accessible-combobox', frame.getByRole('combobox', { name: labelRx })],
      ['accessible-label', frame.getByLabel(new RegExp(`^${label}:?$`, 'i'))],
      ['placeholder', frame.getByPlaceholder(new RegExp(`^${label}$`, 'i'))],
      ['data-placeholder', frame.locator(`[data-placeholder="${label}"]`)],
      ['material-label', frame.locator('mat-form-field, .mat-form-field, .mat-mdc-form-field').filter({ hasText: labelRx })],
    ];
    const seen = new Set();
    for (const [kind, locator] of candidates) {
      const n = Math.min(await locator.count().catch(() => 0), 30);
      for (let i = 0; i < n; i++) {
        const item = locator.nth(i);
        if (!await visible(item)) continue;
        // Search inputs in an already open listbox are not closed filter triggers.
        const inPanel = await item.evaluate(el => Boolean(el.closest('[role="listbox"], .mat-select-panel, .mat-mdc-select-panel'))).catch(() => false);
        if (inPanel) continue;
        const summary = await item.evaluate(el => {
          const r = el.getBoundingClientRect();
          return { tag: el.tagName, id: el.id || '', role: el.getAttribute('role') || '',
            ariaLabel: el.getAttribute('aria-label') || '', placeholder: el.getAttribute('placeholder') || '',
            box: { x: r.x, y: r.y, width: r.width, height: r.height } };
        }).catch(() => null);
        if (!summary) continue;
        const key = JSON.stringify(summary);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ kind, locator: item, summary: { ...summary, kind, frame: safePageUrl(frame.url()) } });
      }
    }
  }
  return result;
}

async function revealFilters(page) {
  // Only a uniquely named, visible Filters control is safe to expand. Never guess
  // at a random combobox, choose an account, or use an unfiltered export fallback.
  const hits = [];
  for (const frame of scopes(page)) {
    for (const role of ['button', 'tab']) {
      const loc = frame.getByRole(role, { name: /^(show\s+)?(advanced\s+)?filters?(?:\s*\(\d+\))?$/i });
      for (let i = 0, n = Math.min(await loc.count().catch(() => 0), 10); i < n; i++) {
        if (await visible(loc.nth(i))) hits.push(loc.nth(i));
      }
    }
  }
  if (hits.length !== 1) return false;
  // A declared expanded panel must not be collapsed accidentally.
  if (await hits[0].getAttribute('aria-expanded').catch(() => null) === 'true') return false;
  await hits[0].click({ timeout: 3000 });
  return true;
}

export async function filterContext(page) {
  const frames = [];
  for (const frame of scopes(page).slice(0, 8)) {
    const flags = await frame.locator('body').evaluate(el => {
      const text = (el.innerText || '').slice(0, 16000);
      const seen = e => Boolean(e.getClientRects().length);
      return {
        passwordVisible: [...el.querySelectorAll('input[type="password"]')].some(seen),
        otpVisible: [...el.querySelectorAll('input[autocomplete="one-time-code"]')].some(seen),
        mfaPrompt: /verification code|multi.factor|authenticate with|verify your identity/i.test(text),
        accessDenied: /access denied|not authorized|permission denied/i.test(text),
        accountSelection: /select (?:a |your )?(?:customer|account|organization)/i.test(text),
        filtersTextPresent: /\borigin\b/i.test(text) && /\bdestination\b/i.test(text),
        visibleComboboxes: [...el.querySelectorAll('[role="combobox"], mat-select')].filter(seen).length,
      };
    }).catch(() => ({ unavailable: true }));
    frames.push({ url: safePageUrl(frame.url()), ...flags });
  }
  const classification = frames.some(f => f.passwordVisible || f.otpVisible || f.mfaPrompt)
    ? 'AUTH_ACTION_REQUIRED' : frames.some(f => f.accessDenied) ? 'ACCESS_DENIED'
    : frames.some(f => f.accountSelection) ? 'ACCOUNT_SELECTION_REQUIRED' : 'FILTER_NOT_AVAILABLE';
  return { classification, url: safePageUrl(page.url()), frames };
}

export async function waitForNamedFilter(page, label, options = {}) {
  const timeout = Number(options.timeoutMs ?? 60000);
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 300000) throw new Error('Invalid filter readiness timeout.');
  const started = Date.now(); let expanded = false; let lastLog = 0;
  do {
    const found = await collectLabeledControls(page, label);
    if (found.length) return found;
    if (typeof options.legacyCollect === 'function') {
      const legacy = await options.legacyCollect(page, label);
      if (legacy.length) return legacy;
    }
    if (options.allowReveal !== false && !expanded) {
      expanded = await revealFilters(page).catch(() => false);
    }
    if (Date.now() - started >= timeout) break;
    if (options.log && Date.now() - lastLog > 5000) {
      options.log(`[RXO] Waiting for the actual ${label} filter (${Math.round((Date.now()-started)/1000)}s).`);
      lastLog = Date.now();
    }
    await page.waitForTimeout(Math.min(250, Math.max(1, timeout - (Date.now() - started))));
  } while (Date.now() - started <= timeout);
  const context = await filterContext(page);
  if (options.onDiagnostic) await options.onDiagnostic({ label, ...context });
  const message = `${label}: ${context.classification}; the named filter was not available on ${context.url}. ` +
    (context.classification === 'AUTH_ACTION_REQUIRED' || context.classification === 'ACCOUNT_SELECTION_REQUIRED'
      ? 'Run BOOTSTRAP-RXO-BROWSER.cmd to complete the RXO prompt; export is not complete.'
      : 'No unfiltered export was attempted. See filter-readiness.json for the redacted page-state report.');
  const error = new Error(message); error.code = context.classification; error.diagnostics = context;
  throw error;
}

// Selected list values can hide both direction placeholders on every
// navigation. Prepare the list BEFORE selecting either export direction.
const freightPaths = new Set(['/orders/list', '/active-shipments', '/shipment-freight']);
export function isFreightListUrl(actual, expected) {
  try {
    const a = new URL(actual), e = new URL(expected);
    return e.origin === 'https://customer.rxoconnect.rxo.com' &&
      freightPaths.has(e.pathname) && a.origin === e.origin && a.pathname === e.pathname;
  } catch { return false; }
}

// This function runs in the page, through locator.evaluate(). Keep it
// closure-free. Return only enums/counts/booleans: never customer text or values.
// Angular Material's empty host class/placeholder branch are independent of the
// accessible label. An empty value surface need not contain the word "Origin".
export function readDirectionControlState(el, name) {
  const result = (neutral, reason, kind = 'UNKNOWN', signals = {}) =>
    ({ neutral, reason, kind, signals });
  const selector = 'mat-select, [role="combobox"], select';
  const field = el.closest('mat-form-field, .mat-form-field, .mat-mdc-form-field');
  let control = el.matches(selector) ? el : el.closest(selector);
  if (!control) {
    const within = [...el.querySelectorAll(selector)];
    const candidates = within.length ? within : [...(field?.querySelectorAll(selector) || [])];
    const top = candidates.filter(node => !candidates.some(other => other !== node && other.contains(node)));
    if (top.length !== 1) return result(false, top.length ? 'AMBIGUOUS_CONTROL' : 'CONTROL_UNRESOLVED');
    control = top[0];
  }
  const shown = node => Boolean(node.getClientRects().length) &&
    getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
  if (!shown(control)) return result(false, 'CONTROL_HIDDEN');
  const material = control.tagName === 'MAT-SELECT' ||
    control.classList.contains('mat-select') || control.classList.contains('mat-mdc-select');
  const kind = material ? 'MATERIAL_SELECT' : control.tagName === 'SELECT' ? 'NATIVE_SELECT' :
    control.tagName === 'INPUT' ? 'INPUT_COMBOBOX' : 'TEXT_COMBOBOX';
  if (control.disabled || control.getAttribute('aria-disabled') === 'true') return result(false, 'CONTROL_DISABLED', kind);
  if (control.getAttribute('aria-expanded') === 'true') return result(false, 'CONTROL_EXPANDED', kind);
  if (control.tagName === 'SELECT') {
    // value alone is insufficient for a multiple select whose first option is empty.
    const selected = [...control.selectedOptions].some(option => option.value !== '');
    return result(!selected, selected ? 'NATIVE_SELECTED' : 'NATIVE_EMPTY', kind);
  }
  const chipRoot = field || (control.tagName === 'INPUT' ? control.parentElement : control);
  const chipPresent = [...chipRoot.querySelectorAll('mat-chip,mat-chip-row,mat-chip-option,.mat-chip,.mat-mdc-chip')].some(shown);
  if (control.tagName === 'INPUT') {
    const selected = control.value !== '' || chipPresent;
    return result(!selected, selected ? 'INPUT_SELECTED' : 'INPUT_EMPTY', kind, { chipPresent });
  }
  const selectedSlot = control.querySelector('.mat-select-value-text,.mat-mdc-select-value-text,mat-select-trigger');
  const placeholder = control.querySelector('.mat-select-placeholder,.mat-mdc-select-placeholder');
  const materialEmpty = control.classList.contains('mat-select-empty') || control.classList.contains('mat-mdc-select-empty');
  const selectedOptionPresent = Boolean(control.querySelector('[aria-selected="true"],.mat-selected,.mat-mdc-option-active[aria-selected="true"]'));
  const signals = { materialEmpty, placeholderPresent: Boolean(placeholder), selectedValuePresent: Boolean(selectedSlot),
    selectedOptionPresent, chipPresent };
  // A selected-value branch is positive selected-state evidence even when a custom
  // trigger is blank, aria-hidden, or happens to display the literal filter name.
  if (selectedSlot || selectedOptionPresent || chipPresent) return result(false, 'SELECTED_VALUE_PRESENT', kind, signals);
  // Strip only known decoration and the explicit placeholder branch. Never
  // erase arbitrary aria-hidden text, since it can be a real displayed value.
  const stripDecoration = surface => {
    surface.querySelectorAll('mat-icon,.mat-icon,.material-icons,svg,.mat-select-arrow-wrapper,.mat-mdc-select-arrow-wrapper,[hidden]')
      .forEach(node => node.remove());
    surface.querySelectorAll('[aria-hidden="true"]').forEach(node => {
      if (/^(?:arrow|arrow_drop_down|arrow_drop_up|keyboard_arrow_down|keyboard_arrow_up|expand_more|expand_less|location_on|place)$/i
        .test((node.textContent || '').trim())) node.remove();
    });
    return surface;
  };
  const normalizedText = node => (node.textContent || '').replace(/[\u200b-\u200d\ufeff]/g, '').trim().replace(/\s+/g, ' ');
  const labelText = text => new RegExp('^(?:' + name + '|Select ' + name + '|' + name + ' Select)$', 'i').test(text);
  const surface = stripDecoration(control.cloneNode(true));
  const text = normalizedText(surface);
  const withoutPlaceholder = surface.cloneNode(true);
  withoutPlaceholder.querySelectorAll('.mat-select-placeholder,.mat-mdc-select-placeholder').forEach(node => node.remove());
  const remainingText = normalizedText(withoutPlaceholder);
  if (material && (materialEmpty || placeholder) && remainingText && !labelText(remainingText)) {
    return result(false, 'CONFLICTING_VALUE_TEXT', kind, signals);
  }
  if (material && materialEmpty) return result(true, 'MATERIAL_EMPTY_CLASS', kind, signals);
  // An empty placeholder is legitimate when mat-form-field supplies the label.
  // Do not treat a hidden stale placeholder as empty-state evidence.
  if (material && placeholder && !placeholder.closest('[hidden]') &&
      getComputedStyle(placeholder).display !== 'none' && getComputedStyle(placeholder).visibility !== 'hidden') {
    return result(true, 'MATERIAL_PLACEHOLDER_BRANCH', kind, signals);
  }
  // Preserve the existing strict legacy text-placeholder path.
  const exactPlaceholder = labelText(text);
  return result(exactPlaceholder, exactPlaceholder ? 'LEGACY_EXACT_PLACEHOLDER' : 'EMPTY_STATE_UNPROVED', kind, signals);
}

async function neutralControl(candidate, label) {
  try { return await candidate.locator.evaluate(readDirectionControlState, label); }
  catch { return { neutral: false, reason: 'CONTROL_READ_FAILED', kind: 'UNKNOWN', signals: {} }; }
}

async function neutralDirectionState(page, legacyCollect) {
  const state = {};
  for (const label of ['Origin', 'Destination']) {
    let found = await collectLabeledControls(page, label);
    if (!found.length && typeof legacyCollect === 'function') found = await legacyCollect(page, label);
    const checks = await Promise.all(found.map(item => neutralControl(item, label)));
    // Conflicting/unknown candidates still block selection. Evidence contains no
    // HTML, text, IDs, option values or account/customer labels.
    state[label] = { found: found.length > 0, neutral: checks.length > 0 && checks.every(item => item.neutral),
      candidateCount: checks.length, checks: checks.slice(0, 20) };
  }
  return state;
}

async function listToolbarResets(page, expectedUrl) {
  const candidates = [];
  for (const frame of scopes(page)) {
    if (!isFreightListUrl(frame.url(), expectedUrl)) continue;
    const exports = frame.getByText(/^Export$/i);
    let exportVisible = false;
    for (let i = 0, n = Math.min(await exports.count(), 10); i < n; i++) {
      if (await visible(exports.nth(i))) exportVisible = true;
    }
    if (!exportVisible) continue;
    const resets = frame.getByText(/^(?:Reset|Reset filters)$/i);
    const seen = new Set();
    for (let i = 0, n = Math.min(await resets.count(), 20); i < n; i++) {
      const item = resets.nth(i);
      if (!await visible(item)) continue;
      const proof = await item.evaluate(el => {
        const hit = el.closest('button,a,[role="button"],[role="link"]') || el;
        if (hit.closest('form, [role="dialog"], [role="listbox"], tr, [role="row"]')) return null;
        const shown = e => Boolean(e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';
        let parent = hit.parentElement;
        for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
          if (parent === document.body || parent === document.documentElement) break;
          if ((parent.innerText || '').length > 3000) break;
          const combos = [...parent.querySelectorAll('mat-select,[role="combobox"],select')].filter(shown);
          const topCombos = combos.filter(e => !combos.some(other => other !== e && other.contains(e)));
          const texts = [...parent.querySelectorAll('button,a,span,label,[role="button"],[role="tab"]')]
            .filter(shown).map(e => (e.innerText || e.getAttribute('aria-label') || '').trim());
          const filters = texts.some(t => /^(?:Show )?(?:Advanced )?Filters?(?:\s*\(\d+\))?$/i.test(t));
          const listMarker = texts.some(t => /^(?:Sort by|Save view)$/i.test(t));
          if (topCombos.length >= 2 && filters && listMarker) {
            const r = hit.getBoundingClientRect();
            return { key: [r.x, r.y, r.width, r.height].join(','), dropdowns: topCombos.length };
          }
        }
        return null;
      }).catch(() => null);
      if (proof && !seen.has(proof.key)) {
        seen.add(proof.key); candidates.push({ locator: item, dropdowns: proof.dropdowns });
      }
    }
  }
  return candidates;
}

export async function prepareExportFilters(page, expectedUrl, options = {}) {
  const timeout = Number(options.timeoutMs ?? 60000);
  const stableMs = Number(options.stableMs ?? 750);
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 300000 ||
      !Number.isFinite(stableMs) || stableMs < 0 || stableMs > 5000) throw new Error('Invalid filter preparation timeout.');
  const started = Date.now();
  const evidence = { version: 18, stage: 'PREPARE_BEFORE_DIRECTION', status: 'WAITING', resetClicks: 0 };
  let clearedSince = null, expanded = false, lastLog = 0, state = null, lastStateKey = null;
  const fail = async code => {
    const context = await filterContext(page);
    const classification = context.classification === 'FILTER_NOT_AVAILABLE' ? code : context.classification;
    const detail = { at: new Date().toISOString(), ...context, classification,
      preparation: { ...evidence, status: 'FAILED', directions: state } };
    if (options.onDiagnostic) await options.onDiagnostic(detail);
    const error = new Error(`${classification}: RXO list filters were not proved clear before direction selection. No export was attempted.`);
    error.code = classification; error.diagnostics = detail; throw error;
  };
  do {
    if (!isFreightListUrl(page.url(), expectedUrl)) return await fail('FILTER_PAGE_MISMATCH');
    const context = await filterContext(page);
    if (context.classification !== 'FILTER_NOT_AVAILABLE') return await fail(context.classification);
    state = await neutralDirectionState(page, options.legacyCollect);
    const stateKey = ['Origin', 'Destination'].map(label => {
      const reasons = [...new Set(state[label].checks.map(item => item.reason))].sort().join(',') || 'NOT_FOUND';
      return `${label}=${state[label].neutral ? 'CLEAR' : 'BLOCKED'}(${reasons})`;
    }).join('; ');
    if (stateKey !== lastStateKey) {
      options.log?.(`[RXO] FILTER STATE: ${stateKey}`);
      lastStateKey = stateKey;
    }
    if (state.Origin.neutral && state.Destination.neutral) {
      if (clearedSince === null) clearedSince = Date.now();
      if (Date.now() - clearedSince >= stableMs) {
        const result = { ...evidence, status: 'READY', directions: state,
          method: evidence.resetClicks ? 'TOOLBAR_RESET_VERIFIED' : 'ALREADY_CLEAR' };
        options.log?.(`[RXO] FILTER PREPARATION: ${result.method}; Origin and Destination are clear.`);
        if (options.onDiagnostic) await options.onDiagnostic({ at: new Date().toISOString(),
          url: safePageUrl(page.url()), classification: 'FILTERS_READY', preparation: result });
        return result;
      }
    } else {
      clearedSince = null;
      if (evidence.resetClicks === 0) {
        const reset = await listToolbarResets(page, expectedUrl);
        if (reset.length > 1) return await fail('FILTER_RESET_AMBIGUOUS');
        if (reset.length === 1) {
          // A timeout is ambiguous: never hammer Reset on this page load.
          evidence.resetClicks = 1;
          options.log?.('[RXO] FILTER PREPARATION: resetting the identified list toolbar; Save view is not clicked.');
          try { await reset[0].locator.click({ timeout: 3000 }); }
          catch { return await fail('FILTER_RESET_CLICK_FAILED'); }
        } else if (!expanded && options.allowReveal !== false) {
          expanded = await revealFilters(page).catch(() => false);
        }
      }
    }
    if (Date.now() - started >= timeout) break;
    if (options.log && Date.now() - lastLog > 5000) {
      options.log(`[RXO] Waiting for both clear direction filters before selection (${Math.round((Date.now()-started)/1000)}s).`);
      lastLog = Date.now();
    }
    await page.waitForTimeout(Math.min(250, Math.max(1, timeout - (Date.now() - started))));
  } while (Date.now() - started <= timeout);
  return await fail(evidence.resetClicks ? 'FILTER_RESET_UNVERIFIED' : 'FILTER_PREPARATION_NOT_AVAILABLE');
}
