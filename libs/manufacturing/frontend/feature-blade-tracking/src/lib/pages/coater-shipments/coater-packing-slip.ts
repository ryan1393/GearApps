import { CoaterPackingSlip } from '@gearapps/manufacturing/shared/util-types';

const PATTERNS = [
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

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const date = (value: string): string => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Indiana/Indianapolis', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' ET';

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
const contents = (container: { trays: Array<{ blades: unknown[] }> }): string =>
  `${plural(container.trays.length, 'tray', 'trays')} · ${plural(container.trays.reduce((n, t) => n + t.blades.length, 0), 'blade', 'blades')}`;

/** Code 128 B. Ten-module quiet zones are included in the SVG. */
export function shipmentBarcode(value: string): string {
  if (!/^[\x20-\x7e]{1,80}$/.test(value)) throw new Error('Shipment number cannot be encoded.');
  const codes = [104, ...Array.from(value, char => char.charCodeAt(0)-32)];
  codes.push(codes.reduce((sum, code, i) => sum + code * (i || 1),0) % 103,106);
  let x = 10; const bars: string[] = [];
  for (const code of codes) Array.from(PATTERNS[code], Number).forEach((width,i) => {
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="48"/>`);
    x += width;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(value)}" viewBox="0 0 ${x+10} 48" width="${(x+10)*1.6}" height="64" preserveAspectRatio="xMidYMid meet"><title>${esc(value)}</title><g fill="#000">${bars.join('')}</g></svg>`;
}

/** One document for the entire shipment. Its source is the audited server snapshot. */
export function coaterPackingSlipHtml(slip: CoaterPackingSlip): string {
  const s=slip.shipment, m=s.manifest;
  const breakdown=m.summary.map(r=>`<tr><td>${esc(r.summary)}</td><td>${esc(r.part_type)}</td><td class="num">${r.trays}</td><td class="num">${r.blades}</td></tr>`).join('');
  const containers=m.containers.map(c=>`<section class="container"><h3>${esc(c.serial)} <span>${contents(c)}</span></h3><table><thead><tr><th>Tray</th><th>Summary</th><th>Part type</th><th class="num">Blades</th></tr></thead><tbody>${c.trays.map(t=>`<tr><td>${esc(t.serial)}</td><td>${esc(t.summary)}</td><td>${esc(t.part_type)}</td><td class="num">${t.blades.length}</td></tr>`).join('')}</tbody></table></section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.number)} · Rev ${s.revision}${slip.reprint?' · REPRINT':''}</title><style>
    @page{size:letter;margin:14mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#111;margin:0;background:#fff}main{max-width:190mm;margin:auto;padding:20px}h1{font-size:25px;margin:0 0 6px}h2{font-size:17px;margin:24px 0 8px;break-after:avoid}h3{font-size:14px;margin:18px 0 0;padding:9px;background:#eee;border:1px solid #777;break-after:avoid}h3 span{float:right;font-weight:normal}.head{display:flex;justify-content:space-between;gap:20px;align-items:start;border-bottom:2px solid #111;padding-bottom:14px}.barcode{text-align:center;flex-shrink:0}.barcode svg{display:block;max-width:270px;margin:0 auto 4px}.number{font-size:16px;font-weight:bold;letter-spacing:1px}.status{font-weight:bold;margin:10px 0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;margin-top:16px}.meta p{margin:0;overflow-wrap:anywhere}.totals{display:flex;gap:12px;margin-top:20px}.totals div{flex:1;border:1px solid #555;padding:12px}.totals strong{font-size:27px;display:block}.totals span{font-size:12px;text-transform:uppercase;letter-spacing:1px}.notes{white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #555;padding:8px 12px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #777;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#eee;font-weight:bold}.num{text-align:right;width:18%}thead{display:table-header-group}tr{break-inside:avoid}.container{break-inside:auto}footer{border-top:1px solid #777;margin-top:20px;padding-top:10px;color:#333;font-size:10px;line-height:1.5}.reprint{font-size:18px;font-weight:bold;border:2px solid #222;padding:5px 12px;display:inline-block;margin:8px 0}.watermark{display:none}.toolbar{background:#eaf0f4;padding:12px;text-align:center}.toolbar button{padding:8px 18px;background:#153c62;color:white;border:0;border-radius:5px;cursor:pointer}.toolbar p{margin:8px 0 0}@media print{main{max-width:none;padding:0}.toolbar{display:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.watermark{display:block;position:fixed;top:43%;left:14%;font-size:84px;font-weight:bold;letter-spacing:6px;color:rgba(0,0,0,.075);transform:rotate(-32deg);z-index:-1;pointer-events:none}}
  </style></head><body><div class="toolbar"><button id="print-slip" type="button">Print packing slip</button><p>Letter paper · Portrait · Print all pages. Printing does not send the shipment.</p></div>${slip.reprint?'<div class="watermark" aria-hidden="true">REPRINT</div>':''}<main>
  <header class="head"><div><h1>Coater packing slip</h1><div>Dana · MeshForge</div>${slip.reprint?'<div class="reprint">REPRINT</div>':''}<p class="status">${s.status==='DISPATCHED'?'DISPATCHED':'PACKED · NOT DISPATCHED'} · Revision ${s.revision}</p></div><div class="barcode">${shipmentBarcode(s.number)}<div class="number">${esc(s.number)}</div></div></header>
  <div class="meta"><p><b>To:</b> ${esc(s.destination)}</p><p><b>Created:</b> ${esc(date(s.created_at))}</p><p><b>Prepared by:</b> ${esc(s.created_by)}</p><p><b>Print requested:</b> ${esc(date(slip.requested_at))}</p><p><b>Printed by:</b> ${esc(slip.requested_by)}</p>${s.dispatched_at?`<p><b>Sent:</b> ${esc(date(s.dispatched_at))} · ${esc(s.dispatched_by)}</p>`:'<p><b>Dispatch:</b> Confirm in Coater Shipments after checking this slip.</p>'}</div>
  <div class="totals"><div><strong>${m.totals.containers}</strong><span>Containers</span></div><div><strong>${m.totals.trays}</strong><span>Trays</span></div><div><strong>${m.totals.blades}</strong><span>Blades</span></div></div>${s.notes?`<p class="notes"><b>Notes:</b> ${esc(s.notes)}</p>`:''}
  <h2>1. Summary breakdown</h2><table><thead><tr><th>Summary</th><th>Part type</th><th class="num">Trays</th><th class="num">Blades</th></tr></thead><tbody>${breakdown}</tbody><tfoot><tr><th colspan="2">Total</th><th class="num">${m.totals.trays}</th><th class="num">${m.totals.blades}</th></tr></tfoot></table>
  <h2>2. Container and tray details</h2>${containers}<footer>${esc(s.number)} · Revision ${s.revision} · ${slip.reprint?'Reprint':'Original print request'}<br>Verify every container, tray and quantity against this revision before selecting Send to Coater. Retain all pages together.</footer></main></body></html>`;
}

export function coaterContainerLabelsHtml(slip: CoaterPackingSlip): string {
  const s=slip.shipment;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(s.number)} · Container labels</title><style>
  @page{size:4in 6in;margin:0}*{box-sizing:border-box}body{font:14px Arial,sans-serif;margin:0;color:#000;background:#fff}.toolbar{text-align:center;padding:12px;background:#eee}.toolbar button{padding:8px 16px}.label{width:4in;height:6in;padding:.25in;margin:12px auto;page-break-after:always;border:1px solid #999;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}.label:last-child{page-break-after:auto}h1{font-size:32px;margin:12px 0;text-align:center}.barcode{text-align:center}.barcode svg{max-width:100%;height:64px}.destination{font-size:18px;font-weight:bold;overflow-wrap:anywhere}.totals{font-size:22px;border-top:2px solid;padding-top:12px}.shipment{font-size:20px;letter-spacing:1px;font-weight:bold}.muted{font-size:12px}.reprint{font-size:20px;font-weight:bold;border:2px solid;padding:5px;text-align:center}@media print{.toolbar{display:none}.label{border:0;margin:0}}
  </style></head><body><div class="toolbar"><button type="button" id="print-slip">Print labels</button><p>4 × 6 paper · Actual size · One label per container</p></div>${s.manifest.containers.map((c,i)=>`<section class="label"><div><b>DANA · COATER SHIPMENT</b><p class="destination">To: ${esc(s.destination)}</p>${slip.reprint?'<div class="reprint">REPRINT</div>':''}<h1>${esc(c.serial)}</h1><div class="barcode">${shipmentBarcode(c.serial)}</div></div><div class="totals">${contents(c)}</div><div><div class="shipment">${esc(s.number)}</div><p>Revision ${s.revision} · Container ${i+1} of ${s.manifest.totals.containers}</p><p><b>${s.status==='DISPATCHED'?'DISPATCHED':'PACKED · NOT DISPATCHED'}</b></p><p class="muted">${esc(date(slip.requested_at))}<br>Refer to the combined packing slip for tray and Summary details.</p></div></section>`).join('')}</body></html>`;
}
