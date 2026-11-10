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
