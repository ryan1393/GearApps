import type { DockAgingSettingsRecord, TruckVisitRecord } from '@truck-log/shared/contracts';

export const DEFAULT_DOCK_AGING_SETTINGS: DockAgingSettingsRecord = {
  warningMinutes: 15,
  criticalMinutes: 30,
};

export function dockAgeMinutes(visit: TruckVisitRecord, now = Date.now()): number | null {
  if (visit.status !== 'DOCK_ASSIGNED' || !visit.dockAssignedAt) return null;
  const assignedMs = new Date(visit.dockAssignedAt).getTime();
  if (!Number.isFinite(assignedMs)) return null;
  const elapsedMs = now - assignedMs;
  if (elapsedMs < 0) return 0;
  return Math.floor(elapsedMs / 60_000);
}

export function dockAgeClass(
  visit: TruckVisitRecord,
  settings: DockAgingSettingsRecord,
  now = Date.now(),
): string {
  const minutes = dockAgeMinutes(visit, now);
  if (minutes == null) return '';
  if (minutes >= settings.criticalMinutes) return 'dock-age-critical';
  if (minutes >= settings.warningMinutes) return 'dock-age-warning';
  return '';
}

/** Dana UI row/card tone for a visit's dock age: overdue is danger, aging is warning. */
export function dockAgeTone(
  visit: TruckVisitRecord,
  settings: DockAgingSettingsRecord,
  now = Date.now(),
): 'danger' | 'warning' | null {
  const age = dockAgeClass(visit, settings, now);
  return age === 'dock-age-critical' ? 'danger' : age === 'dock-age-warning' ? 'warning' : null;
}
