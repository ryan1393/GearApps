import { EntityManager } from 'typeorm';

/**
 * Serializes changes to one Part Summary and its blade requirements for the rest of the
 * transaction. Every writer of a Summary's identity or requirements takes this same lock.
 */
export async function lockSummaryRequirements(manager: EntityManager, summaryId: string): Promise<void> {
  await manager.query("SELECT pg_advisory_xact_lock(hashtext('cutter-summary-requirement:' || $1::text))", [summaryId]);
}
