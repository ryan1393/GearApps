import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { fillRpaWorkbook, inspectRpaWorkbook } from './coater-rpa-workbook';

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

  describe('a form saved by Excel', () => {
    // Excel stores repeated text in a shared table, keeps the last result of every formula
    // and lists formula cells in a calculation chain.
    const excel = Buffer.from(zipSync({
      '[Content_Types].xml': strToU8('<Types><Override PartName="/xl/workbook.xml" ContentType="w"/><Override PartName="/xl/calcChain.xml" ContentType="c"/></Types>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="sheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Type="calcChain" Target="calcChain.xml"/></Relationships>'),
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="RPA Sheet" sheetId="1"/></sheets><calcPr calcId="191029"/></workbook>'),
      'xl/calcChain.xml': strToU8('<calcChain><c r="H5"/><c r="K8"/><c r="K9"/><c r="V2"/></calcChain>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>PART-A</t></si><si><t>PART-B</t></si><si><r><t>Old </t></r><r><t>text</t></r></si></sst>'),
      [sheet]: strToU8(`<worksheet><sheetData>
        <row r="2"><c r="P2"><v>11</v></c><c r="R2"><v>555</v></c><c r="V2"><f>SUMIF($T$11:$U$39,"=PART-A",$V$11:$V$39)+SUMIF($W$11:$X$39,"=PART-A",$Y$11:$Y$39)</f><v>999</v></c></row>
        <row r="3"><c r="P3"><v>46000</v></c><c r="S3"><v>1</v></c><c r="V3"><f>SUMIF($T$11:$U$39,"=PART-A Evo",$V$11:$V$39)+SUMIF($W$11:$X$39,"=PART-A Evo",$Y$11:$Y$39)</f><v>999</v></c></row>
        <row r="4"><c r="V4"><f>SUMIF($T$11:$U$39,"=PART-B",$V$11:$V$39)+SUMIF($W$11:$X$39,"=PART-B",$Y$11:$Y$39)</f><v>999</v></c></row>
        <row r="5"><c r="H5" t="str"><f>_xlfn.CONCAT("DN-85-",0,P2)</f><v>DN-85-011</v></c><c r="P5"><f>IF(OR(P3/7=INT(P3/7),(P3+1)/7=INT((P3+1)/7)),P3+3,P3+2)</f><v>1</v></c></row>
        <row r="8"><c r="K8" t="str"><f>H5</f><v>DN-85-011</v></c></row>
        <row r="9"><c r="K9"><f ca="1">TODAY()</f><v>46000</v></c></row>
        <row r="11"><c r="P11"><v>30526</v></c><c r="T11" t="s"><v>2</v></c></row>
        <row r="12"><c r="P12"/></row>
        <row r="32"><c r="B32" t="s"><v>0</v></c><c r="H32"><f>V2</f><v>999</v></c><c r="I32"><f>S3</f><v>1</v></c><c r="J32"><f>H32*I32</f><v>999</v></c></row>
        <row r="35"><c r="B35" t="s"><v>1</v></c><c r="H35"><f>V4</f><v>999</v></c><c r="J35"><f t="shared" ref="J35" si="0">H35*I32</f><v>999</v></c></row>
        <row r="44"><c r="B44" t="s"><v>0</v></c><c r="H44"><f>V3</f><v>999</v></c></row>
        <row r="50"><c r="H50"><f>SUM(H32:H49)</f><v>999</v></c><c r="I50"><v>50</v></c><c r="J50"><f>H50*I50</f><v>999</v></c><c r="K50"><f>VLOOKUP(P2,A1:B2,2)</f><v>999</v></c></row>
        <row r="66"><c r="B66"><f t="shared" ref="B66:B67" si="1">IF(ISBLANK(P11),"",P11)</f><v>30526</v></c><c r="D66"><f t="shared" ref="D66:D67" si="2">IF(ISBLANK(R11),"",R11)</f><v>9</v></c></row>
        <row r="67"><c r="B67" t="str"><f t="shared" si="1"/><v>stale</v></c><c r="D67" t="str"><f t="shared" si="2"/><v></v></c></row>
        <row r="97"><c r="D97"><f>SUM(D66:D96)</f><v>999</v></c></row>
      </sheetData></worksheet>`),
    }));
    const lines = [
      { summary: '30526', part_type: 'RING', trays: 2, per_side: 13, outer_part: 'PART-A', inner_part: 'PART-B' },
      { summary: '31241', part_type: 'PINION', trays: 3, per_side: 11, outer_part: 'PART-A Evo', inner_part: 'PART-A Evo' },
    ];
    const filled = () => unzipSync(fillRpaWorkbook(excel, { ...request, unitPrice: 2.5, insuranceUnit: 10, lines }));
    const cell = (xml: string, address: string) => new RegExp(`<c r="${address}"[^>]*>.*?</c>`).exec(xml)?.[0];

    it('reads part numbers stored as shared text and accepts a variant named by a total formula', () => {
      expect(() => filled()).not.toThrow();
      expect(() => fillRpaWorkbook(excel, { ...request, lines: [{ ...lines[0], outer_part: 'PART-Z' }] }))
        .toThrow('The RPA form has no part line');
    });

    it('recalculates every total from the new lines instead of keeping the previous request', () => {
      const xml = strFromU8(filled()[sheet]);
      expect(xml).not.toContain('<v>999</v>');
      expect(cell(xml, 'V2')).toContain('<v>26</v>');   // 2 trays x 13 of PART-A (outer)
      expect(cell(xml, 'V3')).toContain('<v>66</v>');   // 3 x 11 Evo, outer and inner
      expect(cell(xml, 'V4')).toContain('<v>26</v>');   // PART-B (inner)
      expect(cell(xml, 'J32')).toContain('<v>65</v>');  // 26 x 2.50
      expect(cell(xml, 'J35')).toContain('<v>65</v>');
      expect(cell(xml, 'H50')).toContain('<v>118</v>'); // 26 + 26 + 66
      expect(cell(xml, 'J50')).toContain('<v>1180</v>');
      expect(cell(xml, 'P5')).toContain('<v>46025</v>'); // 2026-01-01 is a Thursday: two days later
      expect(cell(xml, 'B67')).toBe('<c r="B67" t="str"><f t="shared" si="1"/><v>31241</v></c>');
      expect(cell(xml, 'D97')).toContain('<v>5</v>');   // boxes: 2 + 3 trays
    });

    it('leaves a formula it cannot calculate for Excel, without a stale result', () => {
      expect(cell(strFromU8(filled()[sheet]), 'K50')).toBe('<c r="K50"><f>VLOOKUP(P2,A1:B2,2)</f></c>');
    });

    it('removes the calculation chain and asks Excel to recalculate on opening', () => {
      const workbook = filled();
      expect(workbook['xl/calcChain.xml']).toBeUndefined();
      expect(strFromU8(workbook['xl/_rels/workbook.xml.rels'])).not.toContain('calcChain');
      expect(strFromU8(workbook['[Content_Types].xml'])).not.toContain('calcChain');
      expect(strFromU8(workbook['xl/workbook.xml'])).toContain('<calcPr calcId="191029" fullCalcOnLoad="1"/>');
      expect(strFromU8(workbook[sheet])).toContain('<c r="K8" t="inlineStr"><is><t xml:space="preserve">DN-85-01001</t></is></c>');
    });
  });

  describe('inspectRpaWorkbook', () => {
    /** A complete form: every input cell, order rows 11 to 39, two part lines and one saved order line. */
    const form = (options: { without?: string; extra?: Record<string, Uint8Array> } = {}) => {
      const rows: Record<number, string> = {
        2: '<c r="P2"><v>9748</v></c><c r="R2"><v>7100163446</v></c>',
        3: '<c r="P3"><v>46294</v></c><c r="S3"><v>5.89</v></c><c r="V3"><f>SUMIF($T$11:$U$39,"=PART-A Evo",$V$11:$V$39)</f><v>0</v></c>',
        5: '<c r="H5" t="str"><f>_xlfn.CONCAT("DN-85-",0,P2)</f><v>DN-85-09748</v></c>',
        7: '<c r="C7" t="s"><v>2</v></c>',
        8: '<c r="K8" t="str"><f>H5</f><v>DN-85-09748</v></c>',
        9: '<c r="K9"><f>TODAY()</f><v>46302</v></c>',
        11: '<c r="P11"><v>30526</v></c><c r="Q11" t="inlineStr"><is><t>G</t></is></c><c r="T11" t="s"><v>0</v></c><c r="W11" t="s"><v>1</v></c>',
        32: '<c r="B32" t="s"><v>0</v></c>', 35: '<c r="B35" t="s"><v>1</v></c>',
        50: '<c r="I50"><v>50</v></c>',
      };
      for (let row = 12; row <= 39; row++) rows[row] ??= `<c r="P${row}"/>`;
      const xml = Object.entries(rows).map(([row, content]) => `<row r="${row}">${content}</row>`).join('')
        .replace(options.without ? new RegExp(`<c r="${options.without}"[^>]*?(?:/>|>.*?</c>)`) : /$^/, '');
      return Buffer.from(zipSync({
        [sheet]: strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`),
        'xl/sharedStrings.xml': strToU8('<sst><si><t>PART-A</t></si><si><t>PART-B</t></si><si><t>Example Coating, Inc.</t></si></sst>'),
        ...options.extra,
      }));
    };

    it('reads the starting values, part names and order lines of a usable form', () => {
      expect(inspectRpaWorkbook(form())).toEqual({
        number: 9748, po: '7100163446', unit_price: 5.89, insurance_unit: 50, coater_name: 'Example Coating, Inc.',
        parts: ['PART-A', 'PART-A Evo', 'PART-B'],
        lines: [{ summary: '30526', part_type: 'RING', outer_part: 'PART-A', inner_part: 'PART-B' }],
      });
    });

    it('explains why a file is not a usable form', () => {
      expect(() => inspectRpaWorkbook(Buffer.from('not a workbook'))).toThrow('not an Excel workbook');
      expect(() => inspectRpaWorkbook(Buffer.from(zipSync({ 'xl/worksheets/sheet2.xml': strToU8('<worksheet/>') })))).toThrow('no first worksheet');
      expect(() => inspectRpaWorkbook(form({ without: 'S3' }))).toThrow('cell S3 is missing');
      expect(() => inspectRpaWorkbook(form({ without: 'B32' }).subarray(0))).not.toThrow(); // one part line is enough
      expect(() => inspectRpaWorkbook(form({ extra: { 'xl/vbaProject.bin': strToU8('macro') } }))).toThrow('macros are not accepted');
    });

    it('refuses a form without all 29 order rows', () => {
      const short = Buffer.from(zipSync({ [sheet]: strToU8(strFromU8(unzipSync(form())[sheet]).replace(/<row r="39">.*?<\/row>/, '')) ,
        'xl/sharedStrings.xml': unzipSync(form())['xl/sharedStrings.xml'] }));
      expect(() => inspectRpaWorkbook(short)).toThrow('order rows 11 to 39 are missing');
    });
  });
});
