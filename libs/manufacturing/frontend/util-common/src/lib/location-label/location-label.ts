/*
 * The 4 x 6.5 in location label, printed landscape (6.5 in across, 4 in tall). Read from across
 * the aisle: the Summary kept at the location fills the top row, the part type and the
 * location number share the row under it, each as large as its width allows, and the
 * location's own barcode runs across the bottom (Code 128 of its serial, the same value its
 * small tag carries, so a scan finds the location).
 *
 * Normally the label is printed by the API on a 4 x 6.5 card printer (POST
 * /asset-tags/location-label, the same printers as the Cutter Build card). This browser print
 * is the fallback when no card printer is set up or it does not take the label: choose a 4 x 6.5
 * printer in the dialog and print at actual size, landscape, with no margins.
 */

import { code128BLayout } from '../barcodes';

/** What one label shows. Values come from the location record the page already loaded. */
export interface LocationLabelInput {
  /** The barcode value: the location serial, for example GSR-1.955FC-RING. */
  serial_number: string;
  /** The location number, printed large beside its barcode. */
  number?: string | null;
  summary?: string | null;
  part_type?: string | null;
  description?: string | null;
  department?: string | null;
}

export type LocationLabelOpenResult = { ok: true } | { ok: false; reason: string };

/** Width inside the 0.25 in margins, in inches, less a little for the rule between columns. */
const CONTENT_WIDTH_IN = 5.9;
const PX_PER_IN = 96;

/** The largest type each row's height leaves room for, in CSS pixels. */
const SUMMARY_MAX_PX = 112;
const ROW_MAX_PX = 100;

/** Arial bold averages a little over 0.6 of its size per character. */
const CHARACTER_WIDTH = 0.64;

const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] as string,
  );

const clean = (value: string | null | undefined): string => String(value ?? '').replace(/\s+/g, ' ').trim();

/** The largest size, up to `preferred`, that keeps `value` on one line `available` pixels wide. */
export function fittedFontSize(value: string, preferred: number, available: number, smallest = 16): number {
  const widest = Math.floor(available / (Math.max(value.length, 1) * CHARACTER_WIDTH));
  return Math.max(smallest, Math.min(preferred, widest));
}

/** The barcode as an SVG that fills the label width; bars are whole modules so they stay crisp. */
export function code128Svg(value: string): string {
  const { bars, width } = code128BLayout(value);
  const rects = bars.map((bar) => `<rect x="${bar.x}" y="0" width="${bar.width}" height="1"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(value)}" viewBox="0 0 ${width} 1" preserveAspectRatio="none" shape-rendering="crispEdges"><title>${esc(value)}</title><g fill="#000">${rects}</g></svg>`;
}

function labelSection(input: LocationLabelInput): string {
  const serial = clean(input.serial_number).toUpperCase();
  const number = clean(input.number) || serial;
  const summary = clean(input.summary).toUpperCase();
  const partType = clean(input.part_type).toUpperCase();
  const footer = [clean(input.description), clean(input.department)].filter(Boolean).join(' · ');
  const value = (text: string, preferred: number, widthIn: number) =>
    text
      ? `<div class="value" style="font-size:${fittedFontSize(text, preferred, widthIn * PX_PER_IN)}px">${esc(text)}</div>`
      : '<div class="value unset">Not set</div>';
  // Part type and location number share a row in proportion to their length, so neither
  // shrinks to make room for empty space beside the other.
  const partShare = Math.min(0.65, Math.max(0.35, Math.max(partType.length, 4) / (Math.max(partType.length, 4) + Math.max(number.length, 3))));
  const partWidth = CONTENT_WIDTH_IN * partShare;
  const numberWidth = CONTENT_WIDTH_IN - partWidth;

  return `<section class="label">
    <div class="summary"><div class="caption">SUMMARY</div>${value(summary, SUMMARY_MAX_PX, CONTENT_WIDTH_IN)}</div>
    <div class="row">
      <div class="part" style="flex-basis:${partWidth.toFixed(2)}in"><div class="caption">PART TYPE</div>${value(partType, ROW_MAX_PX, partWidth)}</div>
      <div class="location"><div class="caption">LOCATION #</div>${value(number, ROW_MAX_PX, numberWidth)}</div>
    </div>
    <div class="barcode">${code128Svg(serial)}</div>
    <div class="serial">${esc(serial)}${footer ? ` <span>· ${esc(footer)}</span>` : ''}</div>
  </section>`;
}

/** One printable document, one 4 x 6.5 page per location. */
export function locationLabelsHtml(labels: readonly LocationLabelInput[]): string {
  if (!labels.length) throw new Error('Choose at least one location to print.');
  const title = labels.length === 1 ? `${clean(labels[0].serial_number).toUpperCase()} · Location label` : `${labels.length} location labels`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page{size:6.5in 4in;margin:0}
  *{box-sizing:border-box}
  body{font:14px Arial,Helvetica,sans-serif;margin:0;color:#000;background:#fff}
  .toolbar{text-align:center;padding:12px;background:#eee}
  .toolbar button{padding:8px 16px;font:inherit}
  .toolbar p{margin:8px 0 0}
  .label{width:6.5in;height:4in;padding:.25in;margin:12px auto;page-break-after:always;break-after:page;border:1px solid #999;display:flex;flex-direction:column;overflow:hidden}
  .label:last-child{page-break-after:auto;break-after:auto}
  .summary{flex:1 1 0;min-height:0;overflow:hidden}
  .row{display:flex;flex:1 1 0;min-height:0;border-top:3px solid #000}
  .part{flex:0 0 auto;min-width:0;overflow:hidden}
  .location{flex:1;min-width:0;overflow:hidden;border-left:3px solid #000;padding-left:.08in}
  .caption{font-size:11px;font-weight:bold;letter-spacing:1.5px;margin-top:3px}
  .value{font-weight:bold;line-height:.95;white-space:nowrap;overflow:hidden}
  .value.unset{font-size:30px;font-weight:normal;font-style:italic;line-height:1.2}
  .barcode{border-top:3px solid #000;padding-top:4px}
  .barcode svg{display:block;width:100%;height:.6in}
  .serial{font:bold 16px "Courier New",monospace;letter-spacing:1px;margin-top:3px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .serial span{font:12px Arial,Helvetica,sans-serif;letter-spacing:0}
  @media print{.toolbar{display:none}.label{border:0;margin:0}}
  </style></head><body><div class="toolbar"><button type="button" id="print-labels">Print ${labels.length === 1 ? 'label' : 'labels'}</button><p>4 × 6.5 label · Landscape · Actual size (100%) · No margins</p></div>${labels.map(labelSection).join('')}</body></html>`;
}

/**
 * Opens the labels in a new window and the print dialog. Call it from the click itself, or the
 * browser blocks the window.
 */
export function openLocationLabels(labels: readonly LocationLabelInput[], host: Window = window): LocationLabelOpenResult {
  let html: string;
  try {
    html = locationLabelsHtml(labels);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'The label could not be prepared.' };
  }
  const popup = host.open('', '_blank');
  if (!popup) return { ok: false, reason: 'Allow pop-ups for this site, then select Print 4×6.5 Label again.' };
  popup.opener = null;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.document.getElementById('print-labels')?.addEventListener('click', () => popup.print());
  popup.focus();
  popup.print();
  return { ok: true };
}
