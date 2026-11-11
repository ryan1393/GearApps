import { DEPARTMENT_CUTTERGRIND } from './department.constants';

export const DEPARTMENT_GREENSHED = 'GREENSHED' as const;
export const LOCATION_TYPE_SHELF = 'SHELF' as const;

export type SummaryShelfKind =
  | 'GREENSHED'
  | 'CUTTERGRIND_DULL'
  | 'CUTTERGRIND_FINISHED';

export type SummaryShelfPartType = 'RING' | 'PINION';

export interface SummaryShelfTag {
  serialNumber: string;
  summaryNumber: string;
  department: typeof DEPARTMENT_GREENSHED | typeof DEPARTMENT_CUTTERGRIND;
  locationType: typeof LOCATION_TYPE_SHELF;
  kind: SummaryShelfKind;
  partTypeCode: SummaryShelfPartType;
}

export function normalizeSummaryNumber(summaryNumber: string): string {
  return summaryNumber.trim().toUpperCase();
}

export function normalizeSummaryShelfPartType(
  partTypeCode: string | null | undefined,
): SummaryShelfPartType | null {
  const code = partTypeCode?.trim().toUpperCase();
  return code === 'RING' || code === 'PINION' ? code : null;
}

/**
 * Shelf barcodes carry their part type in the letter before the dash: R is RING, P is PINION.
 * GSR-/GSP- (Green Shed), CGRR/CGRP (rough), CGDR/CGDP (dull) and CGFR/CGFP (finished), including
 * legacy rough tags such as CGRR or CGRR-001.
 */
export const LOCATION_PART_TYPE_PATTERN = /^(?:GS|CG[RDF])([RP])(?:-|$)/;

/**
 * The part type a location holds, read from its barcode: CGDR-A1A is RING, GSP-1.955FC is PINION.
 * Null for a barcode that does not name one (the part type is then chosen by hand).
 */
export function locationPartTypeFromSerial(serialNumber: string | null | undefined): SummaryShelfPartType | null {
  const match = LOCATION_PART_TYPE_PATTERN.exec((serialNumber ?? '').trim().toUpperCase());
  return match ? (match[1] === 'R' ? 'RING' : 'PINION') : null;
}

export function isShelfSummaryNumber(summaryNumber: string): boolean {
  const summary = normalizeSummaryNumber(summaryNumber);
  return /^(?=.*\d)[A-Z0-9.-]+$/.test(summary);
}

export function buildSummaryShelfTag(
  kind: SummaryShelfKind,
  summaryNumber: string,
  partTypeCode?: string | null,
): string {
  const summary = normalizeSummaryNumber(summaryNumber);
  if (!isShelfSummaryNumber(summary)) {
    throw new Error(
      `Summary '${summaryNumber}' cannot be used in a shelf location tag`,
    );
  }

  const partType = normalizeSummaryShelfPartType(partTypeCode);
  if (!partType) {
    throw new Error(
      `${kind === 'GREENSHED' ? 'Green Shed' : 'Cuttergrind'} shelf tags require a RING or PINION part type`,
    );
  }

  switch (kind) {
    case 'GREENSHED':
      return `${partType === 'RING' ? 'GSR' : 'GSP'}-${summary}`;
    case 'CUTTERGRIND_DULL':
      return `${partType === 'RING' ? 'CGDR' : 'CGDP'}-${summary}`;
    case 'CUTTERGRIND_FINISHED':
      return `${partType === 'RING' ? 'CGFR' : 'CGFP'}-${summary}`;
  }
}



/** Where a Cuttergrind shelf tag sits: shelf A, layer 1, bin A for CGRR-A1A / CGDR-A1A / CGFR-A1A. */
export interface CuttergrindShelfPosition {
  shelf: string;
  layer: number;
  bin: string;
}

export interface CuttergrindRoughShelfTag {
  serialNumber: string;
  /** What follows the prefix: shelf letter, layer number, bin letter, such as A1A. */
  shelfNumber: string;
  department: typeof DEPARTMENT_CUTTERGRIND;
  locationType: typeof LOCATION_TYPE_SHELF;
  kind: 'CUTTERGRIND_ROUGH';
  partTypeCode: SummaryShelfPartType;
  position: CuttergrindShelfPosition;
}

/** Rough shelves are addressed by shelf letter, layer number and bin letter: CGRR-A1A. */
export const CUTTERGRIND_ROUGH_SHELF_PATTERN = /^(CGRR|CGRP)-([A-Z])([1-9])([A-Z])$/;

