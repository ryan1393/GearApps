import { CoaterManifest } from '@meshforge/manufacturing/shared/util-types';
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';
import { DataSource, EntityManager } from 'typeorm';
import { ServerUtilMailerService } from '@meshforge/manufacturing/server/util-mailer';
import { CoaterRpaService } from './coater-rpa.service';

function setup(emailStatus: string) {
  const request = { id: 'request', number: 1001, po: 'TEST-PO', document: Buffer.from('workbook'),
    recipients_to: ['coater@example.invalid'], recipients_cc: [], email_status: emailStatus };
  const transactionQuery = jest.fn().mockResolvedValueOnce([request]).mockResolvedValue([]);
  const update = jest.fn().mockResolvedValue([]);
  const source = {
    transaction: (work: (manager: EntityManager) => unknown) => work({query: transactionQuery} as unknown as EntityManager),
    query: update,
  } as unknown as DataSource;
  const sendAttachment = jest.fn();
  const mailer = {enabled: true, sendAttachment} as unknown as ServerUtilMailerService;
  return {service: new CoaterRpaService(source,mailer), transactionQuery, update, sendAttachment};
}

describe('Coater RPA email', () => {
  it('claims a failed request, sends its saved workbook, and records SMTP acceptance', async () => {
    const {service,transactionQuery,update,sendAttachment} = setup('FAILED');
    sendAttachment.mockResolvedValue({accepted:['coater@example.invalid'], rejected:[]});
    await service.email('shipment',2);
    expect(transactionQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("email_status='SENDING'"), ['request']);
    expect(sendAttachment).toHaveBeenCalledWith(expect.objectContaining({attachments:[{
      filename:'RPA-1001.xlsx', content:Buffer.from('workbook'),
    }]}));
    expect(update).toHaveBeenCalledWith(expect.any(String), ['request','SENT',null]);
  });

  it('leaves uncertain delivery for review', async () => {
    const {service,update,sendAttachment} = setup('PENDING');
    sendAttachment.mockResolvedValue({accepted:['one@example.invalid'], rejected:['two@example.invalid']});
    await service.email('shipment',2);
    expect(update).toHaveBeenCalledWith(expect.any(String), ['request','UNKNOWN',expect.any(String)]);
  });

  it('does not send an already accepted request again', async () => {
    const {service,sendAttachment,update} = setup('SENT');
    await service.email('shipment',2);
    expect(sendAttachment).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});


describe('Coater RPA tray quantities', () => {
  const template = Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>
    <row r="2"><c r="P2"/><c r="R2"/></row><row r="3"><c r="P3"/><c r="S3"/></row>
    <row r="5"><c r="H5"/></row><row r="8"><c r="K8"/></row><row r="9"><c r="K9"/></row>
    <row r="11"><c r="P11"/></row><row r="32"><c r="B32" t="inlineStr"><is><t>PART-OUTER</t></is></c></row>
    <row r="35"><c r="B35" t="inlineStr"><is><t>PART-INNER</t></is></c></row><row r="50"><c r="I50"/></row>
    </sheetData></worksheet>`) }));

  it.each([11, 13, 17, 19])('records %i inner and outer blades per tray without halving matched sets', async count => {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT number,po')) return [];
      if (sql.includes('FROM dana_rpa_settings_v1')) return [{ next_number: 1001, today: '2026-11-10', unit_price: 1, insurance_unit: 1, recipients_to: [], recipients_cc: [], coater_display_name: 'Test Coater' }];
      if (sql.startsWith('SELECT document')) return [{ document: template }];
      if (sql.includes('SELECT GREATEST')) return [{ number: 1001 }];
      if (sql.includes('FROM dana_rpa_part_map_v1')) return [{ summary: 'TEST', part_type: 'RING', outer_part: 'PART-OUTER', inner_part: 'PART-INNER' }];
      return [];
    });
    const manager = { query } as unknown as EntityManager;
    const manifest = { containers: [{ trays: [
      { serial: 'T0001', summary: 'TEST', part_type: 'RING', count },
      { serial: 'T0002', summary: 'TEST', part_type: 'RING', count },
    ] }] } as unknown as CoaterManifest;
    const service = new CoaterRpaService({} as DataSource, {} as ServerUtilMailerService);
    await service.prepare(manager, { id: 'shipment', revision: 1, manifest }, 'PO-TEST', 'operator');
    const insert = query.mock.calls.find(call => call[0].startsWith('INSERT INTO dana_rpa_requests_v1'));
    expect(insert).toBeDefined();
    const params = (insert as unknown as [string, unknown[]])[1];
    expect(JSON.parse(params[6] as string)).toEqual([{ summary: 'TEST', part_type: 'RING', trays: 2, per_side: count, outer_part: 'PART-OUTER', inner_part: 'PART-INNER' }]);
    const xml = strFromU8(unzipSync(params[5] as Buffer)['xl/worksheets/sheet1.xml']);
    expect(xml).toContain(`<c r="V11"><v>${count * 2}</v></c>`);
    expect(xml).toContain(`<c r="Y11"><v>${count * 2}</v></c>`);
  });
});
