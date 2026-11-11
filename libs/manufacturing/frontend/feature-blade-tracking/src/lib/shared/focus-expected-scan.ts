/**
 * Put the cursor in the scan box an operation is waiting on: the furthest enabled, visible scan step
 * inside `area`. A barcode scanner types into whatever has the cursor, so this is called whenever the
 * cursor would otherwise be left on a tab or a button that just disappeared.
 *
 * A field inside `area` that the operator is already using keeps the cursor. Returns whether a scan
 * box was focused.
 */
export function focusExpectedScan(area: HTMLElement | null | undefined): boolean {
  if (!area) return false;
  const current = document.activeElement as HTMLElement | null;
  const yielding = !current || current === document.body || Boolean(current.closest('[data-gear-yield-focus]'));
  if (!yielding && area.contains(current)) return false;
  const target = Array.from(area.querySelectorAll<HTMLInputElement>('input[data-gear-scan-step]'))
    .filter((input) => !input.disabled && input.getClientRects().length > 0)
    .sort((a, b) => Number(b.dataset['gearScanStep']) - Number(a.dataset['gearScanStep']))[0];
  if (!target) return false;
  target.focus();
  target.select();
  return true;
}
