import { Logger } from '@nestjs/common';
import {
  INGEST_PRUNE_BATCH,
  INGEST_PRUNE_MAX_BATCHES,
  INGEST_REQUEST_RETENTION_DAYS,
  PostgresLapperStore,
} from './postgres-lapper.store';

describe('Collector request-key pruning', () => {
  const store = (deletedPerBatch: Array<number | Error>) => {
    const query = jest.fn(async (_sql: string, _params: unknown[]) => {
      const next = deletedPerBatch.shift() ?? 0;
      if (next instanceof Error) throw next;
      return [{ deleted: next }];
    });
    return { store: new PostgresLapperStore({ db: { query } } as never), query };
  };
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('deletes only rows older than 90 days, in bounded batches, with bound parameters', async () => {
    const { store: s, query } = store([INGEST_PRUNE_BATCH, INGEST_PRUNE_BATCH, 12]);
    expect(await s.pruneIngestRequests()).toBe(2 * INGEST_PRUNE_BATCH + 12);
    expect(query).toHaveBeenCalledTimes(3);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('created_at < now() - make_interval(days => $1::int)');
    expect(sql).toContain('LIMIT $2');
    expect(sql).toContain('DELETE FROM lapper.ingest_requests');
    expect(params).toEqual([INGEST_REQUEST_RETENTION_DAYS, INGEST_PRUNE_BATCH]);
    expect(INGEST_REQUEST_RETENTION_DAYS).toBe(90);
  });

  it('stops after a bounded number of batches per run', async () => {
    const { store: s, query } = store(Array(INGEST_PRUNE_MAX_BATCHES + 5).fill(INGEST_PRUNE_BATCH));
    await s.pruneIngestRequests();
    expect(query).toHaveBeenCalledTimes(INGEST_PRUNE_MAX_BATCHES);
  });

  it('never throws and runs once at a time', async () => {
    const { store: s, query } = store([new Error('connection lost')]);
    const [a, b] = [s.pruneIngestRequests(), s.pruneIngestRequests()];
    expect(a).toBe(b);
    await expect(a).resolves.toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('runs at startup and then daily, off the request path, until shut down', async () => {
    jest.useFakeTimers();
    try {
      const { store: s, query } = store([]);
      s.schedulePruning();
      s.schedulePruning();
      expect(query).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(0);
      expect(query).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(query).toHaveBeenCalledTimes(2);
      s.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000);
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
