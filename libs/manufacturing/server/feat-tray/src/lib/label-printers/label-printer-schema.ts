/* Label printers chosen in Admin. Additive and idempotent: an existing table and its rows are left as they are. */
import { STARTUP_SCHEMA_LOCK_SQL } from '@meshforge/manufacturing/shared/util-constants';

interface SchemaQuery {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}
interface SchemaDatabase {
  transaction<T>(work: (manager: SchemaQuery) => Promise<T>): Promise<T>;
}

export const LABEL_PRINTER_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS public.gear_label_printers (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name text NOT NULL CHECK (btrim(name) <> ''),
     host text NOT NULL CHECK (btrim(host) <> ''),
     port integer NOT NULL DEFAULT 9100 CHECK (port BETWEEN 1 AND 65535),
     label_type text NOT NULL CHECK (label_type IN ('ASSET_TAG','CUTTER_CARD')),
     language text NOT NULL CHECK (language IN ('IPL','ZPL')),
     is_default boolean NOT NULL DEFAULT false,
     enabled boolean NOT NULL DEFAULT true,
     updated_by uuid NULL,
     created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
     updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
     CONSTRAINT gear_label_printers_default_enabled_ck CHECK (enabled OR NOT is_default)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS gear_label_printers_name_uq ON public.gear_label_printers (lower(name))`,
  // One default per kind of label.
  `CREATE UNIQUE INDEX IF NOT EXISTS gear_label_printers_default_uq ON public.gear_label_printers (label_type) WHERE is_default`,
  // Fine adjustment of where the label lands on this printer's stock, in dots (203 per inch).
  `ALTER TABLE public.gear_label_printers ADD COLUMN IF NOT EXISTS offset_right integer NOT NULL DEFAULT 0`,
  `ALTER TABLE public.gear_label_printers ADD COLUMN IF NOT EXISTS offset_down integer NOT NULL DEFAULT 0`,
];

export async function ensureLabelPrinterSchema(database: SchemaDatabase): Promise<void> {
  await database.transaction(async (manager) => {
    await manager.query(STARTUP_SCHEMA_LOCK_SQL);
    for (const sql of LABEL_PRINTER_SCHEMA_SQL) await manager.query(sql);
  });
}
