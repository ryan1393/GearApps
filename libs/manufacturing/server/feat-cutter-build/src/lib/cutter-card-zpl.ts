import { CardLanguage, CARD_LENGTH_DOTS, CARD_WIDTH_DOTS, CardElement, CutterCardFields, cutterCardLayout } from './cutter-card-layout';
import { CutterCardAdjustment } from './cutter-card-ipl';
import { safeZplField } from '@meshforge/manufacturing/server/feat-tray';

/*
 * The Cutter Build card in Zebra ZPL II, for sites whose card printer is a Zebra. The layout
 * is shared with the IPL card (see cutter-card-layout.ts). ^FO is across the web, then down
 * the card, the same as the layout's own positions.
 */

/** Font 0 averages about 0.6 of its height per character. */
const ZPL: CardLanguage = { clean: safeZplField, characterWidth: 0.6 };

function zplElement(element: CardElement): string {
  const origin = `^FO${element.x},${element.y}`;
  switch (element.kind) {
    case 'box':
      return `${origin}^GB${element.width},${element.height},${element.line}^FS`;
    case 'bar':
      return `${origin}^GB${element.width},${element.height},${Math.min(element.width, element.height)}^FS`;
    case 'text':
      return `${origin}^A0N,${element.height},${element.height}^FD${element.value}^FS`;
    case 'barcode':
      // Code 128 with no text line of its own; the number is printed under it as its own field.
      return `^BY${element.moduleDots},3,${element.height}\r\n${origin}^BCN,${element.height},N,N,N,N^FD${element.value}^FS`;
  }
}

export function buildCutterCardZpl(fields: CutterCardFields, adjustment: CutterCardAdjustment = { right: 0, down: 0 }): Buffer {
  const commands = ['^XA', '^CI28', `^PW${CARD_WIDTH_DOTS}`, `^LL${CARD_LENGTH_DOTS}`, '^LH0,0', ...cutterCardLayout(fields, ZPL).map(zplElement), '^PQ1', '^XZ'];
  // Field data never contains ^ (see safeZplField), so every ^FO here is a real field origin.
  const placed = commands.map((command) =>
    command.replace(/\^FO(\d+),(\d+)/g, (_origin, x: string, y: string) =>
      `^FO${Math.max(0, Number(x) + adjustment.right)},${Math.max(0, Number(y) + adjustment.down)}`,
    ),
  );
  return Buffer.from(placed.join('\r\n') + '\r\n', 'utf8');
}
