import { strToU8, zipSync } from 'fflate';
import { DataSource } from 'typeorm';
import { ServerUtilMailerService } from '@meshforge/manufacturing/server/util-mailer';
import { CoaterRpaAdminService } from './coater-rpa-admin.service';

function workbook(): Buffer {
  const rows: Record<number, string> = {
    2: '<c r="P2"><v>9748</v></c><c r="R2"><v>555</v></c>', 3: '<c r="P3"><v>46294</v></c><c r="S3"><v>5.89</v></c>',
    5: '<c r="H5"/>', 8: '<c r="K8"/>', 9: '<c r="K9"/>',
    32: '<c r="B32" t="inlineStr"><is><t>PART-A</t></is></c>', 35: '<c r="B35" t="inlineStr"><is><t>PART-B</t></is></c>',
    50: '<c r="I50"><v>50</v></c>',
  };
  for (let row = 11; row <= 39; row++) rows[row] ??= `<c r="P${row}"/>`;
  const xml = Object.entries(rows).map(([row, content]) => `<row r="${row}">${content}</row>`).join('');
  return Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`) }));
}

interface Stored { settings?: Record<string, unknown>; form?: Buffer; lastNumber?: number | null; map?: unknown[] }

function setup(stored: Stored = {}) {
  const writes: Array<{ sql: string; parameters: unknown[] }> = [];
  const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
    if (/^\s*(INSERT|DELETE|UPDATE)/.test(sql)) { writes.push({ sql, parameters }); return []; }
    if (sql.includes('MAX(number)')) return [{ last_number: stored.lastNumber ?? null }];
    if (sql.includes('FROM dana_rpa_settings_v1')) return stored.settings ? [stored.settings] : [];
    if (sql.includes('dana_rpa_template_v1')) {
      return stored.form ? [{ document: stored.form, file_name: 'form.xlsx', uploaded_at: new Date('2026-11-11T12:00:00Z'), source: 'UPLOADED' }] : [];
    }
    if (sql.includes('FROM dana_rpa_part_map_v1')) return stored.map ?? [];
    return [];
  });
  const source = { query, transaction: (work: (manager: { query: typeof query }) => unknown) => work({ query }) } as unknown as DataSource;
  const service = new CoaterRpaAdminService(source, { enabled: false } as ServerUtilMailerService);
  return { service, writes };
}

const settings = {
  coater_display_name: ' Example Coating ', next_number: 9749, unit_price: 5.89, insurance_unit: 50,
  recipients_to: ['Orders@Example.invalid', 'orders@example.invalid'], recipients_cc: [],
  default_po: null, default_po_expires_on: null, default_po_enabled: false,
};

describe('Coater RPA admin setup', () => {
  it('reports what is still missing before requests can be prepared', async () => {
    expect(await setup().service.setup()).toMatchObject({ settings: null, form: null, part_map: [], ready: false, email_enabled: false });
    const ready = await setup({ form: workbook(), map: [{ summary: 'S1', part_type: 'RING', outer_part: 'PART-A', inner_part: 'PART-B' }],
      settings: { ...settings, unit_price: '5.89', insurance_unit: '50.00', updated_at: '2026-11-11T12:00:00Z' } }).service.setup();
    expect(ready.ready).toBe(true);
    expect(ready.settings).toMatchObject({ unit_price: 5.89, insurance_unit: 50 });
    expect(ready.form).toMatchObject({ source: 'UPLOADED', problem: null, found: { number: 9748, parts: ['PART-A', 'PART-B'] } });
  });

  it('saves settings with tidy recipients', async () => {
    const { service, writes } = setup();
    await service.saveSettings(settings, 'admin-id');
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain('INSERT INTO dana_rpa_settings_v1');
    expect(writes[0].parameters).toEqual(['Example Coating', 9749, 5.89, 50, ['orders@example.invalid'], [], null, null, false, 'admin-id']);
  });

  it('refuses a default PO without an expiry and a number that was already issued', async () => {
    await expect(setup().service.saveSettings({ ...settings, default_po: 'PO-1', default_po_enabled: true }, 'admin-id'))
      .rejects.toThrow('A default PO needs the PO and the date it expires.');
    const issued = setup({ lastNumber: 9749 });
    await expect(issued.service.saveSettings(settings, 'admin-id')).rejects.toThrow('RPA 9749 has already been issued');
    expect(issued.writes).toHaveLength(0);
  });

  it('checks an uploaded form before saving it', async () => {
    const bad = setup();
    await expect(bad.service.uploadForm(undefined, 'admin-id')).rejects.toThrow('Choose the RPA Excel form');
    await expect(bad.service.uploadForm({ buffer: Buffer.from('plain text'), originalname: 'notes.xlsx' }, 'admin-id'))
      .rejects.toThrow('not an Excel workbook');
    await expect(bad.service.uploadForm({ buffer: Buffer.alloc(2 * 1024 * 1024 + 1), originalname: 'big.xlsx' }, 'admin-id'))
      .rejects.toThrow('larger than 2 MB');
    expect(bad.writes).toHaveLength(0);

    const good = setup();
    const file = workbook();
    await good.service.uploadForm({ buffer: file, originalname: 'C:\\forms\\RPA "form".xlsx' }, 'admin-id');
    expect(good.writes[0].sql).toContain('INSERT INTO dana_rpa_template_v1');
    expect(good.writes[0].parameters).toEqual([file, 'RPA form.xlsx', 'admin-id']);
  });

  it('only maps a Summary to part names the form can total', async () => {
    const { service, writes } = setup({ form: workbook() });
    await expect(service.saveMapping({ summary: '31241', part_type: 'RING', outer_part: 'PART-A', inner_part: 'PART-Z' }))
      .rejects.toThrow('The RPA form has no part named PART-Z.');
    expect(writes).toHaveLength(0);
    await service.saveMapping({ summary: ' s060586 ', part_type: 'PINION', outer_part: 'PART-A', inner_part: 'PART-B' });
    expect(writes.map(write => write.parameters)).toEqual([['S060586', 'PINION'], ['S060586', 'PINION', 'PART-A', 'PART-B']]);
  });
});
