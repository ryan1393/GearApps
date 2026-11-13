import { escapeRegex, normalizeText, visibleItems } from './rxo-filter-common.mjs';

/**
 * Low-level interaction helpers for the RXO filter overlay. These functions
 * know how to find/search/click the current Angular controls but do not decide
 * which Fort Wayne identifiers must be selected.
 */
/**
 * Applies values inside an already-discovered RXO filter panel. Discovery is
 * isolated in rxo-filter-panel.mjs; constants and low-level helpers live in
 * rxo-filter-common.mjs. Keeping these layers separate makes RXO DOM changes
 * easier to diagnose without changing the shipment-selection rules.
 */
async function getPanelSearchInput(
  page,
  panel,
  label
) {
  // Confirmed live selector from DevTools screenshot:
  // input.mat-input-element ... placeholder="Origin"
  // data-placeholder="Origin"
  const selectors = [
    `input[placeholder="${label}"]`,
    `input[data-placeholder="${label}"]`,
    `input.mat-input-element[placeholder="${label}"]`,
    'input.mat-select-search-input-without-check-all',
    'input[autocomplete="off"]',
  ];

  for (const selector of selectors) {
    const locator =
      panel.locator(selector);

    const items =
      await visibleItems(locator);

    if (items.length) {
      return items[
        items.length - 1
      ];
    }
  }

  // Panel scoping may be page-wide fallback.
  for (const selector of selectors) {
    const locator =
      page.locator(selector);

    const items =
      await visibleItems(locator);

    if (items.length) {
      return items[
        items.length - 1
      ];
    }
  }

  return null;
}

async function clickPanelButton(
  page,
  panel,
  pattern
) {
  const candidates = [
    panel.getByRole(
      'button',
      {
        name: pattern,
      }
    ),
    panel
      .locator('button')
      .filter({
        hasText: pattern,
      }),
    panel.getByText(pattern),
  ];

  for (const locator of candidates) {
    const items =
      await visibleItems(locator);

    if (items.length) {
      const target =
        items[
          items.length - 1
        ];

      try {
        await target.click({
          timeout: 3000,
        });

        await page.waitForTimeout(
          250
        );

        return true;
      } catch {}
    }
  }

  // Page-wide fallback for popup action buttons.
  const pageItems =
    await visibleItems(
      page.getByText(pattern)
    );

  if (pageItems.length) {
    try {
      await pageItems[
        pageItems.length - 1
      ].click({
        timeout: 3000,
      });

      await page.waitForTimeout(
        250
      );

      return true;
    } catch {}
  }

  return false;
}

async function clearPanel(
  page,
  panel
) {
  const cleared =
    await clickPanelButton(
      page,
      panel,
      /^(Clear|Clear All)$/i
    );

  if (cleared) {
    console.log(
      '[RXO] Cleared existing selections.'
    );
  }

  return cleared;
}

async function typeFilterSearch(
  page,
  input,
  value
) {
  await input.click({
    timeout: 3000,
  });

  await input.fill('');

  await input.pressSequentially(
    value,
    {
      delay: 80,
    }
  );

  // Some Angular builds debounce from native input/change events.
  await input.dispatchEvent(
    'input'
  ).catch(() => {});

  await input.dispatchEvent(
    'change'
  ).catch(() => {});

  await page.waitForTimeout(
    450
  );

  const actualValue =
    await input
      .inputValue()
      .catch(() => '');

  console.log(
    `[RXO] Search input value after typing: "${actualValue}".`
  );

  if (
    normalizeText(
      actualValue
    ) !==
    normalizeText(
      value
    )
  ) {
    throw new Error(
      `RXO search input did not retain "${value}". Actual value: "${actualValue}".`
    );
  }

  return actualValue;
}

async function clearFilterSearch(
  page,
  input
) {
  await input.click({
    timeout: 2500,
  }).catch(() => {});

  await input.fill('')
    .catch(() => {});

  await input.dispatchEvent(
    'input'
  ).catch(() => {});

  await input.dispatchEvent(
    'change'
  ).catch(() => {});

  await page.waitForTimeout(
    650
  );
}

async function dumpOverlayText(
  page,
  panel,
  label,
  value
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

  console.log(
    `[RXO] ${label} search "${value}" panel text: ` +
    `${panelText.slice(0, 700)}`
  );

  return {
    panelText:
      panelText.slice(
        0,
        5000
      ),

    bodyText:
      bodyText.slice(
        0,
        12000
      ),
  };
}

function queryPattern(
  value,
  mode
) {
  if (
    mode === 'code'
  ) {
    // Do NOT anchor at the beginning. RXO may render a checkbox/label prefix,
    // invisible text, or an internal location label before the displayed code.
    return new RegExp(
      `(?:^|\\b)${escapeRegex(value)}(?:\\b|\\s*[-–—])`,
      'i'
    );
  }

  return new RegExp(
    escapeRegex(
      value
    ),
    'i'
  );
}

export {
  clearFilterSearch,
  clearPanel,
  clickPanelButton,
  dumpOverlayText,
  getPanelSearchInput,
  queryPattern,
  typeFilterSearch,
};
