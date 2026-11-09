/** Add the canonical assembly master on fresh installations; existing masters stay intact. */
export const GEARSET_SCHEMA_SQL = `
INSERT INTO public.part_types(id,code,name,description,enabled)
SELECT gen_random_uuid(),'GEARSET','Gearset','Gearset assembly',true
WHERE NOT EXISTS(SELECT 1 FROM public.part_types WHERE lower(btrim(code))='gearset');

CREATE TABLE IF NOT EXISTS public.gearsets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gearset_part_id uuid NOT NULL UNIQUE REFERENCES public.parts(id) ON DELETE RESTRICT,
  ring_part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE RESTRICT,
  pinion_part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE RESTRICT,
  summary_id uuid NOT NULL REFERENCES public.part_summaries(id) ON DELETE RESTRICT,
  ratio_value numeric(10,4) NOT NULL,
  ratio_text varchar(64) NOT NULL,
  customer text,
  application text,
  statuses text[] NOT NULL DEFAULT ARRAY[]::text[],
  cut text,
  active boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid,
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS ix_gearsets_ring_part ON public.gearsets(ring_part_id);
CREATE INDEX IF NOT EXISTS ix_gearsets_pinion_part ON public.gearsets(pinion_part_id);
CREATE INDEX IF NOT EXISTS ix_gearsets_summary ON public.gearsets(summary_id,active,enabled);
`;
