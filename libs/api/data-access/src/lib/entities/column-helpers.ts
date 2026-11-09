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
export const date = (nullable = false): EntitySchemaColumnOptions => ({
  type: 'datetime',
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
 * SQL Server does; SQLite does not (AUTOINCREMENT is only valid on INTEGER PRIMARY KEY),
 * so on SQLite the application assigns the value instead. Read once at load time
 * because entity schemas are static.
 */
export const DB_SUPPORTS_NON_PK_IDENTITY =
  (process.env['DATABASE_TYPE'] ?? 'better-sqlite3') === 'mssql';

/** Auto-incrementing business number (e.g. build number). See {@link DB_SUPPORTS_NON_PK_IDENTITY}. */
export const sequenceInt = (): EntitySchemaColumnOptions =>
  DB_SUPPORTS_NON_PK_IDENTITY
    ? { type: 'int', nullable: false, generated: 'increment' }
    : { type: 'int', nullable: false };
