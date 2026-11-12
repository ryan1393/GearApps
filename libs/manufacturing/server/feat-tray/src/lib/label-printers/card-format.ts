/*
 * What every 4 x 6.5 in card printed to a card printer shares, whatever is on it: the Cutter
 * Build card and the location label. The IPL printer setup before and after the fields is the
 * one from the supplied CutterLabel_FILLED.prn (docs/manufacturing), known to print on the
 * card stock, so both cards use it unchanged.
 */

export const STX = '\x02';
export const ETX = '\x03';
export const ESC = '\x1b';
export const SI = '\x0f';

/** Card stock in dots (203 per inch): 832 across the web (4.1 in printable), 1320 long (6.5 in). */
export const CARD_WIDTH_DOTS = 832;
export const CARD_LENGTH_DOTS = 1320;

/** How far to move everything on one printer's stock, in dots (Admin > Label Printers). */
export interface CardAdjustment {
  right: number;
  down: number;
}

export const CARD_IPL_SETUP: readonly string[] = [`${STX}R${ETX}`, `${STX}${ESC}k${ETX}`, `${STX}${ESC}C0${ETX}`, `${STX}${ESC}P;${ETX}`, `${STX}E*;F*;${ETX}`];
export const CARD_IPL_FINISH: readonly string[] = [
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

/** IPL field data: no control bytes, and no ; or , which end a field. */
export function safeIplField(value: string | null | undefined, maxLength = 80): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Printer fields must not contain command control bytes.
    .replace(/[\x00-\x1f\x7f;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** ZPL field data: ^ and ~ start commands, so they never reach a field. */
export function safeZplField(value: string | null | undefined, maxLength: number): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Printer fields must not contain command or control characters.
    .replace(/[\x00-\x1f\x7f^~\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
