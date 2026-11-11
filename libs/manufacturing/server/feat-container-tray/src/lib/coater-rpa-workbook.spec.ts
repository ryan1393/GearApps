import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { fillRpaWorkbook } from './coater-rpa-workbook';

const sheet = 'xl/worksheets/sheet1.xml';
const template = Buffer.from(zipSync({
  [sheet]: strToU8(`<worksheet><sheetData>
    <row r="2"><c r="P2"><v>11</v></c><c r="R2" s="75" t="inlineStr"><is><t>Old PO</t></is></c></row>
    <row r="3"><c r="P3"/><c r="S3"/><c r="V3"><f>SUM(V11:V39)</f><v/></c></row>
    <row r="5"><c r="H5"/></row><row r="8"><c r="K8"/></row><row r="9"><c r="K9"/></row>
    <row r="11"><c r="P11" s="18" t="inlineStr"><is><t>Old summary</t></is></c></row>
    <row r="12"><c r="P12" t="inlineStr"><is><t>Old additional group</t></is></c><c r="V12"><v>17</v></c></row>
    <row r="32"><c r="B32" t="inlineStr"><is><t>PART-1</t></is></c></row>
    <row r="50"><c r="I50"/></row>
  </sheetData></worksheet>`),
  'xl/styles.xml': strToU8('<styles/>'),
}));

const request = {
  number: 1001, po: '=A1 & <Test>', date: '2026-01-01', unitPrice: 1.25, insuranceUnit: 10,
  lines: [{ summary: 'New summary', part_type: 'RING', trays: 2, per_side: 13,
    outer_part: 'PART-1', inner_part: 'PART-1' }],
};

describe('fillRpaWorkbook', () => {
  it('replaces saved values, retains formulas and formatting, and writes the PO as text', () => {
    const workbook = unzipSync(fillRpaWorkbook(template,request));
    const xml = strFromU8(workbook[sheet]);
    expect(xml).toContain('<c r="P2"><v>1001</v></c>');
    expect(xml).toContain('<c r="R2" s="75" t="inlineStr"><is><t xml:space="preserve">=A1 &amp; &lt;Test&gt;</t>');
    expect(xml).toContain('<c r="V11"><v>26</v></c>');
    expect(xml).toContain('<c r="Y11"><v>26</v></c>');
    expect(xml).toContain('<f>SUM(V11:V39)</f>');
    expect(xml).not.toContain('Old');
    expect(xml).not.toContain('<v>17</v>');
    expect(strFromU8(workbook['xl/styles.xml'])).toBe('<styles/>');
  });

  it('rejects a missing part line before issuing a workbook', () => {
    expect(() => fillRpaWorkbook(template,{...request,lines:[{...request.lines[0],inner_part:'OTHER'}]}))
      .toThrow('The RPA form has no part line');
  });
});
