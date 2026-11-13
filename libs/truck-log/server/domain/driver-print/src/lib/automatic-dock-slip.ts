import { TRUCK_LOG_VERSION } from '@truck-log/shared/contracts';
import { createHash } from 'node:crypto';

/** A deterministic, self-contained Letter PDF. No viewer process, shell, font download,
 * executable action, external URL, or mutable browser document is involved. */
export interface DockSlipSnapshot {
  id: number; dockCode: string; loadNumber: string; direction: string;
  driverName: string; driverPhone: string; carrierName: string; tractorId: string;
  trailerId: string; isDropTrailer: boolean; originName: string; destinationName: string;
  scheduledAt?: Date | string | null; guardCheckInAt: Date | string;
  dockAssignedAt?: Date | string | null; notes?: string | null;
  siteName: string; footer: string; timeZone: string; gate: 'EAST' | 'WEST';
}
const extras: Record<string, number> = { '\u20ac':128, '\u201a':130, '\u0192':131,
  '\u201e':132, '\u2026':133, '\u2020':134, '\u2021':135, '\u02c6':136,
  '\u2030':137, '\u0160':138, '\u2039':139, '\u0152':140, '\u017d':142,
  '\u2018':145, '\u2019':146, '\u201c':147, '\u201d':148, '\u2022':149,
  '\u2013':150, '\u2014':151, '\u02dc':152, '\u2122':153, '\u0161':154,
  '\u203a':155, '\u0153':156, '\u017e':158, '\u0178':159 };
