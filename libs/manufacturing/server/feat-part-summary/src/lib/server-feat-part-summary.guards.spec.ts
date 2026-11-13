import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PartSummaryOrmEntity } from '@meshforge/manufacturing/server/data-access';

import { ServerFeatPartSummaryService } from './server-feat-part-summary.service';

const ID = '11111111-1111-4111-8111-111111111111';
const USER = '99999999-9999-4999-8999-999999999999';

interface Fixture {
  summary?: { id: string; number: string; revision: string } | null;
  duplicate?: boolean;
  usage?: { trays: number; blades: number; requirements: number };
}

function setup({ summary = { id: ID, number: '1.955FC', revision: '' }, duplicate = false, usage = { trays: 0, blades: 0, requirements: 0 } }: Fixture = {}) {
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]]>(async (sql) => {
    if (/FROM public\.part_summaries WHERE id=\$1/.test(sql)) return summary ? [summary] : [];
    if (/pg_advisory_xact_lock/.test(sql)) return [];
    if (/number=\$1 AND revision=\$2/.test(sql)) return duplicate ? [{ id: 'other' }] : [];
    if (/AS trays/.test(sql)) return [usage];
    throw new Error(`Unexpected query ${sql}`);
  });
  const entity = { id: ID };
  const repo = {
    save: jest.fn(async (row: unknown) => row),
    findOneOrFail: jest.fn(async () => entity),
    softRemove: jest.fn(async () => entity),
  };
  const manager = {
    query,
    getRepository: (target: unknown) => {
      if (target !== PartSummaryOrmEntity) throw new Error('Unexpected repository');
      return repo;
    },
  };
  const service = new ServerFeatPartSummaryService({
    manager: { transaction: (work: (m: unknown) => unknown) => work(manager) },
  } as never);
  return { service, query, repo };
}

describe('Part Summary guards', () => {
  it('answers 404 for an unknown id instead of inserting it', async () => {
    const { service, repo } = setup({ summary: null });
    await expect(service.updatePartSummary(ID as never, { hos: 'LH' }, USER as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('locks the Summary and its requirements, then saves the change', async () => {
    const { service, query, repo } = setup();
    await service.updatePartSummary(ID as never, { number: ' 1.955FC ', hos: 'LH' }, USER as never);
    expect(query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    expect(query.mock.calls[1][0]).toMatch(/pg_advisory_xact_lock\(hashtext\('cutter-summary-requirement:'/);
    expect(query.mock.calls[2][1]).toEqual(['1.955FC', '', ID]);
    expect(repo.save).toHaveBeenCalledWith({ id: ID, number: '1.955FC', hos: 'LH', updatedBy: USER });
  });

  it('refuses a number and revision another Summary already has', async () => {
    const { service, repo } = setup({ duplicate: true });
    await expect(service.updatePartSummary(ID as never, { revision: 'B' }, USER as never)).rejects.toThrow(
      'Part Summary 1.955FC revision B already exists',
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses a blank number', async () => {
    const { service } = setup();
    await expect(service.updatePartSummary(ID as never, { number: '  ' }, USER as never)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('refuses deleting a Summary that trays, blades or requirements still use', async () => {
    const { service, repo } = setup({ usage: { trays: 1, blades: 4, requirements: 2 } });
    const error = await service.deletePartSummary(ID as never, USER as never).catch((thrown) => thrown);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(
      'This Part Summary is still used by 1 tray(s), 4 blade(s) and 2 blade requirement(s). Disable it instead.',
    );
    expect(repo.softRemove).not.toHaveBeenCalled();
  });

  it('soft-deletes an unused Summary', async () => {
    const { service, repo } = setup();
    await service.deletePartSummary(ID as never, USER as never);
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ updatedBy: USER }));
    expect(repo.softRemove).toHaveBeenCalled();
  });

  it('keeps answering 422 for deleting an unknown Summary', async () => {
    const { service } = setup({ summary: null });
    await expect(service.deletePartSummary(ID as never, USER as never)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
