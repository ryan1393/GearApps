// Explicit imports may refresh reference data. Automatic deploys initialize only
// a fresh set, preserving administrative edits on subsequent deployments.
export async function shouldImportBaseData(client, bootstrapOnly) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('dana-base-data-import-v1'))");
  if (!bootstrapOnly) return true;
  const { rows } = await client.query(`
    SELECT EXISTS (SELECT 1 FROM public.departments)
        OR EXISTS (SELECT 1 FROM public.models)
        OR EXISTS (SELECT 1 FROM public.machines)
        OR EXISTS (SELECT 1 FROM public.part_summaries)
        OR EXISTS (SELECT 1 FROM public.parts)
        OR EXISTS (SELECT 1 FROM public.roll_masters)
        OR EXISTS (SELECT 1 FROM public.cutter_bodies) AS initialized
  `);
  return !rows[0].initialized;
}
