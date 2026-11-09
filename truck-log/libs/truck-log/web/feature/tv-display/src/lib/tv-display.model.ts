import type { TvBoardSnapshot, TvDockRecord, TvVisitRecord } from '@truck-log/shared/contracts';
export type TvPhase = 'dock' | 'checkout' | 'review' | 'out';
export interface TvDockTile {
  key: string; dock: TvDockRecord; visit: TvVisitRecord | null;
  position: number; occupants: number; unlisted: boolean;
}
export interface TvBoardView {
  visits: TvVisitRecord[]; waiting: TvVisitRecord[]; tiles: TvDockTile[];
  totalDocks: number; activeDocks: number; occupiedDocks: number; openDocks: number;
  atDock: number; awaiting: number; review: number;
}
export function tvPhase(v: TvVisitRecord): TvPhase {
  if (v.status === 'GUARD_CHECKED_OUT' && v.guardCheckOutAt) return 'out';
  // Never silently remove inconsistent/unknown records from an on-site TV display.
  if (v.guardCheckOutAt || !v.guardCheckInAt) return 'review';
  if (v.status === 'DOCK_ASSIGNED' && !v.dockCompletedAt && v.dockAssignedAt) return 'dock';
  if (v.status === 'DOCK_COMPLETE' && v.dockCompletedAt) return 'checkout';
  return 'review';
}
export function tvElapsed(value: string | null, now: number): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return '—';
  const mins = Math.max(0, Math.floor((now - ms) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
}
export function tvUrgency(v: TvVisitRecord, snapshot: TvBoardSnapshot, now: number): '' | 'aging' | 'overdue' {
  if (tvPhase(v) !== 'dock' || !v.dockAssignedAt) return '';
  const minutes = Math.max(0, Math.floor((now - Date.parse(v.dockAssignedAt)) / 60000));
  return minutes >= snapshot.criticalMinutes ? 'overdue' : minutes >= snapshot.warningMinutes ? 'aging' : '';
}
export function tvPages<T>(items: T[], size: number): T[][] {
  const safe = Math.max(1, Math.floor(size) || 1), out: T[][] = [];
  for (let i = 0; i < items.length; i += safe) out.push(items.slice(i, i + safe));
  return out.length ? out : [[]];
}
export function tvBoard(snapshot: TvBoardSnapshot): TvBoardView {
  const phaseOrder = { checkout: 0, review: 1, dock: 2, out: 3 };
  const visits = snapshot.visits.filter(v => tvPhase(v) !== 'out').slice().sort((a, b) =>
    phaseOrder[tvPhase(a)] - phaseOrder[tvPhase(b)] ||
    (Date.parse(a.guardCheckInAt || '') || 0) - (Date.parse(b.guardCheckInAt || '') || 0) || a.id - b.id);
  const assigned = visits.filter(v => tvPhase(v) === 'dock');
  const waiting = visits.filter(v => tvPhase(v) !== 'dock');
  const docks = snapshot.docks.slice().sort((a, b) => a.sortOrder - b.sortOrder ||
    a.code.localeCompare(b.code, 'en', { numeric: true }) || a.id - b.id);
  const map = new Map(docks.map(d => [d.code, d]));
  const unlisted = new Set<string>();
  for (const visit of assigned) if (!map.has(visit.dockCode)) unlisted.add(visit.dockCode);
  // display real assignments only; empty dock-master rows never become TV tiles.
  // Keep the original dock code separate from its display label for blank/unlisted codes.
  const tiles: TvDockTile[] = [];
  const addAssignedDock = (dock: TvDockRecord, code: string): void => {
    const occupants = assigned.filter(v => v.dockCode === code);
    occupants.forEach((visit, i) => tiles.push({key: `dock-${dock.id}-${visit.id}`, dock, visit,
      position: i + 1, occupants: occupants.length, unlisted: dock.id === 0}));
  };
  docks.forEach(dock => addAssignedDock(dock, dock.code));
  for (const code of [...unlisted].sort()) addAssignedDock({ id: 0, code: code || 'Unassigned',
    description: 'Not in dock master', active: false, sortOrder: 0 }, code);
  const occupied = new Set(assigned.map(v => v.dockCode));
  return { visits, waiting, tiles, totalDocks: snapshot.docks.length,
    activeDocks: snapshot.docks.filter(d => d.active).length,
    occupiedDocks: snapshot.docks.filter(d => occupied.has(d.code)).length,
    openDocks: snapshot.docks.filter(d => d.active && !occupied.has(d.code)).length,
    atDock: assigned.length, awaiting: visits.filter(v => tvPhase(v) === 'checkout').length,
    review: visits.filter(v => tvPhase(v) === 'review').length };
}
export function readTvSnapshot(raw: unknown): TvBoardSnapshot {
  const fail = (): never => { throw new Error('Incomplete TV snapshot; keeping the last successful display.'); };
  if (!raw || typeof raw !== 'object') return fail();
  const s = raw as TvBoardSnapshot;
  if (s.schema !== 'truck-log-tv-v1' || typeof s.siteName !== 'string' ||
      !Number.isFinite(Date.parse(s.generatedAt)) || !Array.isArray(s.docks) || !Array.isArray(s.visits) ||
      !Number.isSafeInteger(s.warningMinutes) || s.warningMinutes <= 0 ||
      !Number.isSafeInteger(s.criticalMinutes) || s.criticalMinutes <= s.warningMinutes) return fail();
  const validId = (id: number): boolean => Number.isSafeInteger(id) && id > 0;
  for (const d of s.docks) if (!d || !validId(d.id) || typeof d.code !== 'string' || !d.code.trim() ||
    typeof d.description !== 'string' || typeof d.active !== 'boolean' || !Number.isFinite(d.sortOrder)) return fail();
  for (const v of s.visits) {
    if (!v || !validId(v.id) || typeof v.packingSlipAttached !== 'boolean' ||
      ['visitReference', 'loadNumber', 'carrierName', 'trailerId', 'direction', 'dockCode', 'status']
        .some(k => typeof (v as unknown as Record<string, unknown>)[k] !== 'string')) return fail();
    for (const d of [v.guardCheckInAt, v.dockAssignedAt, v.dockCompletedAt, v.guardCheckOutAt])
      if (d !== null && (typeof d !== 'string' || !Number.isFinite(Date.parse(d)))) return fail();
  }
  if (new Set(s.docks.map(d => d.id)).size !== s.docks.length ||
      new Set(s.docks.map(d => d.code)).size !== s.docks.length ||
      new Set(s.visits.map(v => v.id)).size !== s.visits.length) return fail();
  return s;
}
