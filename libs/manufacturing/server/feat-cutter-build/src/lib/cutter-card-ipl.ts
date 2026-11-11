import { CardElement, CardLanguage, CutterCardFields, cutterCardLayout } from './cutter-card-layout';

/*
 * The Cutter Build card in Intermec IPL. The layout is shared with the ZPL card (see
 * cutter-card-layout.ts); this file turns it into IPL fields.
 *
 * The card's fields read across the web (direction 3), so a field's first origin value runs
 * along the feed with the top of the card at feed 1265, and its second runs across the web
 * 42 dots in from the layout's left edge. A point (x, y) on the layout is IPL origin
 * (1265 - y, x + 42). Lines and boxes (direction 0) take their origin at their lowest feed
 * value and extend up the feed by `l`, so they start at 1265 - (y + height).
 *
 * The printer setup before and after the fields is unchanged from the supplied
 * CutterLabel_FILLED.prn (docs/manufacturing), which is known to print on the card stock.
 */
const CARD_TOP_FEED = 1265;
const ACROSS_OFFSET = 42;

/** @deprecated Use CutterCardFields. */
export type CutterCardIplFields = CutterCardFields;

function safeIplField(value: string | null | undefined, maxLength = 80): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Printer fields must not contain command control bytes.
    .replace(/[\x00-\x1f\x7f;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * The card is read on the shop floor, so the build date is printed in plant time. The API host
 * usually runs in UTC, which would put an evening build on the next day's date.
 */
export const CUTTER_CARD_TIME_ZONE = 'America/Indiana/Indianapolis';

const cardDateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: CUTTER_CARD_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return safeIplField(String(value), 30);
  const part = Object.fromEntries(cardDateParts.formatToParts(date).map(({ type, value: text }) => [type, text]));
  return `${part['year']}-${part['month']}-${part['day']} ${part['hour']}:${part['minute']}`;
}

const STX = '\x02';
const ETX = '\x03';
const ESC = '\x1b';
const SI = '\x0f';

const SETUP = [`${STX}R${ETX}`, `${STX}${ESC}k${ETX}`, `${STX}${ESC}C0${ETX}`, `${STX}${ESC}P;${ETX}`, `${STX}E*;F*;${ETX}`];
const FINISH = [
  `${STX}R${ETX}`,
  `${STX}R${ETX}`,
  `${STX}${ESC}k${ETX}`,
  `${STX}${ESC}C0`,
  `${SI}L1320`,
  `${SI}g0,424`,
  `${SI}T1`,
  `${SI}R0${SI}r0`,
  `${SI}D0`,
  `${SI}c0${SI}t0`,
  `${SI}l0`,
  `${SI}F2`,
  `${SI}f0`,
  `${SI}L1000`,
  `${SI}I5`,
  `${SI}i0`,
  `${SI}W914;${SI}S60`,
  `${SI}d0`,
  ETX,
  `${STX}${ESC}E*\x18${ETX}`,
  `${STX}\x1e1${ETX}${STX}\x1f1${ETX}${STX}\x17${ETX}`,
];

/*
 * Text is the scalable font 26, the one the asset tag uses. Its h and w are about three
 * quarters of the printed height in dots (h21 prints about 28 dots tall), and each character
 * takes about w dots across.
 */
const IPL_UNITS_PER_DOT = 0.75;
const IPL: CardLanguage = { clean: (value, maxLength) => safeIplField(value, maxLength), characterWidth: IPL_UNITS_PER_DOT };

function iplElement(element: CardElement, index: number): string {
  const across = element.x + ACROSS_OFFSET;
  switch (element.kind) {
    case 'box':
      return `${STX}W${index};o${CARD_TOP_FEED - element.y - element.height},${across};f0;l${element.height};h${element.width};w${element.line};${ETX}`;
    case 'bar':
      return `${STX}L${index};o${CARD_TOP_FEED - element.y - element.height},${across};f0;l${element.height};w${element.width};${ETX}`;
    case 'text': {
      const units = Math.max(1, Math.round(element.height * IPL_UNITS_PER_DOT));
      return `${STX}H${index},Text${index};o${CARD_TOP_FEED - element.y},${across};f3;h${units};w${units};c26;r0;b0;d3,${element.value};${ETX}`;
    }
    case 'barcode':
      return `${STX}B${index},BuildBar;o${CARD_TOP_FEED - element.y},${across};f3;h${element.height};w${element.moduleDots};c6;i0;d3,${element.value};${ETX}`;
  }
}

export function buildCutterCardIpl(fields: CutterCardFields): Buffer {
  const commands = [...SETUP, ...cutterCardLayout(fields, IPL).map(iplElement), ...FINISH];
  return Buffer.from(commands.join('\r\n') + '\r\n\r\n', 'latin1');
}

/** How far to move the whole card on one printer's stock, in dots (203 per inch). */
export interface CutterCardAdjustment {
  right: number;
  down: number;
}

/**
 * Moves every field of an IPL card. The card's fields read across the web with their top at
 * the larger feed value, so "right" adds to the second origin value and "down" takes from the
 * first. Field data cannot contain `;` (see safeIplField), so each `;o` is a real origin.
 */
export function moveCutterCardIpl(card: Buffer, adjustment: CutterCardAdjustment): Buffer {
  if (!adjustment.right && !adjustment.down) return card;
  return Buffer.from(
    card.toString('latin1').replace(/;o(\d+),(\d+);/g, (_origin, feed: string, across: string) =>
      `;o${Math.max(0, Number(feed) - adjustment.down)},${Math.max(0, Number(across) + adjustment.right)};`,
    ),
    'latin1',
  );
}

export function cutterCardBuildDate(value: string | Date): string {
  return formatDate(value);
}
