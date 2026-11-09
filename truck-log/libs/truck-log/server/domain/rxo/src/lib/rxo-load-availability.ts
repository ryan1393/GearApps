/** SQL expressions below are code-owned; user values are always bound parameters. */
export const EXPEDITE_CHECK_IN_SITE = 'fort-wayne-expedite';
export const latestExpediteBatchSql = `SELECT source_batch_id FROM rxo_expedite_import_batches
  WHERE status='COMPLETE' ORDER BY source_completed_at DESC, imported_at DESC NULLS LAST, source_batch_id DESC LIMIT 1`;

export function rxoSelectionSql(siteKey: string): string {
  if (siteKey === EXPEDITE_CHECK_IN_SITE) {
    return `SELECT $1::text AS site_key, UPPER(shipment_id) AS shipment_id, direction
      FROM rxo_expedite_shipment_snapshots
      WHERE source_batch_id=(${latestExpediteBatchSql})
        AND UPPER(shipment_id)=$2 AND direction=$3 LIMIT 2`;
  }
  return `SELECT site_key, shipment_id, direction FROM rxo_shipment_context
    WHERE site_key=$1 AND shipment_id=$2 AND direction=$3 LIMIT 2`;
}

/** Completed visits still consume the load. Imported rows and history are retained. */
export function rxoLoadAvailableSql(site: string, shipment: string, direction: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM truck_visits consumed_visit
    WHERE consumed_visit.guard_check_in_at IS NOT NULL AND (
      (consumed_visit.rxo_site_key=${site} AND consumed_visit.rxo_shipment_id=${shipment}
       AND consumed_visit.rxo_direction=${direction})
      OR (consumed_visit.rxo_site_key IS NULL AND consumed_visit.rxo_shipment_id IS NULL
       AND consumed_visit.rxo_direction IS NULL
       AND UPPER(BTRIM(consumed_visit.load_number))=${shipment} AND consumed_visit.direction=${direction}
       AND EXISTS (SELECT 1 FROM rxo_shipment_context legacy_context
         WHERE legacy_context.site_key=${site} AND legacy_context.shipment_id=${shipment}
           AND legacy_context.direction=${direction})
       AND NOT EXISTS (SELECT 1 FROM rxo_shipment_context other_site
         WHERE other_site.shipment_id=${shipment} AND other_site.direction=${direction}
           AND other_site.site_key<>${site}))
    )
  )`;
}

export function rxoOrderAvailableSql(alias: string): string {
  const direct = rxoLoadAvailableSql(`${alias}.site_key`, `${alias}.shipment_id`, `${alias}.direction`);
  const linked = rxoLoadAvailableSql('available_link.site_key', 'available_link.shipment_id', 'available_link.direction');
  // An unassigned or partially consumed multi-shipment order stays available.
  return `(${direct} AND (
    NULLIF(BTRIM(${alias}.shipment_id),'') IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM rxo_order_shipment_links available_link
      WHERE available_link.site_key=${alias}.site_key AND available_link.order_number=${alias}.order_number
        AND available_link.direction=${alias}.direction AND available_link.visible_in_latest=TRUE)
    OR EXISTS (SELECT 1 FROM rxo_order_shipment_links available_link
      WHERE available_link.site_key=${alias}.site_key AND available_link.order_number=${alias}.order_number
        AND available_link.direction=${alias}.direction AND available_link.visible_in_latest=TRUE AND ${linked})
  ))`;
}

export function scheduledLoadAvailableSql(load: string, source: string): string {
  const site = `split_part(${source},':',2)`;
  const number = `UPPER(BTRIM(${load}))`;
  const context = `schedule_context.site_key=${site} AND schedule_context.shipment_id=${number}`;
  const available = rxoLoadAvailableSql('schedule_context.site_key','schedule_context.shipment_id','schedule_context.direction');
  // A schedule has no direction column: retain it if another direction remains.
  return `(CASE WHEN ${source} LIKE 'RXO:%' THEN NOT (
    (EXISTS (SELECT 1 FROM truck_visits scheduled_visit
       WHERE scheduled_visit.guard_check_in_at IS NOT NULL AND scheduled_visit.rxo_site_key=${site}
         AND scheduled_visit.rxo_shipment_id=${number})
     OR EXISTS (SELECT 1 FROM rxo_shipment_context schedule_context WHERE ${context} AND NOT (${available})))
    AND NOT EXISTS (SELECT 1 FROM rxo_shipment_context schedule_context WHERE ${context} AND ${available})
  ) ELSE NOT EXISTS (SELECT 1 FROM truck_visits scheduled_visit
    WHERE scheduled_visit.guard_check_in_at IS NOT NULL AND UPPER(BTRIM(scheduled_visit.load_number))=${number}) END)`;
}
