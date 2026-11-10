import { CutterCardAdjustment, CutterCardIplFields } from './cutter-card-ipl';

/*
 * The Cutter Build card in Zebra ZPL II, for sites whose card printer is a Zebra.
 *
 * It is the same card as the IPL template, element for element: build ID header, body / name /
 * build date on the left, machine / honed / coated on the right, the hand-filled
 * DATE | MACHINE | PIECES table, the Reason line and the build ID barcode. The IPL template
 * puts the card's top at feed position 1260 and its left edge 52 dots in; ZPL prints from the
 * top down, so an IPL point (feed, across) becomes ^FO(across - 42),(1265 - feed).
 * 203 dpi, 4.1 in printable width, 6.5 in card.
 */
const CARD_WIDTH_DOTS = 832;
const CARD_LENGTH_DOTS = 1320;
const LEFT = 10;
const INNER_WIDTH = 812;
const TABLE_ROW_LINES = [346, 397, 448, 499, 549, 600, 651, 702, 753, 804, 855, 905, 957, 1008, 1056];

/** ZPL reads ^ and ~ as the start of a command, so they never reach a field. */
function safeZplField(value: string | null | undefined, maxLength: number): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Printer fields must not contain command or control characters.
    .replace(/[\x00-\x1f\x7f^~\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

const MIN_TEXT_HEIGHT = 16;
/** Font 0 averages about 0.6 of its height per character. */
const CHARACTER_WIDTH = 0.6;

/**
 * A value at the largest height, up to `preferred`, that keeps it inside `available` dots.
 * One still too long at the smallest readable height is cut short rather than printed over
 * the next cell.
 */
function fitted(x: number, y: number, value: string, available: number, preferred: number): string {
  const widest = Math.floor(available / (Math.max(value.length, 1) * CHARACTER_WIDTH));
  const height = Math.max(MIN_TEXT_HEIGHT, Math.min(preferred, widest));
  const room = Math.floor(available / (height * CHARACTER_WIDTH));
  return text(x, y, height, value.length > room ? `${value.slice(0, Math.max(room - 3, 1))}...` : value);
}

const text = (x: number, y: number, height: number, value: string): string => `^FO${x},${y}^A0N,${height},${height}^FD${value}^FS`;
const box = (x: number, y: number, width: number, height: number, line = 4): string => `^FO${x},${y}^GB${width},${height},${line}^FS`;

export function buildCutterCardZpl(fields: CutterCardIplFields, adjustment: CutterCardAdjustment = { right: 0, down: 0 }): Buffer {
  const buildId = safeZplField(fields.buildId, 72);
  const bodyNumber = safeZplField(fields.bodyNumber, 48);
  const name = safeZplField(fields.name, 48);
  const buildDate = safeZplField(fields.buildDate, 30);
  const machine = safeZplField(fields.machine, 32);
  // Code 128 worst case is 11 modules per character plus 35; three dots per module when it fits.
  const barcodeModules = 11 * (buildId.length + 2) + 13;
  const barcodeDots = Math.max(1, Math.min(3, Math.floor((INNER_WIDTH - 20) / barcodeModules)));

  const commands = [
    '^XA',
    '^CI28',
    `^PW${CARD_WIDTH_DOTS}`,
    `^LL${CARD_LENGTH_DOTS}`,
    '^LH0,0',

    // Build ID header
    box(LEFT, 5, INNER_WIDTH, 81),
    text(18, 30, 26, 'Build ID:'),
    fitted(150, 22, buildId, 660, 46),

    // Left column: body number, name, build date
    box(LEFT, 83, 406, 51),
    text(18, 97, 26, 'Body Number:'),
    fitted(190, 95, bodyNumber, 218, 30),
    box(LEFT, 130, 406, 51),
    text(18, 144, 26, 'Name:'),
    fitted(100, 142, name, 308, 30),
    box(LEFT, 178, 406, 51),
    text(18, 192, 26, 'Build Date:'),
    fitted(164, 190, buildDate, 244, 30),

    // Right column: machine, honed, coated
    box(413, 83, 409, 51),
    text(421, 97, 26, 'Machine:'),
    fitted(536, 95, machine, 278, 30),
    box(413, 130, 409, 51),
    text(421, 144, 26, 'Honed:'),
    box(517, 137, 39, 38),
    ...(fields.honed ? [text(526, 142, 30, 'X')] : []),
    box(413, 178, 409, 51),
    text(421, 192, 26, 'Coated:'),
    box(517, 184, 39, 39),
    ...(fields.coated ? [text(526, 189, 30, 'X')] : []),

    // Hand-filled production table
    box(LEFT, 248, INNER_WIDTH, 862),
    box(261, 249, 3, 860, 3),
    box(564, 249, 3, 860, 3),
    text(88, 280, 36, 'DATE'),
    text(338, 280, 36, 'MACHINE'),
    text(634, 280, 36, 'PIECES'),
    ...TABLE_ROW_LINES.map((y) => box(LEFT, y, INNER_WIDTH, 3, 3)),

    // Reason line and build ID barcode
    box(LEFT, 1121, INNER_WIDTH, 51),
    text(18, 1135, 26, 'Reason:'),
    `^BY${barcodeDots},3,51`,
    `^FO17,1183^BCN,51,N,N,N,A^FD${buildId}^FS`,

    '^PQ1',
    '^XZ',
  ];
  // Field data never contains ^ (see safeZplField), so every ^FO here is a real field origin.
  const placed = commands.map((command) =>
    command.replace(/\^FO(\d+),(\d+)/g, (_origin, x: string, y: string) =>
      `^FO${Math.max(0, Number(x) + adjustment.right)},${Math.max(0, Number(y) + adjustment.down)}`,
    ),
  );
  return Buffer.from(placed.join('\r\n') + '\r\n', 'utf8');
}
