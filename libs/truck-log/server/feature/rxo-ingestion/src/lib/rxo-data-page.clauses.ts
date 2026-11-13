/** SQL predicates shared by the RXO data page and the RXO ingestion lists. */

export function normalizeRxoSite(site?: string) {
  return site?.trim().toLowerCase() || null;
}

export function activeRxoStatusClause(statusExpression: string) {
  return `LOWER(BTRIM(COALESCE(${statusExpression},''))) NOT IN ('delivered','complete','completed','cancelled','canceled','closed')`;
}

export function activeRxoPlantWindowClause(timestampExpression: string, timeZoneToken: string) {
  const windowStart = `((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE ${timeZoneToken}) - INTERVAL '1 day') AT TIME ZONE ${timeZoneToken})`;
  const windowEnd = `((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE ${timeZoneToken}) + INTERVAL '2 days') AT TIME ZONE ${timeZoneToken})`;
  return `${timestampExpression} IS NOT NULL AND ${timestampExpression} >= ${windowStart} AND ${timestampExpression} < ${windowEnd}`;
}
