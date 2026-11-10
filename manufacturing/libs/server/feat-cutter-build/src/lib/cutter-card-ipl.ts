/**
 * Exact CutterLabel_FILLED.prn template supplied for Gear Apps Cutter Build labels.
 * The native IPL bytes are embedded as Base64 so production builds do not depend on
 * the workstation file system. The PNG preview is intentionally generated separately
 * in the browser; this PRN remains the printer-authoritative artifact.
 */
const CUTTER_CARD_IPL_TEMPLATE_BASE64 = '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';

export interface CutterCardIplFields {
  buildId: string;
  buildDate: string;
  name: string;
  bodyNumber: string;
  machine: string;
  coated: boolean;
  honed: boolean;
}

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

export function buildCutterCardIpl(fields: CutterCardIplFields): Buffer {
  let source = Buffer.from(CUTTER_CARD_IPL_TEMPLATE_BASE64, 'base64').toString('latin1');
  const replacements: Array<[string, string]> = [
    ['$BuildID', safeIplField(fields.buildId, 72)],
    ['$Date', safeIplField(fields.buildDate, 30)],
    ['$Name', safeIplField(fields.name, 48)],
    ['$BodyNumber', safeIplField(fields.bodyNumber, 48)],
    ['$Machine', safeIplField(fields.machine, 32)],
    ['$XCoated', fields.coated ? 'X' : ''],
    ['$XHoned', fields.honed ? 'X' : ''],
  ];

  for (const [token, value] of replacements) source = source.split(token).join(value);

  const leftovers = source.match(/\$(?:BuildID|Date|Name|BodyNumber|Machine|XCoated|XHoned)/g);
  if (leftovers?.length) {
    throw new Error(`Cutter card IPL still contains unresolved template fields: ${leftovers.join(', ')}`);
  }
  return Buffer.from(source, 'latin1');
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
