import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCutterRequestDto, UpdateCutterRequestStatusDto } from './cutter-requests.dto';
import { CutterRequestsService } from './cutter-requests.service';

const summary = '11111111-1111-4111-8111-111111111111';
const partType = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';

describe('Cutter Requests server validation', () => {
  it('accepts cutter quantities only as integers 1–99 and normalizes the type code', async () => {
    const valid = plainToInstance(CreateCutterRequestDto, { summary_id: summary, part_type_code: ' ring ', quantity: 3, notes: 'Second shift' });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.part_type_code).toBe('RING');
    for (const quantity of [0,-1,1.5,100,'2',null]) {
      const dto = plainToInstance(CreateCutterRequestDto, { summary_id: summary, part_type_code: 'RING', quantity });
      expect((await validate(dto)).some(error => error.property === 'quantity')).toBe(true);
    }
  });
  it('rejects malformed identities, non-cutter part types, excessive notes and unknown statuses', async () => {
    const dto = plainToInstance(CreateCutterRequestDto, { summary_id: 'wrong', part_type_code: 'GEARSET', quantity: 1, notes: 'x'.repeat(2001) });
    expect((await validate(dto)).map(error => error.property).sort()).toEqual(['notes','part_type_code','summary_id']);
    expect(await validate(plainToInstance(UpdateCutterRequestStatusDto, {status:'CANCELLED'}))).not.toHaveLength(0);
    expect(await validate(plainToInstance(UpdateCutterRequestStatusDto, {status:'CANCELED'}))).toHaveLength(0);
  });
  it('rejects invalid quantities before opening a transaction', async () => {
    const transaction = jest.fn();
    const service = new CutterRequestsService({ transaction } as never);
    await expect(service.create({ summary_id: summary, part_type_code: 'RING', quantity: 0 }, 'actor')).rejects.toThrow('whole number');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('Cutter Requests transaction contracts', () => {
  it('merges into the oldest matching row without changing its requester/time or blanking notes', async () => {
    const old = {id,requested_quantity:3,remaining_quantity:2,requested_by:'first-requester',requested_at:'old-time',notes:'Keep this'};
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT pt.id AS part_type_id')) return [{part_type_id:partType}];
      if (sql.includes('SELECT * FROM public.cutter_requests')) return [old];
      if (sql.includes('AS built')) return [{built:1}];
      if (sql.includes('UPDATE public.cutter_requests')) return [{...old,requested_quantity:5,remaining_quantity:4,updated_by:params[3]}];
      return [];
    });
    const manager = {query,queryRunner:{isTransactionActive:true}};
    const transaction = jest.fn(async (_isolation: string, work: (m: typeof manager)=>Promise<unknown>) => work(manager));
    const service = new CutterRequestsService({transaction} as never);
    const result = await service.create({summary_id:summary,part_type_code:'RING',quantity:2,notes:'   '},'later-requester');
    expect(result).toMatchObject({requested_quantity:5,remaining_quantity:4,requested_by:'first-requester',requested_at:'old-time',notes:'Keep this'});
    const update = query.mock.calls.find(([sql])=>sql.includes('UPDATE public.cutter_requests'));
    expect(update?.[1]).toEqual([id,2,null,'later-requester']);
    const history = query.mock.calls.find(([sql])=>sql.includes('INSERT INTO public.cutter_request_history'));
    expect(history?.[1]).toEqual([expect.any(String),id,'QUANTITY_ADDED','later-requester',null,2]);
    expect(transaction).toHaveBeenCalledWith('READ COMMITTED',expect.any(Function));
  });
  it('allows historical API manual closure of a partial request and records it atomically', async () => {
    const before = {id,status:'IN_PROGRESS',requested_quantity:3,remaining_quantity:2,completed_at:null};
    const query = jest.fn(async (sql: string) => sql.startsWith('SELECT') ? [before] : sql.includes('UPDATE') ? [{...before,status:'COMPLETED'}] : []);
    const manager = {query};
    const transaction = jest.fn(async (_isolation: string,work:(m:typeof manager)=>Promise<unknown>)=>work(manager));
    const service = new CutterRequestsService({transaction} as never);
    expect(await service.updateStatus(id,'COMPLETED','actor')).toMatchObject({remaining_quantity:2,completed_at:null,status:'COMPLETED'});
    expect(query.mock.calls.some(([sql])=>sql.includes('cutter_request_history'))).toBe(true);
    expect(query.mock.calls.some(([sql])=>sql.includes('cutter_builds') || sql.includes('blade_tray'))).toBe(false);
  });
  it('refuses to reopen either terminal state and writes no status/history', async () => {
    for (const status of ['COMPLETED','CANCELED']) {
      const query = jest.fn().mockResolvedValue([{id,status}]);
      const service = new CutterRequestsService({transaction:async (_isolation:unknown,work:(m:unknown)=>Promise<unknown>)=>work({query})} as never);
      await expect(service.updateStatus(id,'REQUESTED','actor')).rejects.toThrow('cannot be reopened');
      expect(query).toHaveBeenCalledTimes(1);
    }
  });
});
