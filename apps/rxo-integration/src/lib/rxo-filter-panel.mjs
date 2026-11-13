import path from 'node:path';
import process from 'node:process';
import { filterContext, prepareExportFilters, waitForNamedFilter } from './rxo-filter-readiness.mjs';
import { writeJson } from './rxo-export-runtime.mjs';
import { settleRxoUi } from './rxo-overlay-ui.mjs';
import { DATA_DIR, escapeRegex, visibleItems } from './rxo-filter-common.mjs';

/**
 * Locates and opens RXO filter controls. Selection semantics intentionally
 * remain in rxo-filter-ui.mjs so panel discovery and value selection can evolve
 * independently when RXO changes its Angular Material markup.
 */
async function pageReadyForFilters(page, label = 'Origin', expectedUrl = page.url()) {
  // Navigation can reapply selected values and hide the direction labels.
  // Clear and verify both sides BEFORE choosing either OUTBOUND or INBOUND.
  await prepareExportFilters(page, expectedUrl, {
    timeoutMs: Number(process.env.RXO_FILTER_READY_TIMEOUT_MS || 60000),
    legacyCollect: collectFilterCandidates, log: console.log,
    onDiagnostic: detail => writeJson(path.join(DATA_DIR, 'filter-readiness.json'), detail),
  });
  await waitForNamedFilter(page, label, {
    timeoutMs: Number(process.env.RXO_FILTER_READY_TIMEOUT_MS || 60000),
    legacyCollect: collectFilterCandidates, allowReveal: false, log: console.log,
  });
  return true;
}

async function filterPanelInScope(page) {
  // Confirmed live DOM:
  // .mat-select-panel.multi-select-autocomplete-panel
  const candidates = [
    page.locator(
      '.mat-select-panel.multi-select-autocomplete-panel'
    ),
    page.locator(
      '.mat-select-panel'
    ),
    page.locator(
      '[role="listbox"]'
    ),
  ];

  for (const locator of candidates) {
    const items =
      await visibleItems(locator);

    if (items.length) {
      return items[
        items.length - 1
      ];
    }
  }

  // RXO's popup has visible Apply/Clear even when wrapper class changes.
  const apply =
    await visibleItems(
      page.getByText(/^Apply$/i)
    );

  const clear =
    await visibleItems(
      page.getByText(
        /^(Clear|Clear All)$/i
      )
    );

  if (
    apply.length &&
    clear.length
  ) {
    return page;
  }

  return null;
}

async function filterPanelLocator(page) {
   for (const scope of page.frames()) {
     const panel = await filterPanelInScope(scope);
     if (panel) return panel;
   }
   return null;
 }

async function filterPanelIsOpen(page) {
  return Boolean(
    await filterPanelLocator(
      page
    )
  );
}

