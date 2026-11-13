/**
 * Packing-slip watcher routes (Truck Log server <-> SAP capture queue watcher).
 *
 * The route settings of the SAP watcher on the print PC are configured in the
 * Truck Log webpage (Administration > Printing). The watcher keeps only
 * machine-local things (folders, timings, the Truck Log connection) in its INI.
 *
 * HTTP API (all under /api/v1):
 *
 *   Watcher (Print Agent bearer token, scope documents:upload):
 *     GET /print-agents/packing-slip-routes          -> PackingSlipRouteConfig, ETag "<version>"
 *         If-None-Match: "<version>"                  -> 304 when unchanged
 *
 *   Webpage:
 *     GET /admin/packing-slip-routes                 -> PackingSlipRouteConfig (paired station or administrator)
 *     PUT /admin/packing-slip-routes  {version, routes, confirmLive}
 *                                                    -> PackingSlipRouteConfig (administrator, CSRF)
 *         400 PACKING_SLIP_ROUTES_INVALID            a route breaks the rules below (issues[] names them)
 *         400 PACKING_SLIP_ROUTES_CONFIRM_LIVE       confirmLive does not list exactly the routes newly set to LIVE
 *         409 PACKING_SLIP_ROUTES_STALE              someone else saved first; reload and edit again
 *
 * Mode meaning (both sides agree):
 *   OFF   route ignored: capture file not read
 *   TEST  verify, file under Ready/NeedsReview, upload if uploadEnabled; never print to paper
 *   LIVE  as TEST, plus print verified slips to outputPrinter (unverified slips are never printed)
 *
 * This module is pure (no Angular, Nest or Node imports): the server, the web
 * client and the contract test all run the same validation.
 */
export const PACKING_SLIP_ROUTE_COUNT = 8;
export const PACKING_SLIP_ROUTE_NAME_MAX = 60;
export const PACKING_SLIP_ROUTE_QUEUE_MAX = 120;
/** Upper bound of a valid UNC printer path: \\ + host (unbounded by the rule) + \ + 200. Kept generous for the DB column. */
export const PACKING_SLIP_ROUTE_PRINTER_MAX = 260;

export const PackingSlipRouteModes = {
  OFF: 'OFF',
  TEST: 'TEST',
  LIVE: 'LIVE',
} as const;
export type PackingSlipRouteMode = (typeof PackingSlipRouteModes)[keyof typeof PackingSlipRouteModes];
export const PACKING_SLIP_ROUTE_MODES: readonly PackingSlipRouteMode[] = ['OFF', 'TEST', 'LIVE'];

export interface PackingSlipRoute {
  route: number;
  name: string;
  sourceQueue: string;
  /** UNC printer queue, e.g. \\USFTWPLVPS03\USFTWP_DGL_Ricoh. Required for LIVE, may be empty otherwise. */
  outputPrinter: string;
  mode: PackingSlipRouteMode;
  uploadEnabled: boolean;
}

export interface PackingSlipRouteConfig {
  /** Positive integer; increases on every saved change. Also the ETag. */
  version: number;
  updatedAt: string;
  updatedBy: string;
  /** Always exactly routes 1..8, sorted by route. */
  routes: PackingSlipRoute[];
}

export interface PackingSlipRouteUpdateRequest {
  version: number;
  routes: PackingSlipRoute[];
  /** Exactly the routes this save newly switches to LIVE (empty when none). */
  confirmLive: number[];
}

export type PackingSlipRouteField = 'route' | 'name' | 'sourceQueue' | 'outputPrinter' | 'mode' | 'uploadEnabled';
export interface PackingSlipRouteIssue {
  /** 0 when the problem is with the whole document. */
  route: number;
  field: PackingSlipRouteField | 'routes';
  message: string;
}

