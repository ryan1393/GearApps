import { EntityManager } from 'typeorm';

/**
 * Reusable reference records are independent. In particular, a driver is not
 * permanently bound to a carrier; the relationship belongs to each visit.
 */
export async function upsertDriverReference(manager: EntityManager, name: string, phoneNumber: string, usedAt: Date) {
    const rows = await manager.query(`INSERT INTO drivers(name, phone_number, active, last_used_at, created_at, updated_at)
   VALUES($1,$2,true,$3,$3,$3)
   ON CONFLICT ((LOWER(BTRIM(name)))) DO UPDATE
     SET phone_number = EXCLUDED.phone_number,
         last_used_at = CASE
           WHEN drivers.last_used_at IS NULL THEN EXCLUDED.last_used_at
           ELSE GREATEST(drivers.last_used_at, EXCLUDED.last_used_at)
         END,
         updated_at = EXCLUDED.updated_at
   RETURNING id`, [name, phoneNumber, usedAt]);
    return Number(rows[0].id);
}
export async function upsertCarrierReference(manager: EntityManager, name: string, usedAt: Date) {
    const rows = await manager.query(`INSERT INTO carriers(name, active, last_used_at, created_at, updated_at)
   VALUES($1,true,$2,$2,$2)
   ON CONFLICT ((LOWER(BTRIM(name)))) DO UPDATE
     SET last_used_at = CASE
           WHEN carriers.last_used_at IS NULL THEN EXCLUDED.last_used_at
           ELSE GREATEST(carriers.last_used_at, EXCLUDED.last_used_at)
         END,
         updated_at = EXCLUDED.updated_at
   RETURNING id`, [name, usedAt]);
    return Number(rows[0].id);
}
export async function upsertLocationReference(manager: EntityManager, name: string, usedAt: Date) {
    const rows = await manager.query(`INSERT INTO locations(name, active, last_used_at, created_at, updated_at)
   VALUES($1,true,$2,$2,$2)
   ON CONFLICT ((LOWER(BTRIM(name)))) DO UPDATE
     SET last_used_at = CASE
           WHEN locations.last_used_at IS NULL THEN EXCLUDED.last_used_at
           ELSE GREATEST(locations.last_used_at, EXCLUDED.last_used_at)
         END,
         updated_at = EXCLUDED.updated_at
   RETURNING id`, [name, usedAt]);
    return Number(rows[0].id);
}

/** Take shared location locks in database key order for both travel directions. */
export async function upsertLocationPair(manager: EntityManager, origin: string, destination: string, usedAt: Date): Promise<[number, number]> {
    // PostgreSQL owns normalization/collation. Advisory locks cover previously absent rows as well.
    const rows = await manager.query(`SELECT name, LOWER(BTRIM(name)) AS key FROM unnest($1::text[]) name ORDER BY LOWER(BTRIM(name)) COLLATE "C"`, [[origin, destination]]) as Array<{name: string; key: string}>;
    const ids = new Map<string, number>();
    for (const row of rows) {
        if (ids.has(row.key)) continue;
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['truck-log:location:' + row.key]);
        ids.set(row.key, await upsertLocationReference(manager, row.name, usedAt));
    }
    const keyRows = await manager.query('SELECT LOWER(BTRIM($1::text)) AS origin, LOWER(BTRIM($2::text)) AS destination', [origin, destination]);
    return [ids.get(keyRows[0].origin)!, ids.get(keyRows[0].destination)!];
}
