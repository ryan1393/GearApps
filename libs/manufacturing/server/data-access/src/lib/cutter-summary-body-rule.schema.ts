/**
 * Summary Body Size Rule: which approved cutter-body rule a Summary uses.
 * Required blade quantity is Summary-based; the rule disambiguates rules with
 * equal quantities (076 Standard and 105 Special are both 26 blades).
 *
 * Additive only. Nothing is backfilled: a Summary without a row is either
 * identified by its unique quantity or left unresolved for an administrator.
 * Codes must match CUTTER_BODY_RULES in @meshforge/manufacturing/shared/util-constants.
 */
export const CUTTER_SUMMARY_BODY_RULE_MIGRATION = {
  version: '20261111-cutter-summary-body-rules-v1',
  sql: `
  CREATE TABLE IF NOT EXISTS public.cutter_summary_body_rules (
    summary_id uuid PRIMARY KEY REFERENCES public.part_summaries(id),
    body_rule text NOT NULL CONSTRAINT ck_cutter_summary_body_rule
      CHECK (body_rule IN ('064','076','088','105','105-SPECIAL')),
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    "createdBy" character varying NULL,
    "updatedBy" character varying NULL
  );
`,
} as const;

interface Queryable { query(sql: string, parameters?: unknown[]): Promise<unknown> }

/** The Summary's configured Body Size Rule code, or null when none is configured. */
export async function readSummaryBodyRule(manager: Queryable, summaryId: string): Promise<string | null> {
  const rows = (await manager.query(
    'SELECT body_rule FROM public.cutter_summary_body_rules WHERE summary_id=$1',
    [summaryId],
  )) as Array<{ body_rule: string }>;
  return rows[0]?.body_rule ?? null;
}