/** UNC printer queue: \\host\queue (contract regex, verbatim). */
export const PACKING_SLIP_PRINTER_PATTERN = /^\\\\[A-Za-z0-9._-]+\\[^\\/:*?"<>|\x00-\x1f]{1,200}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Check and normalize the eight routes. Strings are trimmed after the
 * control-character check, so a tab or line break anywhere is refused.
 */
export function validatePackingSlipRoutes(value: unknown): { routes: PackingSlipRoute[]; issues: PackingSlipRouteIssue[] } {
  const issues: PackingSlipRouteIssue[] = [];
  if (!Array.isArray(value) || value.length !== PACKING_SLIP_ROUTE_COUNT) {
    return { routes: [], issues: [{ route: 0, field: 'routes', message: `Exactly ${PACKING_SLIP_ROUTE_COUNT} routes are required.` }] };
  }
  const routes: PackingSlipRoute[] = [];
  const seen = new Set<number>();
  for (const raw of value) {
    const item = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const route = item['route'];
    if (typeof route !== 'number' || !Number.isInteger(route) || route < 1 || route > PACKING_SLIP_ROUTE_COUNT || seen.has(route)) {
      issues.push({ route: 0, field: 'routes', message: `Routes must be numbered 1 to ${PACKING_SLIP_ROUTE_COUNT}, each once.` });
      continue;
    }
    seen.add(route);
    const text = (field: 'name' | 'sourceQueue' | 'outputPrinter', label: string): string => {
      const v = item[field];
      if (typeof v !== 'string') { issues.push({ route, field, message: `${label} must be text.` }); return ''; }
      if (CONTROL_CHARACTERS.test(v)) { issues.push({ route, field, message: `${label} must not contain control characters (tabs, line breaks).` }); return v; }
      return v.trim();
    };
    const name = text('name', 'Name');
    const sourceQueue = text('sourceQueue', 'SAP capture queue');
    const outputPrinter = text('outputPrinter', 'Output printer');
    const mode = item['mode'];
    const uploadEnabled = item['uploadEnabled'];
    if (!issues.some((i) => i.route === route && i.field === 'name') && (name.length < 1 || name.length > PACKING_SLIP_ROUTE_NAME_MAX)) {
      issues.push({ route, field: 'name', message: `Name must be 1 to ${PACKING_SLIP_ROUTE_NAME_MAX} characters.` });
    }
    if (!issues.some((i) => i.route === route && i.field === 'sourceQueue') && (sourceQueue.length < 1 || sourceQueue.length > PACKING_SLIP_ROUTE_QUEUE_MAX)) {
      issues.push({ route, field: 'sourceQueue', message: `SAP capture queue must be 1 to ${PACKING_SLIP_ROUTE_QUEUE_MAX} characters.` });
    }
    if (typeof mode !== 'string' || !(PACKING_SLIP_ROUTE_MODES as readonly string[]).includes(mode)) {
      issues.push({ route, field: 'mode', message: 'Mode must be Off, Test or Live.' });
    }
    if (typeof uploadEnabled !== 'boolean') {
      issues.push({ route, field: 'uploadEnabled', message: 'Upload to Truck Log must be on or off.' });
    }
    if (!issues.some((i) => i.route === route && i.field === 'outputPrinter')) {
      if (outputPrinter && !PACKING_SLIP_PRINTER_PATTERN.test(outputPrinter)) {
        issues.push({ route, field: 'outputPrinter', message: 'Output printer must be a shared printer path like \\\\SERVER\\Printer_Name.' });
      } else if (!outputPrinter && mode === PackingSlipRouteModes.LIVE) {
        issues.push({ route, field: 'outputPrinter', message: 'A Live route needs an output printer.' });
      }
    }
    routes.push({ route, name, sourceQueue, outputPrinter, mode: mode as PackingSlipRouteMode, uploadEnabled: uploadEnabled === true });
  }
  routes.sort((a, b) => a.route - b.route);
  // A SAP capture queue may feed only one active route (Windows queue names ignore case).
  const owners = new Map<string, number>();
  for (const r of routes) {
    if (r.mode === PackingSlipRouteModes.OFF || !r.sourceQueue) continue;
    const key = r.sourceQueue.toLowerCase();
    const first = owners.get(key);
    if (first !== undefined) issues.push({ route: r.route, field: 'sourceQueue', message: `Route ${first} already uses this SAP capture queue.` });
    else owners.set(key, r.route);
  }
  return { routes, issues };
}

/** Routes that are LIVE in `next` but were not LIVE in `saved`, ascending. */
export function newlyLivePackingSlipRoutes(saved: readonly PackingSlipRoute[], next: readonly PackingSlipRoute[]): number[] {
  const before = new Map(saved.map((r) => [r.route, r.mode]));
  return next
    .filter((r) => r.mode === PackingSlipRouteModes.LIVE && before.get(r.route) !== PackingSlipRouteModes.LIVE)
    .map((r) => r.route)
    .sort((a, b) => a - b);
}

/** confirmLive must list exactly the newly-LIVE routes (order and duplicates are not accepted as different sets). */
export function confirmLiveMatches(expected: readonly number[], confirmLive: unknown): boolean {
  if (!Array.isArray(confirmLive) || !confirmLive.every((n) => typeof n === 'number' && Number.isInteger(n))) return false;
  const given = [...new Set(confirmLive as number[])].sort((a, b) => a - b);
  return given.length === confirmLive.length && given.length === expected.length && given.every((n, i) => n === expected[i]);
}

/** Field-by-field differences, for the audit row and for "unsaved changes" in the webpage. */
export function packingSlipRouteChanges(saved: readonly PackingSlipRoute[], next: readonly PackingSlipRoute[]):
  Array<{ route: number; field: Exclude<PackingSlipRouteField, 'route'>; before: string | boolean; after: string | boolean }> {
  const fields = ['name', 'sourceQueue', 'outputPrinter', 'mode', 'uploadEnabled'] as const;
  const before = new Map(saved.map((r) => [r.route, r]));
  const out: Array<{ route: number; field: Exclude<PackingSlipRouteField, 'route'>; before: string | boolean; after: string | boolean }> = [];
  for (const r of next) {
    const old = before.get(r.route);
    if (!old) continue;
    for (const field of fields) if (old[field] !== r[field]) out.push({ route: r.route, field, before: old[field], after: r[field] });
  }
  return out;
}

/** True when an If-None-Match header names this version ("7", W/"7", a list, or *). */
export function packingSlipEtagMatches(ifNoneMatch: string | undefined | null, version: number): boolean {
  if (typeof ifNoneMatch !== 'string' || !ifNoneMatch.trim()) return false;
  return ifNoneMatch.split(',').map((t) => t.trim()).some((t) => t === '*' || t.replace(/^W\//, '') === `"${version}"`);
}
