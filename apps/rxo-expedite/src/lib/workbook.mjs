/** RXO_EXPEDITE bounded, read-only reader for the native plain-cell OOXML export.
 * Not a general spreadsheet engine. Unsupported constructs are held for review.
 * No formulas/macros/links are evaluated and Excel serials are never assigned a timezone.
 */
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
export const SOURCE = 'RXO_EXPEDITE';
export const HEADERS = Object.freeze(['Critical','Shipment Id','Auth. Code','Origin Name','Origin','Destination','SCAC','Commodity','Mode','Current Location','Next Stop','ETA Next Stop','ETA Status']);
export class ExpediteError extends Error { constructor(code) { super(code); this.name='ExpediteError';this.code=code; } }
const need=(b,c)=>{if(!b)throw new ExpediteError(c);};
export const sha256=b=>createHash('sha256').update(b).digest('hex');
const crcTable=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(b){let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
const utf8=b=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{throw new ExpediteError('XLSX_ENCODING_REVIEW');}};
/** ZIP central directory and local records must agree. Inflation is individually bounded. */
export function unzipWorkbook(buffer){
 need(Buffer.isBuffer(buffer)&&buffer.length>=22&&buffer.length<=20*1024*1024,'XLSX_SIZE_REVIEW');
 const b=buffer;let e=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){e=i;break;}
 need(e>=0,'XLSX_ZIP_REVIEW');const count=b.readUInt16LE(e+10),off=b.readUInt32LE(e+16),size=b.readUInt32LE(e+12);
 need(b.readUInt16LE(e+4)===0&&b.readUInt16LE(e+6)===0&&b.readUInt16LE(e+8)===count&&count>0&&count<=256&&off+size===e,'XLSX_ZIP_REVIEW');
 const entries=new Map();let p=off,total=0;const spans=[];
 for(let k=0;k<count;k++){
  need(p+46<=e&&b.readUInt32LE(p)===0x02014b50,'XLSX_ZIP_REVIEW');
  const flags=b.readUInt16LE(p+8),method=b.readUInt16LE(p+10),crc=b.readUInt32LE(p+16),packed=b.readUInt32LE(p+20),plain=b.readUInt32LE(p+24),nl=b.readUInt16LE(p+28),el=b.readUInt16LE(p+30),cl=b.readUInt16LE(p+32),local=b.readUInt32LE(p+42);
  need(p+46+nl+el+cl<=e&&b.readUInt16LE(p+34)===0&&!(flags&~0x808)&&[0,8].includes(method),'XLSX_ZIP_REVIEW');
  const name=utf8(b.subarray(p+46,p+46+nl));p+=46+nl+el+cl;
  need(name.length>0&&!name.includes('\\')&&!name.includes('\0')&&!name.startsWith('/')&&!name.split('/').includes('..')&&!entries.has(name),'XLSX_PATH_REVIEW');
  need(!/externalLinks|vbaProject|oleObjects|activeX|embeddings/i.test(name),'XLSX_ACTIVE_CONTENT_REVIEW');
  total+=plain;need(plain<=16*1024*1024&&total<=64*1024*1024&&plain<=Math.max(1024*1024,packed*200),'XLSX_SIZE_REVIEW');
  need(local+30<=off&&b.readUInt32LE(local)===0x04034b50&&b.readUInt16LE(local+6)===flags&&b.readUInt16LE(local+8)===method,'XLSX_ZIP_REVIEW');
  const ln=b.readUInt16LE(local+26),le=b.readUInt16LE(local+28),start=local+30+ln+le,end=start+packed;
  need(end<=off&&utf8(b.subarray(local+30,local+30+ln))===name,'XLSX_ZIP_REVIEW');
  if(!(flags&8))need(b.readUInt32LE(local+14)===crc&&b.readUInt32LE(local+18)===packed&&b.readUInt32LE(local+22)===plain,'XLSX_ZIP_REVIEW');
  need(!spans.some(([a,z])=>local<z&&end>a),'XLSX_ZIP_REVIEW');spans.push([local,end]);
  let bytes;try{bytes=method===0?Buffer.from(b.subarray(start,end)):inflateRawSync(b.subarray(start,end),{maxOutputLength:Math.max(1,plain)});}catch{throw new ExpediteError('XLSX_ZIP_REVIEW');}
  need(bytes.length===plain&&crc32(bytes)===crc,'XLSX_CRC_REVIEW');entries.set(name,bytes);
 }
 need(p===e,'XLSX_ZIP_REVIEW');return entries;
}
const XMLNS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELNS='http://schemas.openxmlformats.org/package/2006/relationships';
function decodeXML(s){
 need(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(s),'XLSX_XML_REVIEW');
 return s.replace(/&([^;\s]{1,20});|&/g,(full,entity)=>{
  const builtin={amp:'&',lt:'<',gt:'>',apos:"'",quot:'"'};if(Object.hasOwn(builtin,entity))return builtin[entity];
  need(typeof entity==='string'&&/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity),'XLSX_XML_REVIEW');
  const n=entity.startsWith('#x')?parseInt(entity.slice(2),16):Number(entity.slice(1));
  need([9,10,13].includes(n)||(n>=32&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff),'XLSX_XML_REVIEW');return String.fromCodePoint(n);
 });
}
/** Conservative XML subset. Reject DTD/CDATA/foreign prefixes rather than guessing. */
export function readXML(bytes){
 let text=utf8(bytes).replace(/^\ufeff/,'');need(!/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(text),'XLSX_XML_REVIEW');
 text=text.replace(/^<\?xml\s+[^?]*\?>\s*/,'');const stack=[],roots=[];let at=0,nodes=0;
 while(at<text.length){
  if(text.startsWith('<!--',at)){const end=text.indexOf('-->',at+4);need(end>=0&&!text.slice(at+4,end).includes('--'),'XLSX_XML_REVIEW');at=end+3;continue;}
  if(text[at]!=='<'){let end=text.indexOf('<',at);if(end<0)end=text.length;const value=decodeXML(text.slice(at,end));if(stack.length)stack.at(-1).text+=value;else need(value.trim()==='','XLSX_XML_REVIEW');at=end;continue;}
  let end=at+1,q='';for(;end<text.length;end++){const c=text[end];if(q){if(c===q)q='';}else if(c==='"'||c==="'")q=c;else if(c==='>')break;}
  need(end<text.length,'XLSX_XML_REVIEW');let body=text.slice(at+1,end);at=end+1;
  if(body.startsWith('/')){const node=stack.pop();need(node&&body.slice(1).trim()===node.name,'XLSX_XML_REVIEW');continue;}
  const match=/^([A-Za-z_][\w.:-]*)([\s\S]*)$/.exec(body);need(match,'XLSX_XML_REVIEW');const name=match[1];let tail=match[2],self=/\/\s*$/.test(tail);if(self)tail=tail.replace(/\/\s*$/,'');
  const attrs=Object.create(null);while(tail.trim()){
   const a=/^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(tail);need(a&&!Object.hasOwn(attrs,a[1]),'XLSX_XML_REVIEW');attrs[a[1]]=decodeXML(a[2]??a[3]);tail=tail.slice(a[0].length);
  }
  const ns={...(stack.at(-1)?.ns||{})};for(const [key,v]of Object.entries(attrs))if(key==='xmlns')ns['']=v;else if(key.startsWith('xmlns:'))ns[key.slice(6)]=v;
  const parts=name.split(':');need(parts.length<=2&&(!name.includes(':')||ns[parts[0]]),'XLSX_XML_REVIEW');
  const node={name,local:parts.at(-1),uri:ns[parts.length===2?parts[0]:'']||'',attrs,children:[],text:'',ns};
  if(stack.length)stack.at(-1).children.push(node);else roots.push(node);if(!self)stack.push(node);
  nodes++;need(nodes<=1200000&&stack.length<=32,'XLSX_SIZE_REVIEW');
 }
 need(stack.length===0&&roots.length===1,'XLSX_XML_REVIEW');return roots[0];
}
const children=(n,name)=>n.children.filter(x=>x.local===name&&x.uri===n.uri);
const one=(n,name)=>{const a=children(n,name);need(a.length===1,'XLSX_SCHEMA_REVIEW');return a[0];};
const all=n=>[n,...n.children.flatMap(all)];
export function readWorkbook(bytes){
 const zip=unzipWorkbook(bytes),xml=name=>{need(zip.has(name),'XLSX_SCHEMA_REVIEW');return readXML(zip.get(name));};
 const wb=xml('xl/workbook.xml');need(wb.local==='workbook'&&wb.uri===XMLNS,'XLSX_SCHEMA_REVIEW');
 const sheetList=one(wb,'sheets');need(sheetList.children.every(n=>n.uri===XMLNS&&n.local==='sheet'),'XLSX_SHEET_REVIEW');
 const sheets=children(sheetList,'sheet');need(sheets.length===1&&(!sheets[0].attrs.state||sheets[0].attrs.state==='visible'),'XLSX_SHEET_REVIEW');
 const refs=xml('xl/_rels/workbook.xml.rels');need(refs.local==='Relationships'&&refs.uri===RELNS,'XLSX_SCHEMA_REVIEW');
 for(const [name,b]of zip)if(name.endsWith('.rels')){const r=readXML(b);for(const rel of r.children)need(rel.attrs.TargetMode!=='External'&&!/^[a-z]+:/i.test(rel.attrs.Target||''),'XLSX_EXTERNAL_LINK_REVIEW');}
 const id=Object.entries(sheets[0].attrs).find(([key])=>key==='r:id')?.[1];need(id,'XLSX_SCHEMA_REVIEW');
 const ref=refs.children.filter(x=>x.attrs.Id===id&&x.attrs.Type?.endsWith('/worksheet'));need(ref.length===1,'XLSX_SCHEMA_REVIEW');
 const target=ref[0].attrs.Target;need(typeof target==='string'&&!target.startsWith('/')&&!target.includes('\\')&&!target.split('/').includes('..'),'XLSX_PATH_REVIEW');
 const sheetPath=path.posix.join('xl',target);need(/^xl\/worksheets\/[^/]+\.xml$/.test(sheetPath),'XLSX_PATH_REVIEW');
 const ws=xml(sheetPath);need(ws.local==='worksheet'&&ws.uri===XMLNS,'XLSX_SCHEMA_REVIEW');
 need(!all(ws).some(n=>['f','mergeCells','hyperlinks','extLst'].includes(n.local)),'XLSX_UNSUPPORTED_CONTENT_REVIEW');
 const ss=zip.has('xl/sharedStrings.xml')?xml('xl/sharedStrings.xml'):null;
 if(ss)need(ss.local==='sst'&&ss.uri===XMLNS,'XLSX_SCHEMA_REVIEW');
 const strings=ss?children(ss,'si').map(n=>{need(!all(n).some(x=>x.local==='rPh'),'XLSX_UNSUPPORTED_CONTENT_REVIEW');return all(n).filter(x=>x.local==='t').map(x=>x.text).join('');}):[];
 const styles=zip.has('xl/styles.xml')?xml('xl/styles.xml'):null;
 if(styles)need(styles.local==='styleSheet'&&styles.uri===XMLNS,'XLSX_SCHEMA_REVIEW');
 const formats=styles?new Map((children(styles,'numFmts')[0]?.children||[]).map(n=>[n.attrs.numFmtId,n.attrs.formatCode])):new Map();
 const xfs=styles?(children(styles,'cellXfs')[0]?.children||[]):[];
 const rows=[],cellRows=[];let lastRow=0;
 const data=one(ws,'sheetData');need(data.children.every(n=>n.uri===XMLNS&&n.local==='row'),'XLSX_ROW_REVIEW');
 for(const r of children(data,'row')){
  need(r.children.every(n=>n.uri===XMLNS&&n.local==='c'),'XLSX_CELL_REVIEW');
  const row=Number(r.attrs.r);need(Number.isSafeInteger(row)&&row>lastRow&&row<=50001,'XLSX_ROW_REVIEW');lastRow=row;
  need(!['1','true'].includes(r.attrs.hidden),'XLSX_HIDDEN_ROW_REVIEW');
  const vals=[],cells=[],seen=new Set();
  for(const c of children(r,'c')){
   need(c.children.every(n=>n.uri===XMLNS&&['v','is'].includes(n.local)),'XLSX_CELL_REVIEW');
   const m=/^([A-Z]{1,2})([1-9][0-9]*)$/.exec(c.attrs.r||'');need(m&&Number(m[2])===row&&!seen.has(c.attrs.r),'XLSX_CELL_REVIEW');seen.add(c.attrs.r);
   const col=[...m[1]].reduce((a,v)=>a*26+v.charCodeAt(0)-64,0)-1;need(col<64,'XLSX_SCHEMA_REVIEW');
   const vs=children(c,'v');need(vs.length<=1,'XLSX_CELL_REVIEW');const t=c.attrs.t||'n',raw=vs[0]?.text??null;let value=null;
   if(t==='inlineStr'){const it=one(c,'is');value=all(it).filter(x=>x.local==='t').map(x=>x.text).join('');}
   else if(raw!==null&&raw!==''){
    if(t==='s'){need(/^\d+$/.test(raw)&&Number(raw)<strings.length,'XLSX_CELL_REVIEW');value=strings[Number(raw)];}
    else if(t==='b'){need(raw==='0'||raw==='1','XLSX_CELL_REVIEW');value=raw==='1';}
    else if(t==='n'){need(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)&&Number.isFinite(Number(raw)),'XLSX_CELL_REVIEW');value=Number(raw);}
    else if(['str','d'].includes(t)){value=raw;}
    else throw new ExpediteError('XLSX_CELL_TYPE_REVIEW');
   }
   need(value===null||typeof value!=='string'||value.length<=8192,'XLSX_SIZE_REVIEW');
   const style=c.attrs.s===undefined?0:Number(c.attrs.s);need(Number.isSafeInteger(style)&&style>=0&&(!styles||style<xfs.length),'XLSX_CELL_REVIEW');
   vals[col]=value;cells[col]={type:t,raw:raw,style,numberFormat:formats.get(xfs[style]?.attrs.numFmtId)||null};
  }
  rows.push({row,values:vals});cellRows.push(cells);
 }
 need(rows.length>=1&&rows[0].row===1,'XLSX_SCHEMA_REVIEW');
 const dateFlag=children(wb,'workbookPr')[0]?.attrs.date1904;need(dateFlag===undefined||['1','0','true','false'].includes(dateFlag),'XLSX_DATE_SYSTEM_REVIEW');
 return {sheetName:sheets[0].attrs.name,dateSystem:['1','true'].includes(dateFlag)?'1904':'1900',rows,cellRows};
}
export function validateTable(book){
 const headers=book.rows[0].values;
 need(headers.length>0&&headers.every(h=>typeof h==='string'&&h.length<=128),'SCHEMA_HEADERS_REVIEW');
 need(new Set(headers).size===headers.length,'SCHEMA_DUPLICATE_HEADER_REVIEW');
 need(headers.includes('Shipment Id'),'SCHEMA_SHIPMENT_ID_REQUIRED');
 const missing=HEADERS.filter(h=>!headers.includes(h)),unexpected=headers.filter(h=>!HEADERS.includes(h));
 // Additional columns are OPTIONAL to the semantic record, but a changed schema needs
 // an explicit reviewed contract revision before a batch can become the latest boundary.
 need(!missing.length&&!unexpected.length,'SCHEMA_DRIFT_REVIEW');
 const ids=new Set(),records=[];
 for(let i=1;i<book.rows.length;i++){
  const {row,values}=book.rows[i];need(values.length<=headers.length,'SCHEMA_EXTRA_CELL_REVIEW');
  if(values.every(v=>v==null||v===''))continue;
  const fields=Object.fromEntries(headers.map((h,j)=>[h,values[j]??null]));const value=fields['Shipment Id'];let key;
  if(typeof value==='number'){need(Number.isSafeInteger(value)&&value>0,'SHIPMENT_ID_REVIEW');key=String(value);}
  else {need(typeof value==='string'&&!!value.trim()&&value.length<=128&&!/[\x00-\x1f\x7f]/.test(value),'SHIPMENT_ID_REQUIRED');key=value.trim();}
  need(!ids.has(key),'DUPLICATE_SHIPMENT_ID');ids.add(key);
  const c=fields.Critical;let critical=null;
  if(typeof c==='boolean')critical=c;
  else if(c===1||c===0)critical=c===1;
  else if(typeof c==='string'&&/^(true|false|yes|no|y|n|1|0)$/i.test(c.trim()))critical=/^(true|yes|y|1)$/i.test(c.trim());
  else need(c==null||c==='','CRITICAL_VALUE_REVIEW');
  for(const h of HEADERS.filter(h=>!['Critical','Shipment Id','ETA Next Stop'].includes(h)))need(fields[h]==null||typeof fields[h]==='string','FIELD_TYPE_REVIEW');
  need(fields['ETA Next Stop']==null||['number','string'].includes(typeof fields['ETA Next Stop']),'ETA_VALUE_REVIEW');
  records.push({source:SOURCE,shipmentId:key,critical,sourceRow:row,values:fields,cells:book.cellRows[i]});
 }
 return {contractVersion:1,source:SOURCE,dataset:'FREIGHT_ON_THE_MOVE',rowCount:records.length,observedHeaders:headers,sheetName:book.sheetName,dateSystem:book.dateSystem,etaTimezone:null,records};
}
export function validateWorkbook(bytes){return {...validateTable(readWorkbook(bytes)),xlsxSHA256:sha256(bytes),xlsxBytes:bytes.length};}
