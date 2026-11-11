import {
  DEPARTMENT_GREENSHED,
  isCoaterStagingLocation,
  LOCATION_TYPE_SHELF,
  locationPartTypeFromSerial,
  parseCuttergrindNumberedShelfTag,
  parseCuttergrindRoughShelfTag,
} from '@meshforge/manufacturing/shared/util-constants';

/** What auto-selection reads from a location row (the inventory lists include its Summary and part type). */
export interface AutoShelfLocation {
  id: string;
  serial_number: string;
  enabled?: boolean;
  department?: string | null;
  location_type?: string | null;
  summary?: { number?: string | null } | null;
  part_type?: { code?: string | null } | null;
}

/** What auto-selection reads from a tray. */
export interface AutoShelfTray {
  summary?: { number?: string | null } | null;
  part_type?: { code?: string | null } | null;
  current_stage?: { code?: string | null } | null;
}

export interface AutoShelfResult<T> {
  /** The shelf to select: the only eligible one holding the tray's Summary and part type. */
  shelf: T | null;
  /** Every eligible shelf holding the tray's Summary and part type. Two or more: the operator chooses. */
  matches: T[];
}

const normalize = (value: string | null | undefined): string => (value ?? '').trim().toUpperCase();

/** The part type a location holds: the R or P in its barcode, else the one saved on it. */
export function locationPartTypeCode(location: AutoShelfLocation): string {
  return locationPartTypeFromSerial(location.serial_number) ?? normalize(location.part_type?.code);
}

/** The location is a shelf that holds this Summary and part type. */
export function shelfHolds(location: AutoShelfLocation, summaryNumber: string | null | undefined, partTypeCode: string | null | undefined): boolean {
  const summary = normalize(summaryNumber);
  const partType = normalize(partTypeCode);
  return Boolean(summary && partType) &&
    location.enabled !== false &&
    normalize(location.location_type) === LOCATION_TYPE_SHELF &&
    normalize(location.summary?.number) === summary &&
    locationPartTypeCode(location) === partType;
}

/**
 * Picks the shelf a tray goes to: when exactly one of `shelves` holds the tray's Summary and part
 * type, that one. With none, or two or more, nothing is picked and the operator scans or chooses.
 * `shelves` are the ones the tray may go to on this screen (already filtered for its stage).
 */
export function autoShelfFor<T extends AutoShelfLocation>(
  shelves: readonly T[],
  summaryNumber: string | null | undefined,
  partTypeCode: string | null | undefined,
): AutoShelfResult<T> {
  const matches = shelves.filter((shelf) => shelfHolds(shelf, summaryNumber, partTypeCode));
  return { shelf: matches.length === 1 ? matches[0] : null, matches };
}

/**
 * Whether Move Tray may put a tray in this stage at this location, mirroring the server's rules
 * (`ServerFeatLocationTrayService.createLocationTray`): rough bins take trays ready for coating, dull
 * bins trays waiting for grinding, finished bins trays ready for a cutter, and Green Shed shelves none.
 */
export function trayMayMoveTo(location: AutoShelfLocation, tray: AutoShelfTray): boolean {
  if (location.enabled === false) return false;
  const serial = normalize(location.serial_number);
  const stage = normalize(tray.current_stage?.code);
  if (normalize(location.department) === DEPARTMENT_GREENSHED && normalize(location.location_type) === LOCATION_TYPE_SHELF) return false;
  const partType = locationPartTypeFromSerial(serial);
  if (partType && partType !== normalize(tray.part_type?.code)) return false;
  if (parseCuttergrindRoughShelfTag(serial)) return stage === 'READY_FOR_COATING';
  if (/^(CGRR|CGRP)/.test(serial)) return false; // legacy rough records are not placement targets
  const numbered = parseCuttergrindNumberedShelfTag(serial);
  if (numbered) return stage === (numbered.kind === 'CUTTERGRIND_DULL' ? 'WAITING_FOR_GRINDING' : 'READY_FOR_CUTTER');
  if (/^CG[DF][RP]-/.test(serial)) return false;
  if (isCoaterStagingLocation(serial)) return stage === 'READY_FOR_COATING';
  return true;
}
