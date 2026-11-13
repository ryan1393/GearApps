/**
 * "Jump to section" for clickable summaries (KPI tiles, counts, missing-item chips).
 *
 * Runs after the current change detection so a tab or panel the click just opened
 * exists. Brings the target into view (on phones the page scrolls; on desktop the
 * fitted layout already shows it, so this only adjusts its own scroll area) and moves
 * keyboard focus there. The target must be focusable: a control, or tabindex="-1"/"0".
 */
export function jumpToSection(id: string): void {
  setTimeout(() => {
    const target = document.getElementById(id);
    if (!target) return;
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
  }, 0);
}

/**
 * A remembered on/off choice for this browser (for example "summary collapsed").
 * Storage can be unavailable (private windows, blocked site data); the default is used then.
 */
export function rememberedFlag(key: string, fallback: boolean): { get(): boolean; set(value: boolean): void } {
  const storageKey = `truck-log.${key}`;
  return {
    get() {
      try {
        const value = window.localStorage.getItem(storageKey);
        return value === null ? fallback : value === '1';
      } catch { return fallback; }
    },
    set(value: boolean) {
      try { window.localStorage.setItem(storageKey, value ? '1' : '0'); } catch { /* keep in-memory state only */ }
    },
  };
}
