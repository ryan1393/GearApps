import { settleRxoUi } from './rxo-overlay-ui.mjs';
import {
  FORT_WAYNE_CODE,
  FORT_WAYNE_LEGACY,
  PAGE_CASES,
  normalizeText,
  takeShot,
  visibleItems,
} from './rxo-filter-common.mjs';
import {
  collectFilterCandidates,
  filterPanelIsOpen,
  filterPanelLocator,
  openFilter,
  pageReadyForFilters,
  summarizeCandidate,
} from './rxo-filter-panel.mjs';
import { clearFilterSearch, clearPanel, clickPanelButton, getPanelSearchInput } from './rxo-filter-input.mjs';
import { readSelectionState, selectIdentifier } from './rxo-filter-selection.mjs';

/**
 * Fort Wayne filter orchestration. Discovery, low-level input interaction and
 * selection-state logic live in focused sibling modules; this file owns only
 * the business sequence that applies and verifies the required identifiers.
 */
async function applyFortWayneFilter(
  page,
  label,
  caseDir
) {
  const diagnostics = {
    filter: label,
    urlBefore:
      page.url(),
    startedAt:
      new Date()
        .toISOString(),
  };

  const panel =
    await openFilter(
      page,
      label,
      diagnostics
    );

  await takeShot(
    page,
    caseDir,
    `${label}-opened`
  );

  await clearPanel(
    page,
    panel
  );

  const input =
    await getPanelSearchInput(
      page,
      panel,
      label
    );

  if (!input) {
    throw new Error(
      `${label}: mat-select panel opened, but its search input was not found.`
    );
  }

  diagnostics.searchInput =
    await summarizeCandidate(
      input,
      'panel-search-input'
    );

  const initialState =
    await readSelectionState(
      page,
      panel
    );

  diagnostics.initialSelectionState =
    initialState;

  diagnostics.code =
    await selectIdentifier({
      page,
      panel,
      input,
      value:
        FORT_WAYNE_CODE,
      mode:
        'code',
      selectAll:
        true,
      label,
      caseDir,
    });

  diagnostics.legacy =
    await selectIdentifier({
      page,
      panel,
      input,
      value:
        FORT_WAYNE_LEGACY,
      mode:
        'text',
      selectAll:
        false,
      label,
      caseDir,
    });

  await clearFilterSearch(
    page,
    input
  );

  diagnostics.beforeApply =
    await readSelectionState(
      page,
      panel
    );

  await takeShot(
    page,
    caseDir,
    `${label}-both-selected`
  );

  const expectedAdded =
    diagnostics.code.selectedCount +
    diagnostics.legacy.selectedCount;

  // clearPanel() runs before either Fort Wayne selection. RXO normally hides
  // the counter when zero rows are selected, so null here is a valid zero.
  const initialCount =
    initialState.selected ??
    0;

  // Prefer the final read, then the state returned immediately after the
  // legacy selection, then the state after the code selection.
  const finalKnownCount =
    diagnostics.beforeApply.selected ??
    diagnostics.legacy
      .selectionStateAfter
      ?.selected ??
    diagnostics.code
      .selectionStateAfter
      ?.selected ??
    null;

  if (
    finalKnownCount != null
  ) {
    const actualAdded =
      finalKnownCount -
      initialCount;

    console.log(
      `[RXO] ${label}: expected ${expectedAdded} Fort Wayne selection(s); ` +
      `Angular selected count is ${finalKnownCount} ` +
      `(increase ${actualAdded} from cleared state).`
    );

    if (
      actualAdded <
      expectedAdded
    ) {
      throw new Error(
        `${label}: Angular selected count did not retain all Fort Wayne selections. ` +
        `Expected +${expectedAdded}, got +${actualAdded}.`
      );
    }

    diagnostics.verification = {
      method:
        'ANGULAR_SELECTED_COUNT',

      initialCount,

      finalCount:
        finalKnownCount,

      expectedAdded,

      actualAdded,
    };
  } else {
    // Only use checked-state labels when RXO exposes no Selected X/Y counter
    // at any stage. This should be uncommon.
    const checkedText =
      normalizeText(
        [
          ...diagnostics.code
            .selectionStateAfter
            .checkedLabels,

          ...diagnostics.legacy
            .selectionStateAfter
            .checkedLabels,

          ...diagnostics.beforeApply
            .checkedLabels,
        ].join(' ')
      );

    if (
      !/\b12808\b/i.test(
        checkedText
      ) ||
      !/DANA_USA_FORT_WAYNE_IN/i.test(
        checkedText
      )
    ) {
      throw new Error(
        `${label}: could not verify both Fort Wayne selections by Angular count or checked-state labels.`
      );
    }

    diagnostics.verification = {
      method:
        'CHECKED_STATE_LABELS',

      checkedText:
        checkedText.slice(
          0,
          4000
        ),
    };
  }

  const applied =
    await clickPanelButton(
      page,
      panel,
      /^Apply$/i
    );

  if (!applied) {
    throw new Error(
      `${label}: Apply could not be clicked.`
    );
  }

  await page.waitForTimeout(
    700
  );

  if (
    await filterPanelIsOpen(
      page
    )
  ) {
    throw new Error(
      `${label}: mat-select panel remained open after Apply.`
    );
  }

  diagnostics.status =
    'PASS';

  diagnostics.appliedAt =
    new Date()
      .toISOString();

  await takeShot(
    page,
    caseDir,
    `${label}-applied`
  );

  return diagnostics;
}

