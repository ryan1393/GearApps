/** Restore the quantity-based request schema without rewriting surviving requests/history. */
export const CUTTER_REQUESTS_MIGRATION = {
  version: '20261112-cutter-requests-restoration-v1',
  sql: `
CREATE TABLE IF NOT EXISTS public.cutter_requests (
  id uuid PRIMARY KEY,
  summary_id uuid NOT NULL REFERENCES public.part_summaries(id),
  part_type_id uuid NOT NULL REFERENCES public.part_types(id),
  requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
  remaining_quantity integer NOT NULL CHECK (remaining_quantity >= 0 AND remaining_quantity <= requested_quantity),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','IN_PROGRESS','READY','COMPLETED','CANCELED')),
  requested_by text NOT NULL,
  updated_by text,
  notes text,
  requested_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.cutter_request_history (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.cutter_requests(id),
  build_id uuid REFERENCES public.cutter_builds(id),
  event_type text NOT NULL,
  user_id text,
  notes text,
  quantity_delta integer NOT NULL DEFAULT 0,
  occurred_at timestamp with time zone NOT NULL DEFAULT clock_timestamp()
);

-- Refuse unknown/incompatible old shapes rather than guessing values for existing records.
DO $requests_shape$
DECLARE expected record; actual text;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('cutter_requests','id','uuid'),('cutter_requests','summary_id','uuid'),('cutter_requests','part_type_id','uuid'),
    ('cutter_requests','requested_quantity','int4'),('cutter_requests','remaining_quantity','int4'),
    ('cutter_requests','status','text'),('cutter_requests','requested_by','text'),('cutter_requests','updated_by','text'),
    ('cutter_requests','notes','text'),('cutter_requests','requested_at','timestamptz'),
    ('cutter_requests','updated_at','timestamptz'),('cutter_requests','completed_at','timestamptz'),
    ('cutter_request_history','id','uuid'),('cutter_request_history','request_id','uuid'),
    ('cutter_request_history','build_id','uuid'),('cutter_request_history','event_type','text'),
    ('cutter_request_history','user_id','text'),('cutter_request_history','notes','text'),
    ('cutter_request_history','quantity_delta','int4'),('cutter_request_history','occurred_at','timestamptz')
  ) AS fields(table_name,column_name,type_name)
  LOOP
    SELECT udt_name INTO actual FROM information_schema.columns
      WHERE table_schema='public' AND table_name=expected.table_name AND column_name=expected.column_name;
    IF actual IS DISTINCT FROM expected.type_name THEN
      RAISE EXCEPTION 'Cutter Requests restoration: incompatible %.% (expected %, found %). Existing records are unchanged; review the legacy schema before retrying.',
        expected.table_name,expected.column_name,expected.type_name,coalesce(actual,'missing');
    END IF;
  END LOOP;
END $requests_shape$;

-- D2 referenced the wrong part-type table. Correct only that verified FK, never remap IDs.
DO $requests_part_type_fk$
DECLARE wrong_fk record;
BEGIN
  FOR wrong_fk IN SELECT c.conname FROM pg_constraint c
    WHERE c.contype='f' AND c.conrelid='public.cutter_requests'::regclass
      AND c.confrelid=to_regclass('public.cutter_part_types')
      AND c.conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='part_type_id')]::smallint[]
  LOOP
    IF EXISTS (SELECT 1 FROM public.cutter_requests r LEFT JOIN public.part_types p ON p.id=r.part_type_id WHERE p.id IS NULL) THEN
      RAISE EXCEPTION 'Cutter Requests: legacy part_type_id values do not resolve in public.part_types. Preserve and reconcile those IDs before correcting the D2 foreign key.';
    END IF;
    EXECUTE format('ALTER TABLE public.cutter_requests DROP CONSTRAINT %I',wrong_fk.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype='f'
    AND c.conrelid='public.cutter_requests'::regclass AND c.confrelid='public.part_types'::regclass
    AND c.conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='part_type_id')]::smallint[])
  THEN
    ALTER TABLE public.cutter_requests ADD CONSTRAINT fk_cutter_requests_part_type
      FOREIGN KEY(part_type_id) REFERENCES public.part_types(id) NOT VALID;
  END IF;
END $requests_part_type_fk$;

CREATE INDEX IF NOT EXISTS ix_cutter_requests_open_pair ON public.cutter_requests(summary_id,part_type_id,requested_at,id)
  WHERE status IN ('REQUESTED','IN_PROGRESS','READY') AND remaining_quantity>0;
CREATE INDEX IF NOT EXISTS ix_cutter_request_history_request ON public.cutter_request_history(request_id,occurred_at,id);
CREATE INDEX IF NOT EXISTS ix_cutter_request_history_build ON public.cutter_request_history(build_id,event_type);

-- A unique build claim makes retries/concurrent completion safe without deleting duplicate old history.
-- A NULL request is either an unmatched new build, or an explicitly flagged ambiguous legacy link.
CREATE TABLE IF NOT EXISTS public.cutter_request_build_allocations (
  build_id uuid PRIMARY KEY REFERENCES public.cutter_builds(id),
  request_id uuid REFERENCES public.cutter_requests(id),
  fulfilled_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  reversed_at timestamp with time zone,
  legacy_conflict boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_cutter_request_allocations_request ON public.cutter_request_build_allocations(request_id);
WITH legacy_links AS (
  SELECT h.build_id,
    CASE WHEN count(DISTINCT h.request_id)=1 THEN min(h.request_id::text)::uuid ELSE NULL END AS request_id,
    min(h.occurred_at) AS fulfilled_at,count(DISTINCT h.request_id)>1 AS legacy_conflict
  FROM public.cutter_request_history h
  JOIN public.cutter_builds b ON b.id=h.build_id
  JOIN public.cutter_requests r ON r.id=h.request_id
  WHERE h.event_type='AUTO_FULFILLED' GROUP BY h.build_id
)
INSERT INTO public.cutter_request_build_allocations(build_id,request_id,fulfilled_at,reversed_at,legacy_conflict)
SELECT l.build_id,l.request_id,l.fulfilled_at,
  (SELECT max(x.occurred_at) FROM public.cutter_request_history x
    WHERE x.build_id=l.build_id AND x.request_id=l.request_id AND x.event_type='AUTO_FULFILLMENT_REVERSED'),
  l.legacy_conflict
FROM legacy_links l
ON CONFLICT(build_id) DO NOTHING;
`,
} as const;
