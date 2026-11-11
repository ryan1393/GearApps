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
