import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import { countsAfterQualityCheck, DSF_MANUAL_PIECE_COUNT_MESSAGE } from './greenshed-piece-counts';
import { greenshedCheckInterval } from './greenshed.queries';
import { ServerFeatGreenshedService } from './server-feat-greenshed.service';

describe('Greenshed piece counts', () => {
  const run = { current_piece_count: 140, last_check_piece_count: 100 };

  it('lets an operator-counted check set the running count, never lower it', () => {
    expect(countsAfterQualityCheck(run, 150, false)).toEqual({ current_piece_count: 150, last_check_piece_count: 150 });
    expect(() => countsAfterQualityCheck(run, 130, false)).toThrow(UnprocessableEntityException);
  });

  it('leaves the DSF running count alone and records the check count', () => {
    // Taken at the scheduled point, below the DSF count.
    expect(countsAfterQualityCheck(run, 125, true)).toEqual({ current_piece_count: 140, last_check_piece_count: 125 });
    // Typed above what DSF has credited so far: the running count still does not move.
    expect(countsAfterQualityCheck(run, 160, true)).toEqual({ current_piece_count: 140, last_check_piece_count: 160 });
    expect(() => countsAfterQualityCheck(run, 99, true)).toThrow(
      'Check piece count cannot be below previous check count 100',
    );
  });

  it('schedules the next check from the check count', () => {
    const after = countsAfterQualityCheck(run, 160, true);
    expect(after.last_check_piece_count + greenshedCheckInterval()).toBe(160 + greenshedCheckInterval());
  });

  describe('manual piece count update', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    it('is refused while DSF credits counts to cutters', async () => {
      Object.assign(process.env, { DSF_COUNT_ENABLED: 'true', DSF_CUTTER_WRITE_ENABLED: 'true' });
      const transaction = jest.fn();
      const service = new ServerFeatGreenshedService({ transaction } as never);
      const error = await service.updatePieceCount('101', 500, 'user' as never).catch((thrown) => thrown);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(DSF_MANUAL_PIECE_COUNT_MESSAGE);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('still works for operator-counted cutters', async () => {
      Object.assign(process.env, { DSF_COUNT_ENABLED: 'false', DSF_CUTTER_WRITE_ENABLED: 'false' });
      const transaction = jest.fn().mockResolvedValue({ current_piece_count: 500 });
      const service = new ServerFeatGreenshedService({ transaction } as never);
      await expect(service.updatePieceCount('101', 500, 'user' as never)).resolves.toEqual({ current_piece_count: 500 });
      expect(transaction).toHaveBeenCalled();
    });
  });
});