/** Physical rough shelf bins. Legacy CGRR/CGRP and CGRR-### are not new placement targets. */
export function parseCuttergrindRoughShelfTag(
  value: string,
): CuttergrindRoughShelfTag | null {
  const serialNumber = value.trim().toUpperCase();
  const match = CUTTERGRIND_ROUGH_SHELF_PATTERN.exec(serialNumber);
  if (!match) return null;
  const [, prefix, shelf, layer, bin] = match;
  return {
    serialNumber,
    shelfNumber: `${shelf}${layer}${bin}`,
    department: DEPARTMENT_CUTTERGRIND,
    locationType: LOCATION_TYPE_SHELF,
    kind: 'CUTTERGRIND_ROUGH',
    partTypeCode: prefix === 'CGRR' ? 'RING' : 'PINION',
    position: { shelf, layer: Number(layer), bin },
  };
}

/** Returns only the expected prefix; the operator supplies the actual shelf bin. */
export function cuttergrindRoughShelfForPartType(
  partTypeCode: string | null | undefined,
): 'CGRR' | 'CGRP' | null {
  const partType = normalizeSummaryShelfPartType(partTypeCode);
  return partType === 'RING' ? 'CGRR' : partType === 'PINION' ? 'CGRP' : null;
}

export interface CuttergrindNumberedShelfTag {
  serialNumber: string;
  /** What follows the prefix: shelf letter, layer number, bin letter, such as A1A. */
  shelfNumber: string;
  department: typeof DEPARTMENT_CUTTERGRIND;
  locationType: typeof LOCATION_TYPE_SHELF;
  kind: 'CUTTERGRIND_DULL' | 'CUTTERGRIND_FINISHED';
  partTypeCode: SummaryShelfPartType;
  position: CuttergrindShelfPosition;
}

/**
 * Dull (CGDR/CGDP) and finished (CGFR/CGFP) shelves are addressed by shelf letter, layer
 * number and bin letter: CGDR-A1A is RING dull, shelf A, layer 1, bin A.
 */
export const CUTTERGRIND_BIN_SHELF_PATTERN = /^(CGDR|CGDP|CGFR|CGFP)-([A-Z])([1-9])([A-Z])$/;

export function buildCuttergrindShelfTag(
  kind: CuttergrindNumberedShelfTag['kind'] | CuttergrindRoughShelfTag['kind'],
  partTypeCode: string | null | undefined,
  shelf: string,
  layer: number,
  bin: string,
): string | null {
  const partType = normalizeSummaryShelfPartType(partTypeCode);
  if (!partType) return null;
  const stage = kind === 'CUTTERGRIND_ROUGH' ? 'R' : kind === 'CUTTERGRIND_DULL' ? 'D' : 'F';
  const serial = `CG${stage}${partType === 'RING' ? 'R' : 'P'}-${shelf.trim().toUpperCase()}${layer}${bin.trim().toUpperCase()}`;
  const pattern = kind === 'CUTTERGRIND_ROUGH' ? CUTTERGRIND_ROUGH_SHELF_PATTERN : CUTTERGRIND_BIN_SHELF_PATTERN;
  return pattern.test(serial) ? serial : null;
}

/** Barcode prefixes of Cuttergrind shelf bins that can be made in bulk. */
export const CUTTERGRIND_SHELF_PREFIXES = ['CGDR', 'CGDP', 'CGFR', 'CGFP', 'CGRR', 'CGRP'] as const;
export type CuttergrindShelfPrefix = (typeof CUTTERGRIND_SHELF_PREFIXES)[number];
export const CUTTERGRIND_SHELF_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const CUTTERGRIND_SHELF_MAX_LAYER = 9;
export const CUTTERGRIND_SHELF_MAX_BINS = CUTTERGRIND_SHELF_LETTERS.length;

/** What a prefix holds: CGDR is "Dull, ring". */
export function describeCuttergrindShelfPrefix(prefix: CuttergrindShelfPrefix): string {
  const stage = prefix[2] === 'D' ? 'Dull' : prefix[2] === 'F' ? 'Finished' : 'Rough';
  return `${stage}, ${prefix[3] === 'R' ? 'ring' : 'pinion'}`;
}

/**
 * Every bin barcode for one shelf: each chosen layer gets bins A onward.
 * CGDR, shelf A, layers [1, 2], 3 bins makes CGDR-A1A, CGDR-A1B, CGDR-A1C, CGDR-A2A, CGDR-A2B, CGDR-A2C.
 * Returns an empty list when the shelf, a layer or the bin count is out of range.
 */
