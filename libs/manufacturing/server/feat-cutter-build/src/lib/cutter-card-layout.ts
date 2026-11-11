/*
 * The Cutter Build card, laid out once for both printer languages. It is the same card as the
 * PNG preview the browser saves: MESHFORGE / CUTTER BUILD CARD, the build ID as a Code 128
 * barcode with the number under it, two columns of labelled values, then the build time and
 * comments.
 *
 * Positions are in dots (203 per inch) from the top left of the card: x across the web, y down
 * the card. 832 dots across (4.1 in printable) and 1320 dots long (6.5 in). Everything sits
 * between y 5 and 1240, the part of the card the earlier template printed on.
 */
export const CARD_WIDTH_DOTS = 832;
export const CARD_LENGTH_DOTS = 1320;

export interface CutterCardFields {
  buildId: string;
  /** Plant time, already formatted (see cutterCardBuildDate). */
  buildDate: string;
  name: string;
  bodyNumber: string;
  machine: string;
  coated: boolean;
  honed: boolean;
  summary: string;
  partType: string;
  bladeCount: number | string;
  sourceTray: string;
  status: string;
  comments?: string | null;
}

export type CardElement =
  | { kind: 'box'; x: number; y: number; width: number; height: number; line: number }
  | { kind: 'bar'; x: number; y: number; width: number; height: number }
  | { kind: 'text'; x: number; y: number; height: number; value: string }
  | { kind: 'barcode'; x: number; y: number; height: number; moduleDots: number; value: string };

export interface CardLanguage {
  /** Makes a value safe to place in a field of this printer language, at most `maxLength` long. */
  clean(value: string | null | undefined, maxLength: number): string;
  /** About how wide one character is, as a share of the text height. */
  characterWidth: number;
}

const LEFT = 10;
const INNER_WIDTH = 812;
const MARGIN = 45;
const CONTENT_WIDTH = INNER_WIDTH - 2 * (MARGIN - LEFT);
const RIGHT_COLUMN = 425;
const COLUMN_WIDTH = 362;
const MIN_TEXT_HEIGHT = 16;
const EMPTY = '-';
const COMMENT_LINE_LENGTH = 52;

/**
 * A value at the largest height, up to `preferred`, that keeps it inside `available` dots.
 * One still too long at the smallest readable height is cut short rather than printed over
 * the next column.
 */
function fitted(language: CardLanguage, x: number, y: number, value: string, available: number, preferred: number) {
  const perCharacter = language.characterWidth;
  const widest = Math.floor(available / (Math.max(value.length, 1) * perCharacter));
  const height = Math.max(MIN_TEXT_HEIGHT, Math.min(preferred, widest));
  const room = Math.floor(available / (height * perCharacter));
  const shown = value.length > room ? `${value.slice(0, Math.max(room - 3, 1))}...` : value;
  return { kind: 'text' as const, x, y, height, value: shown };
}

/** Centres text across the card by its estimated width. */
function centred(language: CardLanguage, y: number, value: string, preferred: number) {
  const text = fitted(language, MARGIN, y, value, CONTENT_WIDTH, preferred);
  const width = Math.round(text.value.length * text.height * language.characterWidth);
  return { ...text, x: Math.max(MARGIN, LEFT + Math.round((INNER_WIDTH - width) / 2)) };
}

function field(language: CardLanguage, label: string, value: string, x: number, y: number): CardElement[] {
  return [
    { kind: 'text', x, y, height: 22, value: label },
    fitted(language, x, y + 30, value || EMPTY, COLUMN_WIDTH, 34),
  ];
}

export function cutterCardLayout(fields: CutterCardFields, language: CardLanguage): CardElement[] {
  const clean = language.clean;
  const buildId = clean(fields.buildId, 72);
  // Code 128 subset B: 11 modules per character plus start, check and stop. Three dots per module when it fits.
  const modules = 11 * (buildId.length + 2) + 13;
  const moduleDots = Math.max(1, Math.min(3, Math.floor(CONTENT_WIDTH / modules)));
  const comments = clean(fields.comments, 2 * COMMENT_LINE_LENGTH + 1) || EMPTY;
  const rows: Array<[string, string, string, string]> = [
    ['CUTTER BODY', clean(fields.bodyNumber, 48), 'SUMMARY', clean(fields.summary, 48)],
    ['PART TYPE', clean(fields.partType, 32), 'BLADE QTY', clean(String(fields.bladeCount ?? ''), 8)],
    ['SOURCE TRAY', clean(fields.sourceTray, 48), 'STATUS', clean(fields.status, 32)],
    ['BUILT BY', clean(fields.name, 48), 'MACHINE', clean(fields.machine, 32)],
    ['HONED', fields.honed ? 'YES' : 'NO', 'COATED', fields.coated ? 'YES' : 'NO'],
  ];

  return [
    { kind: 'box', x: LEFT, y: 5, width: INNER_WIDTH, height: 1235, line: 5 },
    { kind: 'text', x: MARGIN, y: 35, height: 36, value: 'MESHFORGE' },
    { kind: 'text', x: MARGIN, y: 80, height: 50, value: 'CUTTER BUILD CARD' },
    {
      kind: 'barcode',
      x: LEFT + Math.round((INNER_WIDTH - modules * moduleDots) / 2),
      y: 150,
      height: 140,
      moduleDots,
      value: buildId,
    },
    centred(language, 302, buildId, 40),
    { kind: 'bar', x: MARGIN, y: 358, width: CONTENT_WIDTH, height: 3 },
    ...rows.flatMap(([leftLabel, leftValue, rightLabel, rightValue], row) => [
      ...field(language, leftLabel, leftValue, MARGIN, 385 + row * 110),
      ...field(language, rightLabel, rightValue, RIGHT_COLUMN, 385 + row * 110),
    ]),
    { kind: 'text', x: MARGIN, y: 935, height: 22, value: 'BUILT ON' },
    fitted(language, MARGIN, 965, clean(fields.buildDate, 30) || EMPTY, CONTENT_WIDTH, 30),
    { kind: 'text', x: MARGIN, y: 1045, height: 22, value: 'COMMENTS' },
    fitted(language, MARGIN, 1078, comments.slice(0, COMMENT_LINE_LENGTH).trim(), CONTENT_WIDTH, 24),
    ...(comments.length > COMMENT_LINE_LENGTH
      ? [fitted(language, MARGIN, 1112, comments.slice(COMMENT_LINE_LENGTH).trim(), CONTENT_WIDTH, 24)]
      : []),
  ];
}
