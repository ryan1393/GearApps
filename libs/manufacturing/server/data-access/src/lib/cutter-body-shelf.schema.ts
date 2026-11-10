/** R24R1: append-only shelf observations; never backfill from old cutter builds. */
export const CUTTER_BODY_SHELF_SCHEMA = `
  CREATE TABLE IF NOT EXISTS public.cutter_body_shelf_placements (
    id uuid PRIMARY KEY,
    cutter_body_id uuid NOT NULL REFERENCES public.cutter_bodies(id),
    location_id uuid NOT NULL REFERENCES public.locations(id),
    build_increment_at_placement integer NOT NULL CHECK (build_increment_at_placement >= 0),
    placed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    placed_by uuid NOT NULL,
    removed_at timestamptz,
    removed_by uuid,
    enabled boolean NOT NULL DEFAULT true
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cutter_body_shelf_active
    ON public.cutter_body_shelf_placements (cutter_body_id) WHERE enabled=true;
  CREATE INDEX IF NOT EXISTS ix_cutter_body_shelf_location
    ON public.cutter_body_shelf_placements (location_id) WHERE enabled=true;
`;
