import { calculateSheet, CellValue, columnLetters, columnNumber, SheetCell } from './coater-rpa-formulas';

const sheet = (cells: Record<string, CellValue | { f?: string; shared?: string }>) =>
  new Map<string, SheetCell>(Object.entries(cells).map(([key, cell]) => [key,
    cell !== null && typeof cell === 'object' ? { value: null, formula: cell.f, shared: cell.shared } : { value: cell }]));
const result = (cells: Record<string, CellValue | { f?: string; shared?: string }>, key: string) =>
  calculateSheet(sheet(cells), 46000).get(key);

describe('RPA form formulas', () => {
  it('converts column letters', () => {
    expect(columnNumber('A')).toBe(1);
    expect(columnNumber('Z')).toBe(26);
    expect(columnNumber('AA')).toBe(27);
    expect(columnLetters(27)).toBe('AA');
    expect(columnLetters(columnNumber('XFD'))).toBe('XFD');
  });

  it('follows operator precedence and references', () => {
    expect(result({ A1: 2, A2: 3, B1: { f: 'A1+A2*4-(A1-1)/2' } }, 'B1')).toBe(13.5);
    expect(result({ A1: 2, B1: { f: '-A1^2&"x"' } }, 'B1')).toBe('4x');
    expect(result({ B1: { f: 'A1+5' } }, 'B1')).toBe(5); // a blank counts as 0
    expect(result({ A1: 'P', B1: { f: 'A1="p"' } }, 'B1')).toBe(true);
    expect(result({ A1: 7, B1: { f: 'IF(A1>=7,"due","ok")' } }, 'B1')).toBe('due');
  });

  it('adds only numbers in a range and only the rows a SUMIF matches', () => {
    const cells = { T11: '1700-5000', V11: 95, W11: '1700-5001', Y11: 95, T12: '1700-5001 Evo', V12: 39, T13: '1700-5000', V13: 'text',
      A1: { f: 'SUM(V11:V39)' }, A2: { f: 'SUMIF($T$11:$U$39,"=1700-5000",$V$11:$V$39)+SUMIF($W$11:$X$39,"=1700-5000",$Y$11:$Y$39)' },
      A3: { f: 'SUMIF(T11:T39,"=1700-5001 evo",V11:V39)' }, A4: { f: 'SUMIF(V11:V12,">50")' } };
    expect(result(cells, 'A1')).toBe(134);
    expect(result(cells, 'A2')).toBe(95);
    expect(result(cells, 'A3')).toBe(39);
    expect(result(cells, 'A4')).toBe(95);
  });

  it('moves a shared formula with each cell that uses it', () => {
    const cells = { P11: 30526, Q11: 'G', P12: '1.955FC',
      B66: { f: 'IF(ISBLANK(P11),"",P11)', shared: '0' }, C66: { shared: '0' }, B67: { shared: '0' }, B68: { shared: '0' },
      D1: { f: '$P$11', shared: '1' }, D2: { shared: '1' } };
    const results = calculateSheet(sheet(cells), 46000);
    expect(results.get('B66')).toBe(30526);
    expect(results.get('C66')).toBe('G');
    expect(results.get('B67')).toBe('1.955FC');
    expect(results.get('B68')).toBe('');
    expect(results.get('D2')).toBe(30526); // an absolute reference does not move
  });

  it('works out the return date the form uses and the form number', () => {
    const next = 'IF(OR(P3/7=INT(P3/7),(P3+1)/7=INT((P3+1)/7)),P3+3,P3+2)';
    expect(result({ P3: 46294, P5: { f: next } }, 'P5')).toBe(46296);
    expect(result({ P3: 46298, P5: { f: next } }, 'P5')).toBe(46301); // a day whose serial divides by 7
    expect(result({ P2: 9748, H5: { f: '_xlfn.CONCAT("DN-85-",0,P2)' } }, 'H5')).toBe('DN-85-09748');
    expect(result({ K9: { f: 'TODAY()' } }, 'K9')).toBe(46000);
  });

  it('reports what it cannot calculate instead of guessing', () => {
    expect(result({ A1: { f: 'VLOOKUP(1,B1:C2,2)' } }, 'A1')).toBeUndefined();
    expect(result({ A1: { f: 'B1+1' }, B1: { f: 'VLOOKUP(1,C1:D2,2)' } }, 'A1')).toBeUndefined();
    expect(result({ A1: { f: 'A2' }, A2: { f: 'A1' } }, 'A1')).toBeUndefined();
    expect(result({ A1: 'abc', B1: { f: 'A1*2' } }, 'B1')).toBeUndefined();
    expect(result({ A1: { f: '1/0' } }, 'A1')).toBeUndefined();
    expect(result({ A1: { f: 'SUM(' } }, 'A1')).toBeUndefined();
  });
});
