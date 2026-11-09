import { chromium } from 'playwright';

console.log('[RXO] Playwright container preflight');
console.log(
  '[RXO] PLAYWRIGHT_BROWSERS_PATH:',
  process.env.PLAYWRIGHT_BROWSERS_PATH || '(not set)'
);

let browser;

try {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  console.log('[RXO] Chromium launch: PASS');
  console.log('[RXO] Chromium version:', browser.version());

  const page = await browser.newPage();
  await page.setContent('<html><body>RXO preflight</body></html>');

  const text = await page.locator('body').innerText();

  if (text.trim() !== 'RXO preflight') {
    throw new Error(
      'Chromium page smoke test returned unexpected content.'
    );
  }

  console.log('[RXO] Chromium page smoke test: PASS');
} catch (error) {
  console.error('[RXO] Playwright/Chromium preflight: FAIL');
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
}
