import { EntityManager } from 'typeorm';
import {
  allocateCutterRequest,
  lockCutterRequestScope,
  reverseCutterRequestAllocation,
} from './cutter-request-allocation';

const input = { buildId: 'build-1', summaryId: 'summary-1', partTypeId: 'ring-1' };
const completedBuild = {
  id: input.buildId,
  summary_id: input.summaryId,
  part_type_id: input.partTypeId,
  built_at: new Date('2026-11-12T12:00:00Z'),
  deletedAt: null,
  status_code: 'READY',
  has_build_event: true,
};
const voidedBuild = {
  id: input.buildId,
  summary_id: input.summaryId,
  part_type_id: input.partTypeId,
  deletedAt: new Date(),
};
const allocation = {
  build_id: input.buildId,
  request_id: 'request-1',
  reversed_at: null,
  legacy_conflict: false,
};

function fixture(responses: unknown[][], active = true) {
  const query = jest.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  const manager = {
    queryRunner: { isTransactionActive: active },
    query,
  } as unknown as EntityManager;
  return { manager, query };
}

describe('completed cutter request allocation', () => {
  it('uses one scope lock identity for differently cased UUID input', async () => {
    const { manager, query } = fixture([[], []]);
    const summaryId = 'E998ECDD-5F42-4C79-96DE-0EE387B99AC4';
    const partTypeId = 'EAB9CFC5-717D-4F5F-93CE-2C2CA8979C81';
    await lockCutterRequestScope(manager, summaryId, partTypeId);
    await lockCutterRequestScope(manager, summaryId.toLowerCase(), partTypeId.toLowerCase());
    expect(query.mock.calls[0]).toEqual(query.mock.calls[1]);
  });

  it('requires the existing cutter transaction for both allocation and reversal', async () => {
    const { manager, query } = fixture([], false);
    await expect(allocateCutterRequest(manager, input, 'operator')).rejects.toThrow(
      'workflow transaction',
    );
    await expect(
      reverseCutterRequestAllocation(manager, input.buildId, 'operator', 'void'),
    ).rejects.toThrow('workflow transaction');
    expect(query).not.toHaveBeenCalled();
  });

  it('records one request unit and its build evidence independently of blade count', async () => {
    const { manager, query } = fixture([
      [completedBuild],
      [],
      [],
      [],
      [{ id: 'request-1' }],
      [{ build_id: input.buildId }],
      [{ id: 'request-1' }],
      [],
    ]);
    await expect(allocateCutterRequest(manager, input, 'operator')).resolves.toEqual({
      requestId: 'request-1',
      buildId: input.buildId,
    });
    const selection = query.mock.calls.find(([sql]) => sql.includes('ORDER BY r.requested_at'));
    expect(selection?.[1]).toEqual([input.summaryId, input.partTypeId]);
    const history = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.cutter_request_history'),
    );
    expect(history?.[0]).toContain("'AUTO_FULFILLED'");
    expect(history?.[0]).toContain('-1');
    expect(history?.[1]).toEqual([
      expect.any(String),
      'request-1',
      input.buildId,
      'operator',
      expect.any(String),
    ]);
    const update = query.mock.calls.find(([sql]) => sql.includes('UPDATE public.cutter_requests'));
    expect(update?.[0]).toMatch(/^WITH changed AS/);
    expect(update?.[0]).toContain('SELECT id FROM changed');
  });

  it('treats uppercase UUID input as the same Summary and Part Type identity', async () => {
    const { manager, query } = fixture([
      [completedBuild],
      [],
      [],
      [],
      [{ id: 'request-1' }],
      [{ build_id: input.buildId }],
      [{ id: 'request-1' }],
      [],
    ]);
    await expect(
      allocateCutterRequest(
        manager,
        {
          ...input,
          summaryId: input.summaryId.toUpperCase(),
          partTypeId: input.partTypeId.toUpperCase(),
        },
        'operator',
      ),
    ).resolves.toEqual({ requestId: 'request-1', buildId: input.buildId });
    const selection = query.mock.calls.find(([sql]) => sql.includes('ORDER BY r.requested_at'));
    expect(selection?.[1]).toEqual([input.summaryId, input.partTypeId]);
  });

  it('does not fulfill a different Summary, different Part Type, or incomplete build', async () => {
    for (const change of [
      { summary_id: 'another-summary' },
      { part_type_id: 'pinion-1' },
      { status_code: 'DRAFT' },
      { has_build_event: false },
      { built_at: null },
      { deletedAt: new Date() },
    ]) {
      const { manager, query } = fixture([[{ ...completedBuild, ...change }], []]);
      await expect(allocateCutterRequest(manager, input, 'operator')).resolves.toBeNull();
      expect(query).toHaveBeenCalledTimes(2);
    }
  });

  it('never reallocates a processed or reversed build on a repeated completion callback', async () => {
    for (const row of [
      allocation,
      { ...allocation, reversed_at: new Date() },
      { ...allocation, request_id: null },
    ]) {
      const { manager, query } = fixture([[completedBuild], [row]]);
      await expect(allocateCutterRequest(manager, input, 'operator')).resolves.toBeNull();
      expect(query).toHaveBeenCalledTimes(2);
    }
  });

  it('preserves historical associations when the ledger has no imported row', async () => {
    const { manager, query } = fixture([[completedBuild], [], [{ existing: true }]]);
    await expect(allocateCutterRequest(manager, input, 'operator')).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('claims an unmatched build without changing a request so retries cannot backfill later requests', async () => {
    const { manager, query } = fixture([
      [completedBuild],
      [],
      [],
      [],
      [],
      [{ build_id: input.buildId }],
    ]);
    await expect(allocateCutterRequest(manager, input, 'operator')).resolves.toBeNull();
    expect(query.mock.calls[5][1]).toEqual([input.buildId, null]);
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE public.cutter_requests'))).toBe(
      false,
    );
  });

  it('does not change quantity after a competing ledger insert wins', async () => {
    const { manager, query } = fixture([[completedBuild], [], [], [], [{ id: 'request-1' }], []]);
    await expect(allocateCutterRequest(manager, input, 'operator')).resolves.toBeNull();
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE public.cutter_requests'))).toBe(
      false,
    );
  });

  it('fails the enclosing build transaction if the locked request cannot be updated', async () => {
    const { manager, query } = fixture([
      [completedBuild],
      [],
      [],
      [],
      [{ id: 'request-1' }],
      [{ build_id: input.buildId }],
      [],
    ]);
    await expect(allocateCutterRequest(manager, input, 'operator')).rejects.toThrow(
      'changed during fulfillment',
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('INSERT INTO public.cutter_request_history')),
    ).toBe(false);
  });
});

