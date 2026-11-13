import path from 'node:path';
import { writeJson } from './rxo-export-runtime.mjs';
import { normalizeText, safeFileName, takeShot } from './rxo-filter-common.mjs';
import { queryPattern } from './rxo-filter-input.mjs';

/**
 * Option discovery for an opened RXO filter: which rows are visible, which
 * match an identifier, and the diagnostic captured when an option is missing.
 */
async function currentVisibleOptionTexts(
  page,
  panel
) {
  const selectors = [
    '.default-mat-option',
    '[class~="default-mat-option"]',
    '.mat-option',
    'mat-option',
    '[role="option"]',
    'mat-checkbox',
    '[role="checkbox"]',
  ];

  const texts = new Set();

  for (const scope of [panel, page]) {
    for (const selector of selectors) {
      const locator = scope.locator(selector);
      const count = await locator.count().catch(() => 0);
      const limit = Math.min(count, 80);

      for (let i = 0; i < limit; i += 1) {
        const item = locator.nth(i);

        if (
          !(await item
            .isVisible({ timeout: 80 })
            .catch(() => false))
        ) {
          continue;
        }

        const text = normalizeText(
          await item.innerText().catch(() => '')
        );

        if (text) {
          texts.add(text);
        }
      }
    }
  }

  return [...texts].slice(0, 80);
}

async function captureMissingOptionDiagnostic({
  page,
  panel,
  input,
  label,
  value,
  caseDir,
}) {
  const optionTexts =
    await currentVisibleOptionTexts(page, panel);

  const panelText = normalizeText(
    await panel.innerText().catch(() => '')
  );

  const inputValue =
    await input.inputValue().catch(() => '');

  const diagnostic = {
    label,
    value,
    inputValue,
    optionTexts,
    panelText: panelText.slice(0, 5000),
    capturedAt: new Date().toISOString(),
  };

  writeJson(
    path.join(
      caseDir,
      `${safeFileName(label)}-${safeFileName(value)}-missing-after-wait.json`
    ),
    diagnostic
  );

  await takeShot(
    page,
    caseDir,
    `${label}-${value}-missing-after-wait`
  );

  return diagnostic;
}

async function optionCandidates(
  page,
  panel,
  value,
  mode
) {
  const pattern = queryPattern(value, mode);

  const selectors = [
    '.default-mat-option',
    '[class~="default-mat-option"]',
    '.mat-option',
    'mat-option',
    '[role="option"]',
    'mat-checkbox',
    '[role="checkbox"]',
  ];

  const results = [];
  const seen = new Set();

  for (const scope of [panel, page]) {
    for (const selector of selectors) {
      const locator =
        scope.locator(selector).filter({
          hasText: pattern,
        });

      const count =
        await locator.count().catch(() => 0);

      const limit =
        Math.min(count, 20);

      for (let i = 0; i < limit; i += 1) {
        const item = locator.nth(i);

        if (
          !(await item
            .isVisible({ timeout: 100 })
            .catch(() => false))
        ) {
          continue;
        }

        const text = normalizeText(
          await item.innerText().catch(() => '')
        );

        if (
          !text ||
          !pattern.test(text) ||
          seen.has(text)
        ) {
          continue;
        }

        seen.add(text);

        results.push({
          text,
          locator: item,
          selector,
        });
      }
    }
  }

  if (!results.length) {
    const raw = page.getByText(pattern);
    const count =
      await raw.count().catch(() => 0);
    const limit =
      Math.min(count, 12);

    for (let i = 0; i < limit; i += 1) {
      const item = raw.nth(i);

      if (
        !(await item
          .isVisible({ timeout: 100 })
          .catch(() => false))
      ) {
        continue;
      }

      const text = normalizeText(
        await item.innerText().catch(() => '')
      );

      if (
        text &&
        pattern.test(text) &&
        !seen.has(text)
      ) {
        seen.add(text);

        results.push({
          text,
          locator: item,
          selector: 'getByText',
        });
      }
    }
  }

  return results;
}

async function waitForOptionCandidates({
  page,
  panel,
  value,
  mode,
  label,
  timeoutMs = 12000,
}) {
  const started = Date.now();
  let lastLogAt = -2500;

  while (
    Date.now() - started <
    timeoutMs
  ) {
    const options =
      await optionCandidates(
        page,
        panel,
        value,
        mode
      );

    if (options.length) {
      const elapsed =
        Date.now() - started;

      if (elapsed >= 700) {
        console.log(
          `[RXO] ${label}: option "${value}" appeared after ${elapsed} ms.`
        );
      }

      return options;
    }

    const elapsed =
      Date.now() - started;

    if (
      elapsed - lastLogAt >=
      2500
    ) {
      console.log(
        `[RXO] ${label}: waiting for RXO option "${value}" to render... ` +
        `${Math.round(elapsed / 1000)}s`
      );

      lastLogAt = elapsed;
    }

    await page.waitForTimeout(350);
  }

  return [];
}

export { currentVisibleOptionTexts, captureMissingOptionDiagnostic, optionCandidates, waitForOptionCandidates };