async function summarizeCandidate(locator, kind) {
  try {
    return await locator.evaluate(
      (element, candidateKind) => {
        const rect =
          element.getBoundingClientRect();

        return {
          kind: candidateKind,
          tag: element.tagName,
          id: element.id || '',
          className:
            typeof element.className === 'string'
              ? element.className
              : '',
          role:
            element.getAttribute('role') || '',
          ariaLabel:
            element.getAttribute('aria-label') || '',
          placeholder:
            element.getAttribute('placeholder') || '',
          dataPlaceholder:
            element.getAttribute('data-placeholder') || '',
          text:
            (element.innerText || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 200),
          box: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      },
      kind
    );
  } catch {
    return {
      kind,
      error: 'evaluate failed',
    };
  }
}

async function collectFilterCandidates(page, label) {
  const escaped =
    escapeRegex(label);

  const specs = [
    [
      'mat-select-text',
      page
        .locator('mat-select')
        .filter({
          hasText:
            new RegExp(
              escaped,
              'i'
            ),
        }),
    ],
    [
      'role-combobox-name',
      page.getByRole(
        'combobox',
        {
          name:
            new RegExp(
              escaped,
              'i'
            ),
        }
      ),
    ],
    [
      'aria-label',
      page.locator(
        `[aria-label="${label}"]`
      ),
    ],
    [
      'data-placeholder',
      page.locator(
        `[data-placeholder="${label}"]`
      ),
    ],
    [
      'placeholder',
      page.locator(
        `[placeholder="${label}"]`
      ),
    ],
    [
      'mat-form-field-text',
      page
        .locator(
          '.mat-form-field, .mat-mdc-form-field'
        )
        .filter({
          hasText:
            new RegExp(
              escaped,
              'i'
            ),
        }),
    ],
    [
      'plain-text',
      page.getByText(
        new RegExp(
          `^${escaped}$`,
          'i'
        )
      ),
    ],
  ];

  const results = [];
  const seen = new Set();

  for (const [kind, locator] of specs) {
    const items =
      await visibleItems(locator);

    for (const item of items) {
      const summary =
        await summarizeCandidate(
          item,
          kind
        );

      const key =
        [
          summary.tag,
          summary.id,
          summary.className,
          summary.box?.x,
          summary.box?.y,
          summary.box?.width,
          summary.box?.height,
        ].join('|');

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      results.push({
        kind,
        locator: item,
        summary,
      });
    }
  }

  // Critical fallback for RXO: inspect all visible mat-selects/comboboxes
  // because the placeholder may be rendered outside the clickable trigger.
  for (const [kind, locator] of [
    [
      'all-mat-select',
      page.locator('mat-select'),
    ],
    [
      'all-combobox',
      page.locator('[role="combobox"]'),
    ],
  ]) {
    const items =
      await visibleItems(locator);

    for (const item of items) {
      const summary =
        await summarizeCandidate(
          item,
          kind
        );

      const searchable =
        [
          summary.text,
          summary.ariaLabel,
          summary.placeholder,
          summary.dataPlaceholder,
        ].join(' ');

      if (
        new RegExp(
          escaped,
          'i'
        ).test(searchable)
      ) {
        results.push({
          kind,
          locator: item,
          summary,
        });
      }
    }
  }

  return results;
}

async function clickCandidateAndConfirm(
  page,
  candidate,
  label
) {
  const locator =
    candidate.locator;

  // First use a normal Playwright click.
  try {
    await locator.click({
      timeout: 3500,
    });

    await page.waitForTimeout(
      350
    );

    if (
      await filterPanelIsOpen(
        page
      )
    ) {
      console.log(
        `[RXO] Opened ${label} via ${candidate.kind}.`
      );

      return true;
    }
  } catch {}

  // Then click the element's center using a real mouse event.
  try {
    const box =
      await locator.boundingBox();

    if (box) {
      const points = [
        {
          x:
            box.x +
            box.width / 2,

          y:
            box.y +
            box.height / 2,
        },
        {
          x:
            box.x +
            Math.min(
              18,
              box.width * 0.2
            ),

          y:
            box.y +
            box.height / 2,
        },
        {
          x:
            box.x +
            Math.max(
              5,
              box.width -
              Math.min(
                18,
                box.width * 0.2
              )
            ),

          y:
            box.y +
            box.height / 2,
        },
      ];

      for (const point of points) {
        await page.mouse.click(
          point.x,
          point.y
        );

        await page.waitForTimeout(
          350
        );

        if (
          await filterPanelIsOpen(
            page
          )
        ) {
          console.log(
            `[RXO] Opened ${label} via ${candidate.kind} mouse click.`
          );

          return true;
        }
      }
    }
  } catch {}

  // Final targeted fallback: walk to likely Angular Material trigger ancestors.
  try {
    const ancestors = locator.locator(
      'xpath=ancestor-or-self::*[' +
      'self::mat-select or @role="combobox" or ' +
      'contains(@class,"mat-select-trigger") or ' +
      'contains(@class,"mat-form-field") or ' +
      'contains(@class,"multi-select")' +
      ']'
    );

    const count =
      await ancestors.count();

    for (
      let i = 0;
      i < count;
      i += 1
    ) {
      const ancestor =
        ancestors.nth(i);

      if (
        !(await ancestor
          .isVisible({ timeout: 150 })
          .catch(() => false))
      ) {
        continue;
      }

      try {
        await ancestor.click({
          timeout: 2500,
        });

        await page.waitForTimeout(
          350
        );

        if (
          await filterPanelIsOpen(
            page
          )
        ) {
          console.log(
            `[RXO] Opened ${label} via Angular ancestor.`
          );

          return true;
        }
      } catch {}
    }
  } catch {}

  return false;
}

async function openFilter(page, label, diagnostics) {
  await settleRxoUi(page, 'before opening ' + label).catch(() => {});
  const candidates = await waitForNamedFilter(page, label, {
    timeoutMs: Number(process.env.RXO_FILTER_READY_TIMEOUT_MS || 60000),
    legacyCollect: collectFilterCandidates, log: console.log,
    onDiagnostic: detail => writeJson(path.join(DATA_DIR, 'filter-readiness.json'), { at: new Date().toISOString(), ...detail }),
  });
  diagnostics.candidates = candidates.map(candidate => candidate.summary);
  for (const candidate of candidates) {
    if (await clickCandidateAndConfirm(page, candidate, label)) {
      diagnostics.openedWith = candidate.summary;
      return await filterPanelLocator(page);
    }
  }
  const detail = await filterContext(page);
  writeJson(path.join(DATA_DIR, 'filter-readiness.json'), { at: new Date().toISOString(), label, ...detail });
  throw new Error(label + ': labeled candidates exist but none opened the filter panel. No unfiltered export was attempted.');
}


export {
  collectFilterCandidates,
  filterPanelIsOpen,
  filterPanelLocator,
  openFilter,
  pageReadyForFilters,
  summarizeCandidate,
};
