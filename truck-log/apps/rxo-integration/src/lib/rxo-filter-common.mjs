import path from 'node:path';
import process from 'node:process';
import { mkdirp } from './rxo-export-runtime.mjs';

/**
 * Shared constants and small DOM/runtime helpers for RXO filter automation.
 * This module intentionally contains no filter workflow decisions.
 */
export const DATA_DIR = path.resolve(process.env.RXO_DATA_DIR || '/app/data');
const CAPTURE_FAILURE_SCREENSHOT = !/^(0|false|no)$/i.test(
  process.env.RXO_CAPTURE_FAILURE_SCREENSHOT || 'false'
);

export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

const RXO_BASE = 'https://customer.rxoconnect.rxo.com';

export const FORT_WAYNE_CODE = '12808';
export const FORT_WAYNE_LEGACY = 'DANA_USA_FORT_WAYNE_IN';

export const PAGE_CASES = [
  { key: 'orders', name: 'Orders', url: `${RXO_BASE}/orders/list` },
  { key: 'freight-on-the-move', name: 'Freight On The Move', url: `${RXO_BASE}/active-shipments` },
  {
    key: 'shipments',
    name: 'Shipments',
    // Confirmed from the live RXO route used by the production worker.
    url: `${RXO_BASE}/shipment-freight`,
  },
];

export function safeFileName(value) {
  return String(value)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export async function visibleItems(locator) {
  const output = [];
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);
    if (await item.isVisible({ timeout: 150 }).catch(() => false)) output.push(item);
  }
  return output;
}

export async function takeShot(page, dir, name) {
  if (!CAPTURE_FAILURE_SCREENSHOT) return null;
  mkdirp(dir);
  const file = path.join(dir, `${safeFileName(name)}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}
