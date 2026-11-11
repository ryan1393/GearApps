import { adoptLegacyDatabaseName } from './adopt-legacy-database';

const environment = (overrides: Record<string, string | undefined> = {}) =>
  ({ DATABASE_HOST: 'db', DATABASE_NAME: 'MeshForge', ...overrides }) as NodeJS.ProcessEnv;

function maintenance(existing: string[], renameError?: Error) {
  const statements: string[] = [];
  const connect = jest.fn(async (_environment: NodeJS.ProcessEnv, work: (query: (sql: string, parameters?: unknown[]) => Promise<unknown>) => Promise<void>) => {
    await work(async (sql) => {
      statements.push(sql);
      if (sql.startsWith('SELECT')) return existing.map((datname) => ({ datname }));
      if (renameError) throw renameError;
      return [];
    });
  });
  return { connect, statements };
}

describe('adoptLegacyDatabaseName', () => {
  it('renames GearApps when MeshForge does not exist yet', async () => {
    const { connect, statements } = maintenance(['GearApps']);
    await adoptLegacyDatabaseName(environment(), connect, 'no-such.env');
    expect(statements).toContain('ALTER DATABASE "GearApps" RENAME TO "MeshForge"');
  });

  it('leaves both alone when MeshForge already exists', async () => {
    const { connect, statements } = maintenance(['GearApps', 'MeshForge']);
    await adoptLegacyDatabaseName(environment(), connect, 'no-such.env');
    expect(statements.some((sql) => sql.startsWith('ALTER'))).toBe(false);
  });

  it('does nothing on a new server with neither database', async () => {
    const { connect, statements } = maintenance([]);
    await adoptLegacyDatabaseName(environment(), connect, 'no-such.env');
    expect(statements.some((sql) => sql.startsWith('ALTER'))).toBe(false);
  });

  it('does not look when the API is configured for another database name', async () => {
    const { connect } = maintenance(['GearApps']);
    await adoptLegacyDatabaseName(environment({ DATABASE_NAME: 'GearApps' }), connect, 'no-such.env');
    await adoptLegacyDatabaseName(environment({ DATABASE_NAME: 'Plant2' }), connect, 'no-such.env');
    await adoptLegacyDatabaseName(environment({ DATABASE_HOST: undefined }), connect, 'no-such.env');
    expect(connect).not.toHaveBeenCalled();
  });

  it('lets the API start when the rename fails', async () => {
    const { connect } = maintenance(['GearApps'], new Error('database "GearApps" is being accessed by other users'));
    await expect(adoptLegacyDatabaseName(environment(), connect)).resolves.toBeUndefined();
  });
});
