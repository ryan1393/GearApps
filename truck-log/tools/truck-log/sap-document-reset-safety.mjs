/**
 * Refuse broad Truck Log resets once the generalized document foundation owns
 * durable SAP captures or Materials-uploaded RXO driver paperwork.
 *
 * The fixed table lock makes the check and the caller's following TRUNCATE one
 * transactionally safe operation: an agent upload cannot appear between them.
 * Legacy databases remain supported because the guard is a no-op until the
 * generalized source_kind column exists.
 */
export async function assertNoSapDocumentMetadataForReset(client) {
  const relation = await client.query(
    `SELECT to_regclass('public.visit_documents') AS relation`,
  );
  if (!relation.rows[0]?.relation) return;

  await client.query(
    `LOCK TABLE public.visit_documents IN SHARE ROW EXCLUSIVE MODE`,
  );

  const column = await client.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'visit_documents'
        AND column_name = 'source_kind'`,
  );
  if (!column.rowCount) return;

  const result = await client.query(
    `SELECT COUNT(*)::bigint AS count
       FROM public.visit_documents
      WHERE sap_document_type_code IS NOT NULL
         OR source_kind IN ('PRINT_AGENT', 'MATERIALS_UPLOAD')`,
  );
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > 0) {
    throw new Error(
      `Refusing to clear Truck Log data: public.visit_documents contains ${count} ` +
      `durable SAP/RXO document record(s). ` +
      `This reset would erase database metadata while stored PDFs remain. Nothing was changed.`,
    );
  }
}
