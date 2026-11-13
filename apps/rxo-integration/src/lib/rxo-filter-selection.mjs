import { normalizeText, visibleItems } from './rxo-filter-common.mjs';
import { clearFilterSearch, dumpOverlayText, typeFilterSearch } from './rxo-filter-input.mjs';
import { captureMissingOptionDiagnostic, waitForOptionCandidates } from './rxo-filter-options.mjs';

/**
 * Selection-state and option-selection rules for an already opened RXO filter.
 * Keeping this separate from page/panel discovery makes selection failures
 * independently testable and easier to diagnose when RXO changes its DOM.
 */
function parseSelectedCount(
  text
) {
  const match =
    normalizeText(
      text
    ).match(
      /Selected\s+(\d+)\s*\/\s*(\d+)/i
    );

  if (!match) {
    return {
      selected: null,
      maximum: null,
      raw: null,
    };
  }

  return {
    selected:
      Number(
        match[1]
      ),

    maximum:
      Number(
        match[2]
      ),

    raw:
      match[0],
  };
}

async function readSelectionState(
  page,
  panel
) {
  const panelText =
    normalizeText(
      await panel
        .innerText()
        .catch(() => '')
    );

  const bodyText =
    normalizeText(
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    );

  const panelCount =
    parseSelectedCount(
      panelText
    );

  const bodyCount =
    parseSelectedCount(
      bodyText
    );

  const count =
    panelCount.raw
      ? panelCount
      : bodyCount;

  const checked = [];

  const selectors = [
    'mat-checkbox.mat-checkbox-checked',
    '.mat-checkbox-checked',
    '[role="checkbox"][aria-checked="true"]',
    '[aria-selected="true"]',
    'mat-option.mat-selected',
    '.mat-option.mat-selected',
  ];

  for (
    const selector
    of selectors
  ) {
    const locator =
      page.locator(
        selector
      );

    const items =
      await visibleItems(
        locator
      );

    for (
      const item
      of items
    ) {
      const text =
        normalizeText(
          await item
            .innerText()
            .catch(() => '')
        );

      if (
        text &&
        !checked.includes(
          text
        )
      ) {
        checked.push(
          text
        );
      }
    }
  }

  return {
    ...count,
    checkedLabels:
      checked.slice(
        0,
        30
      ),
    panelText:
      panelText.slice(
        0,
        5000
      ),
  };
}

async function clickOption(
  page,
  option
) {
  const locator =
    option.locator;

  // Prefer semantic option/checkbox/label ancestor.
  try {
    const semantic =
      locator.locator(
        'xpath=ancestor-or-self::*[' +
        '@role="option" or @role="checkbox" or ' +
        'self::mat-option or self::mat-checkbox or self::label or ' +
        'contains(@class,"default-mat-option") or ' +
        'contains(@class,"mat-option") or ' +
        'contains(@class,"checkbox")' +
        '][1]'
      );

    if (
      (await semantic.count()) > 0
    ) {
      const target =
        semantic.first();

      if (
        await target
          .isVisible({
            timeout: 150,
          })
          .catch(() => false)
      ) {
        try {
          await target.click({
            timeout: 3000,
          });

          await page.waitForTimeout(
            220
          );

          return true;
        } catch {}
      }
    }
  } catch {}

  // Direct locator click.
  try {
    await locator.click({
      timeout: 3000,
    });

    await page.waitForTimeout(
      220
    );

    return true;
  } catch {}

  // Last-resort real mouse click at the center.
  try {
    const box =
      await locator
        .boundingBox();

    if (box) {
      await page.mouse.click(
        box.x +
        box.width / 2,

        box.y +
        box.height / 2
      );

      await page.waitForTimeout(
        220
      );

      return true;
    }
  } catch {}

  return false;
}

async function selectIdentifier({
  page,
  panel,
  input,
  value,
  mode,
  selectAll,
  label,
  caseDir,
}) {
  const before =
    await readSelectionState(
      page,
      panel
    );

  await typeFilterSearch(
    page,
    input,
    value
  );

  const debugText =
    await dumpOverlayText(
      page,
      panel,
      label,
      value
    );

  const options =
    await waitForOptionCandidates({
      page,
      panel,
      value,
      mode,
      label,
      timeoutMs: 12000,
    });

  if (!options.length) {
    const diagnostic =
      await captureMissingOptionDiagnostic({
        page,
        panel,
        input,
        label,
        value,
        caseDir,
      });

    throw new Error(
      `RXO did not render option "${value}" within 12 seconds. ` +
      `Visible option count: ${diagnostic.optionTexts.length}.`
    );
  }

  console.log(
    `[RXO] ${label}: found ${options.length} visible option row(s) matching "${value}".`
  );

  for (
    let i = 0;
    i < Math.min(
      options.length,
      10
    );
    i += 1
  ) {
    console.log(
      `[RXO]   option ${i + 1}: ${options[i].text}`
    );
  }

  const chosen =
    selectAll
      ? options
      : [options[0]];

  const selected = [];

  for (
    const option
    of chosen
  ) {
    console.log(
      `[RXO] Selecting "${option.text}".`
    );

    const ok =
      await clickOption(
        page,
        option
      );

    if (!ok) {
      throw new Error(
        `Could not click RXO option "${option.text}".`
      );
    }

    selected.push(
      option.text
    );
  }

  await clearFilterSearch(
    page,
    input
  );

  const after =
    await readSelectionState(
      page,
      panel
    );

  console.log(
    `[RXO] ${label} selected count: ` +
    `${before.selected ?? '?'} -> ${after.selected ?? '?'}.`
  );

  // RXO does not display "Selected 0/10". After clearPanel(), a missing
  // initial counter therefore means zero selections. Once a row is clicked,
  // RXO has proven the state by showing Selected 1/10, Selected 2/10, etc.
  const beforeCount =
    before.selected ??
    0;

  if (
    after.selected != null
  ) {
    const actualIncrease =
      after.selected -
      beforeCount;

    if (
      actualIncrease <
      selected.length
    ) {
      throw new Error(
        `${label}: clicking "${value}" did not retain all selected rows. ` +
        `Expected count increase >= ${selected.length}; got ${actualIncrease}.`
      );
    }
  } else if (
    after.checkedLabels.length === 0
  ) {
    throw new Error(
      `${label}: selection click completed but RXO exposed neither a Selected count nor checked-state evidence.`
    );
  }

  return {
    search:
      value,

    visibleMatches:
      options.length,

    selectedCount:
      selected.length,

    selected,

    selectionStateBefore:
      before,

    selectionStateAfter:
      after,
  };
}

export { readSelectionState, selectIdentifier };