export function cuttergrindShelfBinSerials(
  prefix: CuttergrindShelfPrefix,
  shelf: string,
  layers: readonly number[],
  bins: number,
): string[] {
  const letter = shelf.trim().toUpperCase();
  if (!CUTTERGRIND_SHELF_PREFIXES.includes(prefix) || letter.length !== 1 || !CUTTERGRIND_SHELF_LETTERS.includes(letter)) return [];
  if (!Number.isInteger(bins) || bins < 1 || bins > CUTTERGRIND_SHELF_MAX_BINS) return [];
  const sorted = [...new Set(layers)].sort((a, b) => a - b);
  if (!sorted.length || sorted.some(layer => !Number.isInteger(layer) || layer < 1 || layer > CUTTERGRIND_SHELF_MAX_LAYER)) return [];
  return sorted.flatMap(layer =>
    Array.from({ length: bins }, (_, bin) => `${prefix}-${letter}${layer}${CUTTERGRIND_SHELF_LETTERS[bin]}`));
}

export function describeCuttergrindShelfPosition(position: CuttergrindShelfPosition): string {
  return `Shelf ${position.shelf}, layer ${position.layer}, bin ${position.bin}`;
}

export function parseCuttergrindNumberedShelfTag(
  value: string,
): CuttergrindNumberedShelfTag | null {
  const serialNumber = value.trim().toUpperCase();
  const match = CUTTERGRIND_BIN_SHELF_PATTERN.exec(serialNumber);
  if (!match) return null;
  const [, prefix, shelf, layer, bin] = match;
  return {
    serialNumber,
    shelfNumber: `${shelf}${layer}${bin}`,
    department: DEPARTMENT_CUTTERGRIND,
    locationType: LOCATION_TYPE_SHELF,
    kind: prefix === 'CGDR' || prefix === 'CGDP' ? 'CUTTERGRIND_DULL' : 'CUTTERGRIND_FINISHED',
    partTypeCode: prefix === 'CGDR' || prefix === 'CGFR' ? 'RING' : 'PINION',
    position: { shelf, layer: Number(layer), bin },
  };
}

export function parseSummaryShelfTag(value: string): SummaryShelfTag | null {
  const serialNumber = value.trim().toUpperCase();
  if (!serialNumber) return null;

  const definitions: Array<{
    prefix: string;
    kind: SummaryShelfKind;
    department: SummaryShelfTag['department'];
    partTypeCode: SummaryShelfPartType;
  }> = [
    {
      prefix: 'GSR-',
      kind: 'GREENSHED',
      department: DEPARTMENT_GREENSHED,
      partTypeCode: 'RING',
    },
    {
      prefix: 'GSP-',
      kind: 'GREENSHED',
      department: DEPARTMENT_GREENSHED,
      partTypeCode: 'PINION',
    },
  ];

  for (const definition of definitions) {
    if (!serialNumber.startsWith(definition.prefix)) continue;
    const summaryNumber = serialNumber.slice(definition.prefix.length).trim();
    if (!isShelfSummaryNumber(summaryNumber)) return null;

    return {
      serialNumber,
      summaryNumber,
      department: definition.department,
      locationType: LOCATION_TYPE_SHELF,
      kind: definition.kind,
      partTypeCode: definition.partTypeCode,
    };
  }

  return null;
}

export function isExpectedSummaryShelfTag(
  serialNumber: string,
  kind: SummaryShelfKind,
  summaryNumber: string,
  partTypeCode?: string | null,
): boolean {
  return (
    serialNumber.trim().toUpperCase() ===
    buildSummaryShelfTag(kind, summaryNumber, partTypeCode)
  );
}

/**
 * Where ground blades wait for the coater by default: a container packed at grinding (or a full
 * tray left as is) is placed here unless the operator scans a rough shelf bin instead.
 * Created automatically; nobody has to scan it.
 */
export const COATER_STAGING_LOCATION_SERIAL = 'COATER-STAGING' as const;
export const LOCATION_TYPE_STAGING = 'STAGING' as const;

export function isCoaterStagingLocation(serialNumber: string | null | undefined): boolean {
  return (serialNumber ?? '').trim().toUpperCase() === COATER_STAGING_LOCATION_SERIAL;
}

/** The staging location as configured: its barcode and the Cuttergrind department. */
export function isCoaterStagingPlacement(serialNumber: string | null | undefined, department: string | null | undefined): boolean {
  return isCoaterStagingLocation(serialNumber) && department === DEPARTMENT_CUTTERGRIND;
}
