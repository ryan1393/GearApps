import { EntityManager } from 'typeorm';

// Additive only. No existing shipment or physical location is inferred.
export const COATER_SHIPMENT_SCHEMA = `
ALTER TABLE public.container_tray ADD COLUMN IF NOT EXISTS packed_from_location_id uuid,
  ADD COLUMN IF NOT EXISTS packed_at timestamptz;
CREATE SEQUENCE IF NOT EXISTS public.dana_coater_shipment_number_v1;
CREATE TABLE IF NOT EXISTS public.dana_coater_shipments_v1 (
  id uuid PRIMARY KEY, number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','DISPATCHED','CANCELED')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  destination text NOT NULL, notes text NOT NULL DEFAULT '',
  manifest jsonb NOT NULL, content_hash text NOT NULL,
  reviewed_revision integer, printed_revision integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dispatched_at timestamptz, dispatched_by text
);
CREATE TABLE IF NOT EXISTS public.dana_coater_shipment_containers_v1 (
  shipment_id uuid NOT NULL REFERENCES public.dana_coater_shipments_v1(id),
  container_id uuid NOT NULL REFERENCES public.containers(id),
  reserved boolean NOT NULL DEFAULT true,
  PRIMARY KEY(shipment_id,container_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS dana_coater_reserved_container_v1
  ON public.dana_coater_shipment_containers_v1(container_id) WHERE reserved;
CREATE INDEX IF NOT EXISTS dana_coater_shipments_created_v1
  ON public.dana_coater_shipments_v1(created_at DESC,id);
CREATE TABLE IF NOT EXISTS public.dana_coater_shipment_events_v1 (
  id uuid PRIMARY KEY, shipment_id uuid NOT NULL REFERENCES public.dana_coater_shipments_v1(id),
  revision integer NOT NULL, kind text NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp(), actor text NOT NULL, actor_id text NOT NULL,
  detail text NOT NULL DEFAULT '', document jsonb
);
CREATE INDEX IF NOT EXISTS dana_coater_events_shipment_v1
  ON public.dana_coater_shipment_events_v1(shipment_id,at,id);
ALTER TABLE public.dana_coater_shipments_v1
  ADD COLUMN IF NOT EXISTS po text,
  ADD COLUMN IF NOT EXISTS po_source text,
  ADD COLUMN IF NOT EXISTS coater_legal_name text;
CREATE TABLE IF NOT EXISTS public.dana_rpa_settings_v1 (
  id integer PRIMARY KEY CHECK (id = 1),
  next_number integer NOT NULL CHECK (next_number BETWEEN 1 AND 9999999),
  recipients_to text[] NOT NULL DEFAULT '{}', recipients_cc text[] NOT NULL DEFAULT '{}',
  unit_price numeric(12,2) NOT NULL, insurance_unit numeric(12,2) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_by text,
  coater_display_name text NOT NULL, default_po text,
  default_po_expires_on date, default_po_enabled boolean NOT NULL DEFAULT false,
  CHECK (NOT default_po_enabled OR (default_po IS NOT NULL AND default_po_expires_on IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.dana_rpa_part_map_v1 (
  summary text NOT NULL, part_type text NOT NULL CHECK (part_type IN ('RING','PINION')),
  outer_part text NOT NULL, inner_part text NOT NULL, PRIMARY KEY (summary,part_type)
);
CREATE TABLE IF NOT EXISTS public.dana_rpa_requests_v1 (
  id uuid PRIMARY KEY, shipment_id uuid NOT NULL REFERENCES public.dana_coater_shipments_v1(id),
  revision integer NOT NULL, number integer NOT NULL UNIQUE, po text NOT NULL,
  document bytea NOT NULL, details jsonb NOT NULL, recipients_to text[] NOT NULL, recipients_cc text[] NOT NULL,
  email_status text NOT NULL DEFAULT 'PENDING' CHECK (email_status IN ('PENDING','SENDING','SENT','FAILED','UNKNOWN')),
  email_error text, email_sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text NOT NULL, email_started_at timestamptz, email_attempts integer NOT NULL DEFAULT 0,
  UNIQUE (shipment_id,revision)
);
-- The Excel form uploaded in Admin > Coater RPA. When present it is used in place of the
-- workbook saved with the earliest imported request.
CREATE TABLE IF NOT EXISTS public.dana_rpa_template_v1 (
  id integer PRIMARY KEY CHECK (id = 1),
  document bytea NOT NULL, file_name text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp(), uploaded_by text NOT NULL
);
`;

/** Keep short coater transactions consistent with legacy inventory/admin/undo
 * writers, which do not all share row locks. Reads remain available. */
export async function lockCoaterInventory(manager: EntityManager): Promise<void> {
  await manager.query("SET LOCAL lock_timeout = '5s'");
  await manager.query("SELECT pg_advisory_xact_lock(hashtext('dana-coater-shipments-v1'))");
  await manager.query(`LOCK TABLE public.blade_history, public.blade_tray, public.blades,
    public.container_tray, public.containers, public.cutter_build_blades, public.cutter_build_trays,
    public.location_tray, public.locations, public.part_summaries,
    public.part_types, public.tray_stages, public.trays IN SHARE ROW EXCLUSIVE MODE`);
}
