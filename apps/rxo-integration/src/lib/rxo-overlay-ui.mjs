async function visibleCdkBackdropCount(page) {
  try {
    return await page
      .locator('.cdk-overlay-backdrop.cdk-overlay-backdrop-showing')
      .count();
  } catch {
    return 0;
  }
}

async function visibleCdkOverlayText(page) {
  try {
    const panes = page.locator('.cdk-overlay-pane');
    const count = await panes.count();

    for (let i = count - 1; i >= 0; i -= 1) {
      const pane = panes.nth(i);

      if (await pane.isVisible({ timeout: 300 }).catch(() => false)) {
        const text = (await pane.innerText().catch(() => ''))
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 240);

        if (text) {
          return text;
        }
      }
    }
  } catch {}

  return '';
}

async function tryCloseVisibleOverlayPane(page) {
  const panes = page.locator(
    '.cdk-overlay-pane, mat-dialog-container, [role="dialog"], .mat-mdc-dialog-container'
  );

  const count = await panes.count().catch(() => 0);

  for (let i = count - 1; i >= 0; i -= 1) {
    const pane = panes.nth(i);

    if (!(await pane.isVisible({ timeout: 400 }).catch(() => false))) {
      continue;
    }

    const text = (await pane.innerText().catch(() => ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);

    if (text) {
      console.log(`[RXO] Visible overlay content: ${text}`);
    }

    const explicitCloseCandidates = [
      pane.getByRole('button', {
        name: /^(close|dismiss|got it|ok|okay|done|continue)$/i,
      }),
      pane.locator('button[aria-label*="close" i]'),
      pane.locator('button[aria-label*="dismiss" i]'),
      pane.locator('button[title*="close" i]'),
      pane.locator('button[title*="dismiss" i]'),
      pane.locator('[role="button"][aria-label*="close" i]'),
      pane.locator('[role="button"][aria-label*="dismiss" i]'),
      pane.locator('button').filter({
        has: pane.locator('mat-icon').filter({
          hasText: /^(close|cancel|clear)$/i,
        }),
      }),
      pane.locator('button').filter({
        has: pane.locator('.mat-icon').filter({
          hasText: /^(close|cancel|clear)$/i,
        }),
      }),
      pane.locator('button').filter({
        has: pane.locator('svg[aria-label*="close" i]'),
      }),
      pane.locator('button').filter({
        hasText: /^(close|dismiss|got it|ok|okay|done)$/i,
      }),
    ];

    for (const candidate of explicitCloseCandidates) {
      try {
        if (
          (await candidate.count()) > 0 &&
          await candidate.first().isVisible({ timeout: 500 })
        ) {
          const label = (
            await candidate.first().innerText().catch(() => '')
          ).trim();

          console.log(
            `[RXO] Closing overlay using ${label ? `"${label}"` : 'its close control'}...`
          );

          await candidate.first().click({ timeout: 5000 });
          await page.waitForTimeout(700);

          if ((await visibleCdkBackdropCount(page)) === 0) {
            return true;
          }

          // Even when another transparent CDK layer remains, the actual dialog
          // may already be gone. Re-evaluate the pane itself.
          if (!(await pane.isVisible({ timeout: 500 }).catch(() => false))) {
            return true;
          }
        }
      } catch {
        // Try the next close candidate.
      }
    }

    // RXO's "What's new in Connect?" release-notes popup can use an
    // unlabeled icon-only button. Restrict this fallback to known release-note
    // content so we do not click arbitrary controls on unrelated dialogs.
    if (/what['’]s new in connect|features from release/i.test(text)) {
      const buttons = pane.locator('button');
      const buttonCount = await buttons.count().catch(() => 0);

      for (let b = 0; b < buttonCount; b += 1) {
        const button = buttons.nth(b);

        try {
          if (!(await button.isVisible({ timeout: 300 }))) {
            continue;
          }

          const metadata = await button.evaluate(element => ({
            text: (element.innerText || '').trim(),
            ariaLabel: element.getAttribute('aria-label') || '',
            title: element.getAttribute('title') || '',
            className: element.className || '',
            html: element.innerHTML.slice(0, 500),
          }));

          const searchable = [
            metadata.text,
            metadata.ariaLabel,
            metadata.title,
            metadata.className,
            metadata.html,
          ].join(' ');

          if (
            /close|dismiss|cancel|clear|times|cross|mat-icon[^>]*>close|svg/i
              .test(searchable)
          ) {
            console.log(
              '[RXO] Closing the RXO release-notes popup using its icon button...'
            );

            await button.click({ timeout: 5000 });
            await page.waitForTimeout(700);

            if (!(await pane.isVisible({ timeout: 500 }).catch(() => false))) {
              return true;
            }
          }
        } catch {
          // Continue scanning visible buttons.
        }
      }
    }
  }

  return false;
}

async function settleRxoUi(page, reason = 'before interaction') {
  // RXO uses Angular Material/CDK overlays. Some are temporary menus/loaders;
  // the post-login "What's new in Connect?" release-notes popup is a real modal
  // and must be closed from inside the overlay rather than by force-clicking
  // the scorecard underneath it.
  await page.waitForTimeout(1000);

  try {
    await page
      .locator('.cdk-overlay-backdrop.cdk-overlay-backdrop-showing')
      .last()
      .waitFor({ state: 'hidden', timeout: 3500 });

    return;
  } catch {
    // An overlay is still present.
  }

  let count = await visibleCdkBackdropCount(page);

  if (count === 0) {
    return;
  }

  const overlayText = await visibleCdkOverlayText(page);

  console.log(
    `[RXO] Angular overlay detected ${reason}` +
    (overlayText ? `: ${overlayText}` : '.')
  );

  // First try the actual overlay/dialog close controls. This is required for
  // RXO's release-notes modal, whose backdrop is intentionally non-dismissible.
  if (await tryCloseVisibleOverlayPane(page)) {
    await page.waitForTimeout(500);

    count = await visibleCdkBackdropCount(page);

    if (count === 0) {
      console.log('[RXO] Overlay closed using its dialog control.');
      return;
    }
  }

  // Then use normal dismiss behavior for menus, date pickers, autocomplete,
  // and other dismissible Material overlays.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.keyboard.press('Escape');
    } catch {}

    await page.waitForTimeout(500);

    count = await visibleCdkBackdropCount(page);

    if (count === 0) {
      console.log('[RXO] Overlay dismissed with Escape.');
      return;
    }

    try {
      const backdrop = page
        .locator('.cdk-overlay-backdrop.cdk-overlay-backdrop-showing')
        .last();

      if (await backdrop.isVisible({ timeout: 700 })) {
        await backdrop.click({
          position: { x: 5, y: 5 },
          timeout: 2000,
        });
      }
    } catch {}

    await page.waitForTimeout(500);

    count = await visibleCdkBackdropCount(page);

    if (count === 0) {
      console.log('[RXO] Overlay dismissed by clicking its backdrop.');
      return;
    }

    // Re-check for an explicit dialog close button after each normal dismissal
    // attempt because some Angular animations reveal it slightly later.
    if (await tryCloseVisibleOverlayPane(page)) {
      await page.waitForTimeout(500);

      count = await visibleCdkBackdropCount(page);

      if (count === 0) {
        console.log('[RXO] Overlay closed using its dialog control.');
        return;
      }
    }
  }

  const remainingText = await visibleCdkOverlayText(page);

  throw new Error(
    'RXO overlay is still blocking the scorecard after normal dismissal attempts' +
    (remainingText ? ` (${remainingText})` : '') + '.'
  );
}

export { settleRxoUi };
