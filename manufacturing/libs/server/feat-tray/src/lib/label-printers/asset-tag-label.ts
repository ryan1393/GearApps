import type { LabelLanguage } from './label-printer.dto';

/*
 * The asset tag for trays, containers and locations, in either printer language.
 *
 * Stock (203 dpi): 2.125 in across the web = 431 dots, 0.625 in along the feed = 127 dots.
 * The barcode and the text under it are the stored serial, Code 128, read across the web.
 */
export const ASSET_TAG_WIDTH_DOTS = 431;
export const ASSET_TAG_HEIGHT_DOTS = 127;

/*
 * Code 128 needs 11 modules per character plus start, check and stop (35 modules). At one dot
 * per module, starting 28 dots in and keeping a 10-module quiet zone, 32 characters is the most
 * that stays on the label face. Up to 14 characters fit at two dots per module, which scans
 * far more reliably on a 203 dpi printer.
 */
export const ASSET_TAG_MAX_SERIAL_LENGTH = 32;
const BARCODE_START_DOTS = 28;
const BARCODE_HEIGHT_DOTS = 55;
const TOP_MARGIN_DOTS = 10;
const TEXT_TOP_DOTS = 78;

const barcodeModuleDots = (serial: string): 1 | 2 => (serial.length <= 14 ? 2 : 1);

export function assetTagFileName(serial: string, language: LabelLanguage): string {
  return `${serial}.${language === 'ZPL' ? 'zpl' : 'prn'}`;
}

export function buildAssetTag(language: LabelLanguage, serial: string): Buffer {
  return language === 'ZPL' ? buildAssetTagZpl(serial) : buildAssetTagIpl(serial);
}

/**
 * Intermec IPL. In IPL the first origin value runs along the feed and the second across the
 * web, and a direction-0 field reads along the feed. Fields that read across the web are
 * direction 3 with their top edge at the larger feed value, exactly as on the Cutter Build
 * card (its barcode is `o82,59;f3`). So a field meant to sit N dots below the top of the tag
 * has its origin at 127 - N.
 */
export function buildAssetTagIpl(serial: string): Buffer {
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
  const textAcross = Math.max(16, Math.floor((ASSET_TAG_WIDTH_DOTS - serial.length * text.w) / 2));
  const barcodeFeed = ASSET_TAG_HEIGHT_DOTS - TOP_MARGIN_DOTS;
  const textFeed = ASSET_TAG_HEIGHT_DOTS - TEXT_TOP_DOTS;

  const commands = [
    `${STX}R${ETX}`,
    `${STX}${ESC}C${SI}W${ASSET_TAG_WIDTH_DOTS}${ETX}`,
    `${STX}${ESC}P${ETX}`,
    `${STX}E${formatNumber};F${formatNumber};${ETX}`,
    `${STX}B0,AssetTagBarcode;o${barcodeFeed},${BARCODE_START_DOTS};f3;h${BARCODE_HEIGHT_DOTS};w${barcodeModuleDots(serial)};c6;i0;d3,${serial};${ETX}`,
    `${STX}H1,AssetTagText;o${textFeed},${textAcross};f3;h${text.h};w${text.w};c26;r0;b0;d3,${serial};${ETX}`,
    `${STX}R${ETX}`,
    `${STX}${ESC}E${formatNumber}${ETX}`,
    `${STX}${CAN}${ETX}`,
    `${STX}${ETB}${FF}${ETX}`,
  ];
  return Buffer.from(commands.join('\r\n'), 'latin1');
}

/** Zebra ZPL II. ^FO is across the web, then down the feed. */
export function buildAssetTagZpl(serial: string): Buffer {
  const textHeight = serial.length <= 6 ? 34 : serial.length <= 14 ? 28 : 20;
  const commands = [
    '^XA',
    `^PW${ASSET_TAG_WIDTH_DOTS}`,
    `^LL${ASSET_TAG_HEIGHT_DOTS}`,
    '^LH0,0',
    `^BY${barcodeModuleDots(serial)},3,${BARCODE_HEIGHT_DOTS}`,
    // Code 128, no text line of its own, automatic subset selection.
    `^FO${BARCODE_START_DOTS},${TOP_MARGIN_DOTS}^BCN,${BARCODE_HEIGHT_DOTS},N,N,N,A^FD${serial}^FS`,
    `^FO0,${TEXT_TOP_DOTS}^A0N,${textHeight},${textHeight}^FB${ASSET_TAG_WIDTH_DOTS},1,0,C,0^FD${serial}\\&^FS`,
    '^PQ1',
    '^XZ',
  ];
  return Buffer.from(commands.join('\r\n') + '\r\n', 'ascii');
}
