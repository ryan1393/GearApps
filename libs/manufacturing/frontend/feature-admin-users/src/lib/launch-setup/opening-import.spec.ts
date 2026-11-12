import { OPENING_IMPORT_HEADER, parseOpeningImport } from './opening-import';

describe('opening inventory CSV', () => {
  const row = 't0001,1010,RING,READY_FOR_COATING,cgrr-a1a,0';
  it('accepts template rows and normalizes scanned barcodes', () => {
    expect(parseOpeningImport('\uFEFF' + OPENING_IMPORT_HEADER + '\r\n' + row)[0]).toMatchObject({ tray: 'T0001', shelf: 'CGRR-A1A', error: '', service_cycle: 0 });
  });
  it('marks every duplicate, including case differences', () => {
    const rows = parseOpeningImport(`${OPENING_IMPORT_HEADER}\n${row}\n${row.toUpperCase()}`);
    expect(rows.every(value => value.error.includes('Duplicate'))).toBe(true);
  });
  it('rejects malformed, fractional, negative and missing cycle counts', () => {
    for (const cycle of ['1.5', '-1', '', '100', 'NaN']) {
      expect(parseOpeningImport(OPENING_IMPORT_HEADER + '\n' + row.replace(/,0$/, ',' + cycle))[0].error).toContain('Service cycle');
    }
    expect(() => parseOpeningImport('part,quantity\nA,1')).toThrow('header');
    expect(() => parseOpeningImport(OPENING_IMPORT_HEADER)).toThrow('1 to 100');
  });
});
