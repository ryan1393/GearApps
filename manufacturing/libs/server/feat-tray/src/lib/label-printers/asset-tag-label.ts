import type { LabelAdjustment, LabelLanguage } from './label-printer.dto';

/*
 * The asset tag for trays, containers and locations, in either printer language.
 *
 * Stock (203 dpi): 2.125 in across the web = 431 dots, 0.625 in along the feed = 127 dots.
 * The barcode is Code 128 of the stored serial, centred, with the serial as text centred
 * under it. Barcode plus text are 86 dots tall on the 127-dot label, so the tag still lands
 * on the label when a printer registers a couple of millimetres early or late.
 */
export const ASSET_TAG_WIDTH_DOTS = 431;
export const ASSET_TAG_HEIGHT_DOTS = 127;

/*
 * Code 128 needs 11 modules per character plus start, check and stop (35). At one dot per
 * module, 30 characters is the most that keeps its quiet zones on the label when the tag lands
 * a few millimetres to one side.
 */
export const ASSET_TAG_MAX_SERIAL_LENGTH = 30;

const BARCODE_TOP_DOTS = 20;
const BARCODE_HEIGHT_DOTS = 54;
const TEXT_TOP_DOTS = 78;

/*
 * Where a Zebra put the first tags printed from this layout, measured from the printed labels:
 * about 20 dots (2.5 mm) above and 23 dots (2.9 mm) left of where the format placed them, the
 * top of the barcode falling in the gap before the label. ZPL tags are moved back by that
 * much. A printer that differs is corrected with its own adjustment in Admin > Label Printers.
 */
const ZPL_REGISTRATION: LabelAdjustment = { right: 23, down: 20 };
const NO_ADJUSTMENT: LabelAdjustment = { right: 0, down: 0 };

/** Code 128 subset B: start, one symbol per character, check, stop. */
const barcodeModules = (serial: string): number => 11 * (serial.length + 2) + 13;

/**
 * The widest bars that leave the barcode its quiet zones even when the tag lands a few
 * millimetres to one side: three dots for a T or C serial, two for a typical location.
 */
const barcodeModuleDots = (serial: string): 1 | 2 | 3 => (serial.length <= 6 ? 3 : serial.length <= 12 ? 2 : 1);

const centred = (width: number): number => Math.max(0, Math.round((ASSET_TAG_WIDTH_DOTS - width) / 2));

export function assetTagFileName(serial: string, language: LabelLanguage): string {
  return `${serial}.${language === 'ZPL' ? 'zpl' : 'prn'}`;
}

export function buildAssetTag(language: LabelLanguage, serial: string, adjustment: LabelAdjustment = NO_ADJUSTMENT): Buffer {
  return language === 'ZPL' ? buildAssetTagZpl(serial, adjustment) : buildAssetTagIpl(serial, adjustment);
}

/**
 * Intermec IPL. In IPL the first origin value runs along the feed and the second across the
 * web, and a direction-0 field reads along the feed. Fields that read across the web are
 * direction 3 with their top edge at the larger feed value, exactly as on the Cutter Build
 * card (its barcode is `o82,59;f3`). So a field meant to sit N dots below the top of the tag
 * has its origin at 127 - N.
 */
export function buildAssetTagIpl(serial: string, adjustment: LabelAdjustment = NO_ADJUSTMENT): Buffer {
  const STX = '\x02';
  const ETX = '\x03';
  const ESC = '\x1b';
  const SI = '\x0f';
  const CAN = '\x18';
  const ETB = '\x17';
  const FF = '\x0c';
  const formatNumber = 97;

  const text =
    serial.length <= 6 ? { h: 21, w: 20 } : serial.length <= 14 ? { h: 11, w: 10 } : { h: 11, w: 8 };
  const dots = barcodeModuleDots(serial);
  const across = (start: number): number => Math.max(0, start + adjustment.right);
  const feed = (below: number): number => Math.max(0, ASSET_TAG_HEIGHT_DOTS - below - adjustment.down);

  const commands = [
    `${STX}R${ETX}`,
    `${STX}${ESC}C${SI}W${ASSET_TAG_WIDTH_DOTS}${ETX}`,
    `${STX}${ESC}P${ETX}`,
    `${STX}E${formatNumber};F${formatNumber};${ETX}`,
    `${STX}B0,AssetTagBarcode;o${feed(BARCODE_TOP_DOTS)},${across(centred(barcodeModules(serial) * dots))};f3;h${BARCODE_HEIGHT_DOTS};w${dots};c6;i0;d3,${serial};${ETX}`,
    `${STX}H1,AssetTagText;o${feed(TEXT_TOP_DOTS)},${across(centred(serial.length * text.w))};f3;h${text.h};w${text.w};c26;r0;b0;d3,${serial};${ETX}`,
    `${STX}R${ETX}`,
    `${STX}${ESC}E${formatNumber}${ETX}`,
    `${STX}${CAN}${ETX}`,
    `${STX}${ETB}${FF}${ETX}`,
  ];
  return Buffer.from(commands.join('\r\n'), 'latin1');
}

/**
 * Zebra ZPL II. ^FO is across the web, then down the feed. The label length is left to the
 * printer's own media calibration: on gap stock it knows where each label starts.
 */
export function buildAssetTagZpl(serial: string, adjustment: LabelAdjustment = NO_ADJUSTMENT): Buffer {
  const right = ZPL_REGISTRATION.right + adjustment.right;
  const down = ZPL_REGISTRATION.down + adjustment.down;
  const dots = barcodeModuleDots(serial);
  const textHeight = serial.length <= 14 ? 28 : 20;
  const x = (start: number): number => Math.max(0, start + right);
  const y = (below: number): number => Math.max(0, below + down);

  const commands = [
    '^XA',
    `^PW${ASSET_TAG_WIDTH_DOTS}`,
    '^LH0,0',
    `^BY${dots},3,${BARCODE_HEIGHT_DOTS}`,
    // Code 128 subset B with no text line of its own, so its width is known and it can be centred.
    `^FO${x(centred(barcodeModules(serial) * dots))},${y(BARCODE_TOP_DOTS)}^BCN,${BARCODE_HEIGHT_DOTS},N,N,N,N^FD${serial}^FS`,
    // Centred text: the block is narrowed on one side so its middle moves with the tag and it never leaves the label.
    `^FO${Math.max(0, 2 * right)},${y(TEXT_TOP_DOTS)}^A0N,${textHeight},${textHeight}^FB${ASSET_TAG_WIDTH_DOTS - 2 * Math.abs(right)},1,0,C,0^FD${serial}\\&^FS`,
    '^PQ1',
    '^XZ',
  ];
  return Buffer.from(commands.join('\r\n') + '\r\n', 'ascii');
}
