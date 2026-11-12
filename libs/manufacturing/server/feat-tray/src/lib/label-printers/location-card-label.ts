import {
  CARD_IPL_FINISH,
  CARD_IPL_SETUP,
  CARD_LENGTH_DOTS,
  CARD_WIDTH_DOTS,
  CardAdjustment,
  ETX,
  STX,
  safeIplField,
  safeZplField,
} from './card-format';

/*
 * The location label on 4 x 6.5 in card stock, printed landscape: 6.1 in across (along the
 * card's length) and 4 in tall (across the web), read with the card turned sideways. Summary on
 * top, part type and location number side by side under it, the location barcode (Code 128 of
 * its serial, the same value its small tag carries) across the bottom with the serial,
 * description and department under it.
 *
 * The layout is in landscape dots (203 per inch): X along the card, 0..LABEL_LENGTH; Y down the
 * label, 0..LABEL_HEIGHT. It is drawn inside the area the Cutter Build card prints on (card
 * length 5..1240 and across the web 10..822), so it suits the same stock and printer setup.
 *
 * IPL (Intermec): a direction-0 field reads along the feed, its first origin value along the
 * feed and the second across the web, origin at the field's top-left corner, so landscape
 * (X, Y) is IPL origin (25 + X, 52 + Y). ZPL (Zebra): fields are rotated R (90 degrees), whose
 * ^FO is the top-left corner of the field's box on the unrotated card, so (X, Y) with an
 * extent of h dots across the web is ^FO (822 - Y - h, 5 + X).
 */

export const LOCATION_LABEL_LENGTH = 1235;
export const LOCATION_LABEL_HEIGHT = 812;

export interface LocationCardFields {
  /** The location serial: the barcode value. */
  serial: string;
  /** The location number, printed large. Falls back to the serial. */
  number?: string | null;
  summary?: string | null;
  partType?: string | null;
  description?: string | null;
  department?: string | null;
}

export type LabelElement =
  | { kind: 'bar'; x: number; y: number; width: number; height: number }
  | { kind: 'text'; x: number; y: number; height: number; value: string }
  | { kind: 'barcode'; x: number; y: number; height: number; moduleDots: number; value: string };

interface Language {
  clean(value: string | null | undefined, maxLength: number): string;
  /** About how wide an average capital is, as a share of the text height. */
  characterWidth: number;
}

const IPL: Language = { clean: (value, max) => safeIplField(value, max), characterWidth: 0.75 };
/** ZPL font 0 is about 0.6 of its height per average capital. */
const ZPL: Language = { clean: safeZplField, characterWidth: 0.6 };

const MARGIN = 30;
const CONTENT = LOCATION_LABEL_LENGTH - 2 * MARGIN;
const MIN_TEXT = 22;
const NOT_SET = 'NOT SET';

/** Wide and narrow characters, so a run of M and W is not estimated as narrow as average. */
function widthUnits(value: string): number {
  let units = 0;
  for (const c of value) {
    if ('MW@%'.includes(c)) units += 1.3;
    else if ('I1.,:;!|'.includes(c)) units += 0.5;
    else if (c === ' ') units += 0.6;
    else if (c === '-' || c === '/') units += 0.7;
    else units += 1;
  }
  return Math.max(units, 1);
}

export function textWidth(language: Language, value: string, height: number): number {
  return Math.ceil(widthUnits(value) * height * language.characterWidth);
}

/** The largest height up to `preferred` that keeps `value` within `available`; cut short only below MIN_TEXT. */
function fitted(language: Language, x: number, y: number, value: string, available: number, preferred: number) {
  const perHeight = widthUnits(value) * language.characterWidth;
  let height = Math.max(MIN_TEXT, Math.min(preferred, Math.floor(available / perHeight)));
  let shown = value;
  while (shown.length > 1 && textWidth(language, shown, height) > available) shown = `${shown.slice(0, -4)}...`;
  if (shown !== value) height = MIN_TEXT;
  return { kind: 'text' as const, x, y, height, value: shown };
}

function centred(language: Language, y: number, value: string, preferred: number) {
  const text = fitted(language, MARGIN, y, value, CONTENT, preferred);
  return { ...text, x: MARGIN + Math.max(0, Math.round((CONTENT - textWidth(language, text.value, text.height)) / 2)) };
}

