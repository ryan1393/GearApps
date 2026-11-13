import type { DataSource } from 'typeorm';

type CleanupLogger = { error(message: string, stack?: string): void };

/**
 * Remove a just-written document file after its database transaction failed,
 * but only when a fresh query proves no committed row points at it.
 *
 * A connection lost during COMMIT has an unknown outcome: the row may exist.
 * An orphaned file is harmless and recoverable; a committed row whose file was
 * deleted is not. So when in doubt, keep the file.
 */
export async function removeIfUncommitted(
  dataSource: Pick<DataSource, 'query'>,
  relativePath: string,
  remove: () => unknown,
  logger?: CleanupLogger,
): Promise<boolean> {
  let referenced = true;
  try {
    const rows = await dataSource.query(
      'SELECT EXISTS(SELECT 1 FROM visit_documents WHERE relative_path = $1) AS referenced',
      [relativePath],
    ) as Array<{ referenced: boolean | string }>;
    const value = rows[0]?.referenced;
    referenced = !(value === false || value === 'f' || value === 'false');
  } catch (error) {
    logger?.error(`Could not confirm ${relativePath} is unreferenced after a failed save; the file was kept.`,
      error instanceof Error ? error.stack : undefined);
    return false;
  }
  if (referenced) return false;
  try {
    await remove();
    return true;
  } catch (error) {
    logger?.error(`Failed to remove uncommitted file ${relativePath}.`, error instanceof Error ? error.stack : undefined);
    return false;
  }
}
