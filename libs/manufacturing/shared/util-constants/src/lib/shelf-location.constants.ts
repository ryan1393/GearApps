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