export function locationCardLayout(fields: LocationCardFields, language: Language): LabelElement[] {
  const clean = language.clean;
  const serial = clean(fields.serial, 64).toUpperCase();
  const number = clean(fields.number, 32).toUpperCase() || serial;
  const summary = clean(fields.summary, 40).toUpperCase() || NOT_SET;
  const partType = clean(fields.partType, 32).toUpperCase() || NOT_SET;
  const footer = [clean(fields.description, 60), clean(fields.department, 30)].filter(Boolean).join(' - ');

  // Part type and location number share the row in proportion to their length.
  const share = Math.min(0.65, Math.max(0.35, Math.max(partType.length, 4) / (Math.max(partType.length, 4) + Math.max(number.length, 3))));
  const partWidth = Math.round(CONTENT * share) - 16;
  const divider = MARGIN + partWidth + 8;
  const numberX = divider + 24;
  const numberWidth = MARGIN + CONTENT - numberX;

  // Code 128 B: 11 modules a character plus start, check and stop, with 10 quiet modules each side.
  const modules = 11 * (serial.length + 2) + 13;
  const moduleDots = Math.max(1, Math.min(4, Math.floor(CONTENT / (modules + 20))));

  return [
    { kind: 'text', x: MARGIN, y: 22, height: 26, value: 'SUMMARY' },
    // A long Summary shrinks to fit; it stays centred in its band.
    ((text) => ({ ...text, y: 58 + Math.floor((220 - text.height) / 2) }))(fitted(language, MARGIN, 58, summary, CONTENT, 220)),
    { kind: 'bar', x: MARGIN, y: 296, width: CONTENT, height: 4 },
    { kind: 'text', x: MARGIN, y: 314, height: 26, value: 'PART TYPE' },
    fitted(language, MARGIN, 350, partType, partWidth, 180),
    { kind: 'bar', x: divider, y: 312, width: 4, height: 236 },
    { kind: 'text', x: numberX, y: 314, height: 26, value: 'LOCATION #' },
    fitted(language, numberX, 350, number, numberWidth, 180),
    { kind: 'bar', x: MARGIN, y: 556, width: CONTENT, height: 4 },
    {
      kind: 'barcode',
      x: MARGIN + Math.max(0, Math.round((CONTENT - modules * moduleDots) / 2)),
      y: 576,
      height: 120,
      moduleDots,
      value: serial,
    },
    centred(language, 708, serial, 40),
    ...(footer ? [centred(language, 760, footer, 26)] : []),
  ];
}

// ---------- IPL (Intermec) ----------

const FEED0 = 25;
const ACROSS0 = 52;

function iplElement(element: LabelElement, index: number): string {
  const origin = `o${FEED0 + element.x},${ACROSS0 + element.y}`;
  switch (element.kind) {
    case 'bar':
      // Lines run `l` dots along the feed and are `w` dots wide across the web.
      return `${STX}L${index};${origin};f0;l${element.width};w${element.height};${ETX}`;
    case 'text': {
      const units = Math.max(1, Math.round(element.height * 0.75));
      return `${STX}H${index},Text${index};${origin};f0;h${units};w${units};c26;r0;b0;d3,${element.value};${ETX}`;
    }
    case 'barcode':
      return `${STX}B${index},LocBar;${origin};f0;h${element.height};w${element.moduleDots};c6;i0;d3,${element.value};${ETX}`;
  }
}

/** Moves every field on one printer's stock, the same way as the Cutter Build card. */
export function moveCardIpl(card: Buffer, adjustment: CardAdjustment): Buffer {
  if (!adjustment.right && !adjustment.down) return card;
  return Buffer.from(
    card.toString('latin1').replace(/;o(\d+),(\d+);/g, (_origin, feed: string, across: string) =>
      `;o${Math.max(0, Number(feed) - adjustment.down)},${Math.max(0, Number(across) + adjustment.right)};`,
    ),
    'latin1',
  );
}

export function buildLocationCardIpl(fields: LocationCardFields, adjustment: CardAdjustment = { right: 0, down: 0 }): Buffer {
  const commands = [...CARD_IPL_SETUP, ...locationCardLayout(fields, IPL).map(iplElement), ...CARD_IPL_FINISH];
  return moveCardIpl(Buffer.from(commands.join('\r\n') + '\r\n\r\n', 'latin1'), adjustment);
}

// ---------- ZPL (Zebra) ----------

const ACROSS_EDGE = 822;
const ALONG0 = 5;

function zplOrigin(x: number, y: number, extentAcross: number, adjustment: CardAdjustment): string {
  return `^FO${Math.max(0, ACROSS_EDGE - y - extentAcross + adjustment.right)},${Math.max(0, ALONG0 + x + adjustment.down)}`;
}

function zplElement(element: LabelElement, adjustment: CardAdjustment): string {
  switch (element.kind) {
    case 'bar':
      return `${zplOrigin(element.x, element.y, element.height, adjustment)}^GB${element.height},${element.width},${Math.min(element.width, element.height)}^FS`;
    case 'text':
      return `${zplOrigin(element.x, element.y, element.height, adjustment)}^A0R,${element.height},${element.height}^FD${element.value}^FS`;
    case 'barcode':
      return `^BY${element.moduleDots},3,${element.height}\r\n${zplOrigin(element.x, element.y, element.height, adjustment)}^BCR,${element.height},N,N,N,N^FD${element.value}^FS`;
  }
}

export function buildLocationCardZpl(fields: LocationCardFields, adjustment: CardAdjustment = { right: 0, down: 0 }): Buffer {
  const commands = [
    '^XA',
    '^CI28',
    `^PW${CARD_WIDTH_DOTS}`,
    `^LL${CARD_LENGTH_DOTS}`,
    '^LH0,0',
    ...locationCardLayout(fields, ZPL).map((element) => zplElement(element, adjustment)),
    '^PQ1',
    '^XZ',
  ];
  return Buffer.from(commands.join('\r\n') + '\r\n', 'utf8');
}

/** The file name for a location label that could not be printed. */
export function locationCardFileName(serial: string, language: 'IPL' | 'ZPL'): string {
  const safe = String(serial).trim().toUpperCase().replace(/[^A-Z0-9._-]+/g, '_') || 'LOCATION';
  return `LOCATION-${safe}.${language === 'ZPL' ? 'zpl' : 'prn'}`;
}
