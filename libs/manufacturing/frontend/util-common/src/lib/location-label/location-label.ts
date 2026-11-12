/*
 * The 4 x 6 in location label, printed landscape (6 in across, 4 in tall): the Summary and part
 * type kept at the location in large type on the left, the location number on the right, and
 * the location's own barcode across the bottom (Code 128 of its serial, the same value its
 * small tag carries, so a scan finds the location).
 *
 * It is a browser print, like the 4 x 6 coater container labels, so it goes to whatever 4 x 6
 * printer the workstation has installed. Print at actual size, landscape, with no margins.
 */

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

const CODE128_PATTERNS: readonly string[] = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212',
  '112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131',
  '311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321',
  '112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121',
  '313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114',
  '122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212',
  '124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113',
  '114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112',
];

/** Code 128 needs at least ten modules of white either side to scan. */
const QUIET_ZONE_MODULES = 10;

/** Column widths inside the 0.25 in margins, in CSS pixels (96 per inch). */
const SUMMARY_COLUMN_PX = 3.15 * 96;
const NUMBER_COLUMN_PX = 2.1 * 96;

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

/** Code 128 subset B symbol values for `value`: start B, the characters, check, stop. */
export function code128BSymbols(value: string): number[] {
  if (!/^[\x20-\x7e]{1,80}$/.test(value)) {
    throw new Error(`${value || 'An empty value'} cannot be printed as a barcode.`);
  }
  const codes = [104, ...Array.from(value, (character) => character.charCodeAt(0) - 32)];
  const check = codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
  return [...codes, check, 106];
}

/** The barcode as an SVG that fills the label width; bars are whole modules so they stay crisp. */
export function code128Svg(value: string): string {
  let x = QUIET_ZONE_MODULES;
  const bars: string[] = [];
  for (const symbol of code128BSymbols(value)) {
    Array.from(CODE128_PATTERNS[symbol], Number).forEach((width, index) => {
      if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="1"/>`);
      x += width;
    });
  }
  const total = x + QUIET_ZONE_MODULES;
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(value)}" viewBox="0 0 ${total} 1" preserveAspectRatio="none" shape-rendering="crispEdges"><title>${esc(value)}</title><g fill="#000">${bars.join('')}</g></svg>`;
}

function labelSection(input: LocationLabelInput): string {
  const serial = clean(input.serial_number).toUpperCase();
  const number = clean(input.number) || serial;
  const summary = clean(input.summary).toUpperCase();
  const partType = clean(input.part_type).toUpperCase();
  const footer = [clean(input.description), clean(input.department)].filter(Boolean).join(' · ');
  const value = (text: string, preferred: number) =>
    text
      ? `<div class="value" style="font-size:${fittedFontSize(text, preferred, SUMMARY_COLUMN_PX)}px">${esc(text)}</div>`
      : '<div class="value unset">Not set</div>';

  return `<section class="label">
    <header><span>MESHFORGE</span><span>LOCATION</span></header>
    <div class="top">
      <div class="part">
        <div class="caption">SUMMARY</div>${value(summary, 72)}
        <div class="caption">PART TYPE</div>${value(partType, 56)}
      </div>
      <div class="location">
        <div class="caption">LOCATION #</div>
        <div class="number" style="font-size:${fittedFontSize(number, 72, NUMBER_COLUMN_PX)}px">${esc(number)}</div>
      </div>
    </div>
    <div class="barcode">${code128Svg(serial)}</div>
    <div class="serial">${esc(serial)}${footer ? ` <span>· ${esc(footer)}</span>` : ''}</div>
  </section>`;
}

/** One printable document, one 4 x 6 page per location. */
export function locationLabelsHtml(labels: readonly LocationLabelInput[]): string {
  if (!labels.length) throw new Error('Choose at least one location to print.');
  const title = labels.length === 1 ? `${clean(labels[0].serial_number).toUpperCase()} · Location label` : `${labels.length} location labels`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page{size:6in 4in;margin:0}
  *{box-sizing:border-box}
  body{font:14px Arial,Helvetica,sans-serif;margin:0;color:#000;background:#fff}
  .toolbar{text-align:center;padding:12px;background:#eee}
  .toolbar button{padding:8px 16px;font:inherit}
  .toolbar p{margin:8px 0 0}
  .label{width:6in;height:4in;padding:.25in;margin:12px auto;page-break-after:always;break-after:page;border:1px solid #999;display:flex;flex-direction:column;overflow:hidden}
  .label:last-child{page-break-after:auto;break-after:auto}
  header{display:flex;justify-content:space-between;font-weight:bold;letter-spacing:2px;font-size:13px;border-bottom:3px solid #000;padding-bottom:6px}
  .top{display:flex;flex:1;min-height:0}
  .part{flex:0 0 3.25in;min-width:0;padding-right:.1in}
  .location{flex:1;min-width:0;border-left:3px solid #000;padding-left:.1in;display:flex;flex-direction:column}
  .caption{font-size:12px;font-weight:bold;letter-spacing:1.5px;margin-top:6px}
  .value{font-weight:bold;line-height:1;white-space:nowrap;overflow:hidden}
  .value.unset{font-size:26px;font-weight:normal;font-style:italic}
  .number{font-weight:bold;line-height:1;white-space:nowrap;overflow:hidden;margin:auto 0;text-align:center}
  .barcode{border-top:3px solid #000;padding-top:6px}
  .barcode svg{display:block;width:100%;height:.8in}
  .serial{font:bold 16px "Courier New",monospace;letter-spacing:1px;margin-top:3px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .serial span{font:12px Arial,Helvetica,sans-serif;letter-spacing:0}
  @media print{.toolbar{display:none}.label{border:0;margin:0}}
  </style></head><body><div class="toolbar"><button type="button" id="print-labels">Print ${labels.length === 1 ? 'label' : 'labels'}</button><p>4 × 6 label · Landscape · Actual size (100%) · No margins</p></div>${labels.map(labelSection).join('')}</body></html>`;
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
  if (!popup) return { ok: false, reason: 'Allow pop-ups for this site, then select Print 4×6 Label again.' };
  popup.opener = null;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.document.getElementById('print-labels')?.addEventListener('click', () => popup.print());
  popup.focus();
  popup.print();
  return { ok: true };
}