function printable(value: unknown): string {
  const s = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').normalize('NFC');
  let out = '';
  for (const ch of s) {
    const n = ch.codePointAt(0)!;
    if ((n >= 32 && n <= 126) || (n >= 160 && n <= 255) || extras[ch]) out += ch;
    else {
      const latin = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      if (/^[\x20-\x7e]+$/.test(latin)) out += latin;
      else throw new Error('Dock slip contains a character not supported by its standard PDF font. No print was queued.');
    }
  }
  return out.trim() || '-';
}
function pdfString(s: string): string {
  const bytes = [...s].map(c => extras[c] || c.charCodeAt(0));
  return '<' + Buffer.from(bytes).toString('hex') + '>';
}
// Conservative width bounds for Helvetica; avoid clipping even with wide capitals.
function width(s: string, size: number): number {
  return [...s].reduce((n,c) => n + (/[MWmw@%]/.test(c) ? 1.06 : c === ' ' ? .32 : /[0-9]/.test(c) ? .64 : /[ilI.,:;!'()\/]/.test(c) ? .5 : /[A-Z]/.test(c) ? .9 : /[a-z]/.test(c) ? .8 : 1.06) * size, 0);
}
function wrap(s: string, size: number, max: number): string[] {
  const lines: string[] = []; let line = '';
  for (const word of s.split(/\s+/)) {
    if (line && width(line + ' ' + word, size) <= max) { line += ' ' + word; continue; }
    if (line) { lines.push(line); line = ''; }
    for (const ch of word) { if (line && width(line + ch, size) > max) { lines.push(line); line = ''; } line += ch; }
  }
  if (line) lines.push(line); return lines.length ? lines : ['-'];
}
export function makeAutomaticDockPdf(v: DockSlipSnapshot): Buffer {
  if (!Number.isSafeInteger(v.id) || v.id < 1 || !['EAST','WEST'].includes(v.gate)) throw new Error('Invalid dock slip identity.');
  const ref = 'TL-' + String(v.id).padStart(6, '0');
  const dt = new Intl.DateTimeFormat('en-US', {timeZone:v.timeZone, month:'2-digit',day:'2-digit',year:'numeric',hour:'numeric',minute:'2-digit'});
  const date = (x: unknown) => { if (!x) return '-'; const d = new Date(String(x)); if (!Number.isFinite(d.getTime())) throw new Error('Invalid dock slip date.'); return dt.format(d); };
  const pages: string[][] = [[]]; let ops = pages[0]; let y = 36;
  const text = (s: unknown,x:number,top:number,size=10,bold=false) => ops.push(`BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x} ${792-top-size} Tm ${pdfString(printable(s))} Tj ET`);
  const rect = (x:number,top:number,w:number,h:number) => ops.push(`0.4 w ${x} ${792-top-h} ${w} ${h} re S`);
  const header = (continuation=false) => {
    // Dana diamond vector mark; the standard company name is text, not a substituted image.
    ops.push('0.8 w 32 744 m 52 754 l 72 744 l 52 734 l h S'); text('DANA',40,43,7,true);
    const siteLines=wrap(printable(v.siteName),13,355);
    if(siteLines.length>2)throw new Error('Plant name is too long for the Dock Assignment header. No print was queued.');
    siteLines.forEach((s,i)=>text(s,84,28+i*15,13,true));
    text('DRIVER / DOCK ASSIGNMENT SLIP',84,61,8,true);
    text(ref,475,33,12,true); text(v.gate+' GATE'+(continuation?' - CONTINUED':''),465,54,8,true);
    y=83;
  };
  const footerLines=wrap(printable(v.footer),8,538);
  const shortFooter=footerLines.length<=2;
  const foot = () => {
    text('DO NOT LEAVE THE SITE WITHOUT FINAL GUARD CHECKOUT.',100,736,9,true);
    (shortFooter?footerLines:['Site instructions continue in the document body.']).forEach((s,i)=>text(s,32,750+i*10,8));
    text(ref+'  |  Page '+String(pages.length),454,774,7);
  };
  header();
  const row=(cells:Array<[string,unknown]>,big=false) => {
    const w=548/cells.length, size=big?20:10;
    const rendered=cells.map(([label,value])=>({label,lines:wrap(printable(value),size,w-16)}));
    const h=Math.max(...rendered.map(c=>c.lines.length))*(size+3)+25;
    if(h>580)throw new Error('A dock slip field exceeds the printable page height. No print was queued.');
    if(y+h>678){foot();ops=[];pages.push(ops);header(true);}
    for(let i=0;i<rendered.length;i++){const x=32+i*w;rect(x,y,w,h);text(rendered[i].label.toUpperCase(),x+8,y+6,7,true);rendered[i].lines.forEach((s,j)=>text(s,x+8,y+20+j*(size+3),size,big));}
    y+=h+7;
  };
  row([['Assigned Dock',v.dockCode],['Load Number',v.loadNumber]],true);
  row([['Driver',v.driverName],['Driver Phone',v.driverPhone]]);
  row([['Carrier',v.carrierName],['Tractor ID',v.tractorId]]);
  row([['Trailer ID',v.trailerId],['Drop Trailer',v.isDropTrailer?'Yes':'No']]);
  row([['Scheduled Time',date(v.scheduledAt)],['Direction',v.direction]]);
  row([['Origin',v.originName],['Destination',v.destinationName]]);
  row([['Guard Check-In',date(v.guardCheckInAt)],['Dock Assigned',date(v.dockAssignedAt || v.guardCheckInAt)]]);
  const notes=wrap(printable(v.notes || 'No additional guard / dock notes.'),9,532);
  for(let n=0;n<notes.length;){ if(y+40>663){foot();ops=[];pages.push(ops);header(true);} const take=Math.min(notes.length-n,Math.floor((670-y-23)/12)); const chunk=notes.slice(n,n+Math.max(1,take));const h=23+chunk.length*12;rect(32,y,548,h);text('GUARD / DOCK NOTES'+(n?' (CONTINUED)':''),40,y+5,7,true);chunk.forEach((s,j)=>text(s,40,y+20+j*12,9));y+=h+7;n+=chunk.length; }
  if(!shortFooter) {
    for(let n=0;n<footerLines.length;){
      if(y+40>663){foot();ops=[];pages.push(ops);header(true);}
      const take=Math.max(1,Math.min(footerLines.length-n,Math.floor((670-y-23)/12))),h=23+take*12;
      rect(32,y,548,h);text('SITE / CHECKOUT INSTRUCTIONS',40,y+5,7,true);
      footerLines.slice(n,n+take).forEach((s,i)=>text(s,40,y+20+i*12,8));y+=h+7;n+=take;
    }
  }
  if(y+57>678){foot();ops=[];pages.push(ops);header(true);}
  text('DRIVER INSTRUCTIONS',40,y,8,true);y+=14;
  for(const s of ['1. Proceed to the assigned dock. Keep this slip with you while on site.','2. Follow all posted plant traffic, safety, and dock instructions.','3. Return to the guard shack for final checkout after loading/unloading.']){text(s,40,y,9);y+=13;}
  rect(32,689,548,39);text('FINAL GUARD CHECKOUT - SIGNOFF',40,694,7,true);text('Driver signature: ____________________   Date/time: ____________________',40,709,9);foot();
  const objects: Buffer[]=[];const add=(s:string|Buffer)=>{objects.push(Buffer.isBuffer(s)?s:Buffer.from(s,'ascii'));return objects.length;};
  add('<< /Type /Catalog /Pages 2 0 R >>');add('');add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids:number[]=[];
  for(const p of pages){const content=Buffer.from('0 g 0 G\n'+p.join('\n')+'\n','ascii');const ci=add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`),content,Buffer.from('endstream')]));kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${ci} 0 R >>`));}
  objects[1]=Buffer.from(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(k=>k+' 0 R').join(' ')}] >>`);
  const chunks=[Buffer.from(`%PDF-1.4\n%TruckLog ${TRUCK_LOG_VERSION}\n`)],offsets=[0];let offset=chunks[0].length;
  objects.forEach((b,i)=>{offsets.push(offset);const c=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),b,Buffer.from('\nendobj\n')]);chunks.push(c);offset+=c.length;});
  chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  const pdf=Buffer.concat(chunks);if(pdf.length>1024*1024)throw new Error('Dock slip exceeds the one-MiB snapshot limit.');return pdf;
}
export function dockPdfSha(bytes:Buffer):string{return createHash('sha256').update(bytes).digest('hex');}
