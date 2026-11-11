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



export interface CuttergrindRoughShelfTag {
  serialNumber: string;
  shelfNumber: string;
  department: typeof DEPARTMENT_CUTTERGRIND;
  locationType: typeof LOCATION_TYPE_SHELF;
  kind: 'CUTTERGRIND_ROUGH';
  partTypeCode: SummaryShelfPartType;
}

/** Numbered physical rough shelves. Legacy CGRR/CGRP are not new placement targets. */
export function parseCuttergrindRoughShelfTag(
  value: string,
): CuttergrindRoughShelfTag | null {
  const serialNumber = value.trim().toUpperCase();
  const match = /^(CGRR|CGRP)-(\d{3})$/.exec(serialNumber);
  if (!match) return null;
  return {
    serialNumber,
    shelfNumber: match[2],
    department: DEPARTMENT_CUTTERGRIND,
    locationType: LOCATION_TYPE_SHELF,
    kind: 'CUTTERGRIND_ROUGH',
    partTypeCode: match[1] === 'CGRR' ? 'RING' : 'PINION',
  };
}

/** Returns only the expected prefix; the operator supplies the actual numbered shelf. */
export function cuttergrindRoughShelfForPartType(
  partTypeCode: string | null | undefined,
): 'CGRR' | 'CGRP' | null {
  const partType = normalizeSummaryShelfPartType(partTypeCode);
  return partType === 'RING' ? 'CGRR' : partType === 'PINION' ? 'CGRP' : null;
}

/** Where a dull or finished shelf tag sits: shelf A, layer 1, bin A for CGDR-A1A / CGFR-A1A. */
export interface CuttergrindShelfPosition {
  shelf: string;
  layer: number;
  bin: string;
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
  kind: CuttergrindNumberedShelfTag['kind'],
  partTypeCode: string | null | undefined,
  shelf: string,
  layer: number,
  bin: string,
): string | null {
  const partType = normalizeSummaryShelfPartType(partTypeCode);
  if (!partType) return null;
  const prefix = `CG${kind === 'CUTTERGRIND_DULL' ? 'D' : 'F'}${partType === 'RING' ? 'R' : 'P'}`;
  const serial = `${prefix}-${shelf.trim().toUpperCase()}${layer}${bin.trim().toUpperCase()}`;
  return CUTTERGRIND_BIN_SHELF_PATTERN.test(serial) ? serial : null;
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