describe('eligible build void compensation', () => {
  it('appends compensation and marks the ledger without deleting original history', async () => {
    const { manager, query } = fixture([
      [voidedBuild],
      [],
      [allocation],
      [
        {
          id: 'request-1',
          requested_quantity: 3,
          remaining_quantity: 2,
          status: 'IN_PROGRESS',
          built_quantity: 1,
          has_build_evidence: true,
        },
      ],
      [],
      [],
      [],
    ]);
    await expect(
      reverseCutterRequestAllocation(manager, input.buildId, 'operator', ' entered in error '),
    ).resolves.toEqual({ requestId: 'request-1', buildId: input.buildId });
    const history = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.cutter_request_history'),
    );
    expect(history?.[0]).toContain("'AUTO_FULFILLMENT_REVERSED'");
    expect(history?.[1]).toEqual([
      expect.any(String),
      'request-1',
      input.buildId,
      'operator',
      'entered in error',
    ]);
    expect(query.mock.calls.some(([sql]) => sql.includes('DELETE'))).toBe(false);
  });

  it('ignores ordinary completed, running, pulled or torn-down cutters that are not soft-voided', async () => {
    const { manager, query } = fixture([[{ id: input.buildId, enabled: true, deletedAt: null }]]);
    await expect(
      reverseCutterRequestAllocation(manager, input.buildId, 'operator', 'teardown'),
    ).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('is idempotent and ignores processed builds that were never assigned to a request', async () => {
    for (const row of [
      { ...allocation, reversed_at: new Date() },
      { ...allocation, request_id: null },
    ]) {
      const { manager, query } = fixture([[voidedBuild], [], [row]]);
      await expect(
        reverseCutterRequestAllocation(manager, input.buildId, 'operator', 'void'),
      ).resolves.toBeNull();
      expect(query).toHaveBeenCalledTimes(3);
    }
  });

  it('refuses ambiguous historical links rather than choosing a request', async () => {
    const { manager, query } = fixture([
      [voidedBuild],
      [],
      [{ ...allocation, request_id: null, legacy_conflict: true }],
    ]);
    await expect(
      reverseCutterRequestAllocation(manager, input.buildId, 'operator', 'void'),
    ).rejects.toThrow('conflicting historical request links');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('refuses a missing ledger with surviving links but permits an unlinked legacy build void', async () => {
    const linked = fixture([[voidedBuild], [], [], [{ existing: true }]]);
    await expect(
      reverseCutterRequestAllocation(linked.manager, input.buildId, 'operator', 'void'),
    ).rejects.toThrow('history without a matching allocation record');
    expect(linked.query).toHaveBeenCalledTimes(4);
    const unlinked = fixture([[voidedBuild], [], [], []]);
    await expect(
      reverseCutterRequestAllocation(unlinked.manager, input.buildId, 'operator', 'void'),
    ).resolves.toBeNull();
    expect(unlinked.query).toHaveBeenCalledTimes(4);
  });

  it('refuses compensation that would overfill Remaining or conceal missing request data', async () => {
    for (const rows of [
      [],
      [{ id: 'request-1', requested_quantity: 2, remaining_quantity: null }],
      [{ id: 'request-1', requested_quantity: null, remaining_quantity: 0 }],
      [{ id: 'request-1', requested_quantity: 2, remaining_quantity: 2 }],
      [{ id: 'request-1', requested_quantity: 2, remaining_quantity: -1 }],
    ]) {
      const { manager, query } = fixture([[voidedBuild], [], [allocation], rows]);
      await expect(
        reverseCutterRequestAllocation(manager, input.buildId, 'operator', 'void'),
      ).rejects.toThrow('cannot be safely reversed');
      expect(query).toHaveBeenCalledTimes(4);
    }
  });

  it('refuses to compensate inconsistent counts or missing/already-compensated build evidence', async () => {
    for (const change of [
      { built_quantity: 2 },
      { built_quantity: 0 },
      { built_quantity: null },
      { has_build_evidence: false },
    ]) {
      const { manager, query } = fixture([
        [voidedBuild],
        [],
        [allocation],
        [
          {
            id: 'request-1',
            requested_quantity: 3,
            remaining_quantity: 2,
            status: 'IN_PROGRESS',
            built_quantity: 1,
            has_build_evidence: true,
            ...change,
          },
        ],
      ]);
      await expect(
        reverseCutterRequestAllocation(manager, input.buildId, 'operator', 'void'),
      ).rejects.toThrow('cannot be safely reversed');
      expect(query).toHaveBeenCalledTimes(4);
      expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE public.cutter_requests'))).toBe(
        false,
      );
    }
  });
});
