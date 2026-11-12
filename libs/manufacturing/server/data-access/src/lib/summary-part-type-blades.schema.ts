/**
 * HOS, Inner blade and Outer blade for each Summary + Part Type (RING and PINION have their
 * own three values). One authoritative row per pair; parts never get their own copy: a part
 * reads its own Summary + Part Type through public.part_blade_settings.
 *
 * - Values are stored exactly as assigned. The position (Inner or Outer) is the field, never
 *   derived from an IB/OB suffix: PINION 30538 legitimately has Outer blade "RH IB".
 * - Blank means not set; nothing is inferred from the other Part Type or another Summary.
 * - Workpiece HOS here is not cutter-body hand and adds no cutter-body restriction.
 * Additive only; nothing is backfilled by this migration.
 */
export const SUMMARY_PART_TYPE_BLADES_MIGRATION = {
  version: '20261112-summary-part-type-blades-v1',
  sql: `
  CREATE TABLE IF NOT EXISTS public.part_summary_part_type_blades (
    summary_id uuid NOT NULL REFERENCES public.part_summaries(id),
    part_type_id uuid NOT NULL REFERENCES public.part_types(id),
    hos text NULL CONSTRAINT ck_summary_part_type_blades_hos CHECK (hos IS NULL OR hos IN ('RH','LH')),
    inner_blade text NULL CONSTRAINT ck_summary_part_type_blades_inner
      CHECK (inner_blade IS NULL OR (inner_blade = upper(btrim(inner_blade)) AND length(inner_blade) BETWEEN 1 AND 32)),
    outer_blade text NULL CONSTRAINT ck_summary_part_type_blades_outer
      CHECK (outer_blade IS NULL OR (outer_blade = upper(btrim(outer_blade)) AND length(outer_blade) BETWEEN 1 AND 32)),
    source text NULL,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    "createdBy" character varying NULL,
    "updatedBy" character varying NULL,
    PRIMARY KEY (summary_id, part_type_id)
  );
  CREATE INDEX IF NOT EXISTS ix_summary_part_type_blades_part_type ON public.part_summary_part_type_blades(part_type_id);

  -- Each part resolves its own Summary AND Part Type; a part whose pair has no row reads blanks.
  CREATE OR REPLACE VIEW public.part_blade_settings AS
  SELECT p.id AS part_id, p.summary_id, p.part_type_id, b.hos, b.inner_blade, b.outer_blade
    FROM public.parts p
    LEFT JOIN public.part_summary_part_type_blades b
      ON b.summary_id = p.summary_id AND b.part_type_id = p.part_type_id;
`,
} as const;