async function loadPageForFilterTest(
  page,
  pageCase,
  label
) {
  const attempts = [
    'goto',
    'reload',
    'hard-goto',
  ];

  const diagnostics = [];

  for (
    let index = 0;
    index < attempts.length;
    index += 1
  ) {
    const mode =
      attempts[index];

    console.log(
      `[RXO] ${pageCase.name} ${label}: page load attempt ${index + 1}/3 (${mode}).`
    );

    try {
      if (
        mode === 'goto'
      ) {
        await page.goto(
          pageCase.url,
          {
            waitUntil:
              'domcontentloaded',

            timeout:
              120000,
          }
        );
      } else if (
        mode === 'reload'
      ) {
        await page.reload({
          waitUntil:
            'domcontentloaded',

          timeout:
            120000,
        });
      } else {
        // Force the SPA/document to be recreated instead of letting an
        // in-app same-route navigation preserve a stale Angular state.
        await page.goto(
          'about:blank',
          {
            waitUntil:
              'domcontentloaded',

            timeout:
              30000,
          }
        );

        await page.waitForTimeout(
          350
        );

        await page.goto(
          pageCase.url,
          {
            waitUntil:
              'domcontentloaded',

            timeout:
              120000,
          }
        );
      }

      await page.waitForTimeout(
        1400 +
        index * 900
      );

      await settleRxoUi(
        page,
        `after loading ${pageCase.name} for ${label}`
      ).catch(() => {});

      const ready =
        await pageReadyForFilters(
          page,
          label,
          pageCase.url
        );

      diagnostics.push({
        attempt:
          index + 1,

        mode,

        ready,

        url:
          page.url(),
      });

      if (ready) {
        if (
          index > 0
        ) {
          console.log(
            `[RXO] ${pageCase.name} ${label}: filter controls recovered on attempt ${index + 1}.`
          );
        }

        return diagnostics;
      }
    } catch (error) {
      diagnostics.push({
        attempt:
          index + 1,

        mode,

        ready:
          false,

        url:
          page.url(),

        error:
          error?.message ||
          String(error),
      });
    }
  }

  const lastError = [...diagnostics].reverse().find(item => item.error)?.error;
  throw new Error(
    `${pageCase.name}: filter preparation failed after 3 page-load strategies.` +
    (lastError ? ` Last failure: ${lastError}` : '')
  );
}

export {
  FORT_WAYNE_CODE,
  FORT_WAYNE_LEGACY,
  PAGE_CASES,
  applyFortWayneFilter,
  collectFilterCandidates,
  filterPanelLocator,
  loadPageForFilterTest,
  openFilter,
  pageReadyForFilters,
  settleRxoUi,
  takeShot,
  visibleItems,
};
