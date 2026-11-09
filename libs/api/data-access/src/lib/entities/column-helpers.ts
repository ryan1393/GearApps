import { EntitySchemaColumnOptions, EntitySchemaRelationOptions } from 'typeorm';

/** UUID primary key shared by every table. */
export const uuidPrimary: EntitySchemaColumnOptions = {
  type: 'uuid',
  primary: true,
  generated: 'uuid',
};

export const str = (nullable = false): EntitySchemaColumnOptions => ({ type: String, nullable });
export const int = (nullable = false): EntitySchemaColumnOptions => ({ type: 'int', nullable });
export const num = (nullable = false): EntitySchemaColumnOptions => ({ type: 'float', nullable });
export const bool = (nullable = false): EntitySchemaColumnOptions => ({ type: Boolean, nullable });
/**
 * Driver selected at load time: entity schemas are static, so the few column types
 * that differ between databases are resolved here rather than per request.
 */
const DB_TYPE = process.env['DATABASE_TYPE'] ?? 'better-sqlite3';

/** Timestamp column: Postgres has no `datetime`; MSSQL/SQLite have no `timestamp` in this sense. */
export const date = (nullable = false): EntitySchemaColumnOptions => ({
  type: DB_TYPE === 'postgres' ? 'timestamp' : 'datetime',
  nullable,
});
export const decimal = (
  precision: number,
  scale: number,
  nullable = false,
): EntitySchemaColumnOptions => ({
  type: 'decimal',
  precision,
  scale,
  nullable,
});

/** Plain FK column exposed on the entity so `*_id` is readable/writable without loading the relation. */
export const fk = (nullable = false): EntitySchemaColumnOptions => ({ type: 'uuid', nullable });

/**
 * many-to-one relation bound to an explicit `<name>_id` column.
 * The FK column must also be declared via `fk()` with the same `joinColumn` name.
 */
export const manyToOne = (
  target: string,
  joinColumn: string,
  opts: {
    nullable?: boolean;
    eager?: boolean;
    onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
  } = {},
): EntitySchemaRelationOptions => ({
  type: 'many-to-one',
  target,
  joinColumn: { name: joinColumn },
  nullable: opts.nullable ?? false,
  eager: opts.eager ?? false,
  onDelete: opts.onDelete,
  createForeignKeyConstraints: true,
});

/**
 * Whether the configured driver supports an identity/sequence on a non-key column.
 * SQL Server (IDENTITY) and Postgres (serial) do; SQLite does not (AUTOINCREMENT is only
 * valid on INTEGER PRIMARY KEY), so on SQLite the application assigns the value instead.
 */
export const DB_SUPPORTS_NON_PK_IDENTITY = DB_TYPE === 'mssql' || DB_TYPE === 'postgres';

/** Auto-incrementing business number (e.g. build number). See {@link DB_SUPPORTS_NON_PK_IDENTITY}. */
export const sequenceInt = (): EntitySchemaColumnOptions =>
  DB_SUPPORTS_NON_PK_IDENTITY
    ? { type: 'int', nullable: false, generated: 'increment' }
    : { type: 'int', nullable: false };
