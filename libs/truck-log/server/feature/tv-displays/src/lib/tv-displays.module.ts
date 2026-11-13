import { Controller, Get, Header, Injectable, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { formatVisitReference } from '@truck-log/shared/contracts';
import type { TvBoardSnapshot, TvDockRecord, TvVisitRecord } from '@truck-log/shared/contracts';

/* No mutation endpoints. Uncapped, consistent read-only snapshot: not the 30-row dashboard preview. */
export const TV_SETTINGS_SQL = `SELECT key, value FROM app_settings
  WHERE key IN ('site_name', 'plant_location_name', 'dock_warning_minutes', 'dock_critical_minutes')`;
export const TV_DOCKS_SQL = `SELECT id, code, COALESCE(description, '') AS description,
  active, sort_order AS "sortOrder" FROM docks ORDER BY sort_order, code, id`;
export const TV_VISITS_SQL = `SELECT v.id, v.load_number AS "loadNumber",
  v.carrier_name AS "carrierName", v.trailer_id AS "trailerId", v.direction,
  v.dock_code AS "dockCode", v.status,
  v.guard_check_in_at AS "guardCheckInAt", v.dock_assigned_at AS "dockAssignedAt",
  v.dock_completed_at AS "dockCompletedAt", v.guard_check_out_at AS "guardCheckOutAt",
  EXISTS (SELECT 1 FROM visit_documents d WHERE d.truck_visit_id = v.id
    AND d.document_type = 'PACKING_SLIP') AS "packingSlipAttached"
  FROM truck_visits v
  WHERE v.status IS DISTINCT FROM $1 OR v.guard_check_out_at IS NULL
  ORDER BY v.guard_check_in_at, v.id`;

type Row = Record<string, unknown>;
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some(r => !r || Array.isArray(r) || typeof r !== 'object')) {
    throw new Error('TV snapshot SELECT did not return rows.');
  }
  return value as Row[];
}
function id(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid TV record identity.');
  return n;
}
function text(value: unknown): string { return value == null ? '' : String(value); }
function iso(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(d.getTime())) throw new Error('Invalid TV snapshot timestamp.');
  return d.toISOString();
}
function positive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
@Injectable()
export class TvDisplaysService {
  constructor(private readonly dataSource: DataSource) {}
  async snapshot(): Promise<TvBoardSnapshot> {
    return this.dataSource.transaction('REPEATABLE READ', async manager => {
      await manager.query('SET TRANSACTION READ ONLY');
      const clock = rows(await manager.query('SELECT CURRENT_TIMESTAMP AS "generatedAt"'));
      if (clock.length !== 1 || !clock[0].generatedAt) throw new Error('TV snapshot clock missing.');
      const settings = new Map(rows(await manager.query(TV_SETTINGS_SQL)).map(r => [text(r.key), text(r.value)]));
      const warningMinutes = positive(settings.get('dock_warning_minutes'), 15);
      const criticalMinutes = Math.max(warningMinutes + 1, positive(settings.get('dock_critical_minutes'), 30));
      const dockRows = rows(await manager.query(TV_DOCKS_SQL));
      const visitRows = rows(await manager.query(TV_VISITS_SQL, ['GUARD_CHECKED_OUT']));
      const docks: TvDockRecord[] = dockRows.map(r => {
        if (typeof r.active !== 'boolean') throw new Error('Invalid dock enabled state.');
        return { id: id(r.id), code: text(r.code), description: text(r.description), active: r.active,
          sortOrder: Number.isFinite(Number(r.sortOrder)) ? Number(r.sortOrder) : 0 };
      });
      const visits: TvVisitRecord[] = visitRows.map(r => {
        if (typeof r.packingSlipAttached !== 'boolean') throw new Error('Invalid packing-slip presence state.');
        return { id: id(r.id), visitReference: formatVisitReference(id(r.id)), loadNumber: text(r.loadNumber),
          carrierName: text(r.carrierName), trailerId: text(r.trailerId), direction: text(r.direction),
          dockCode: text(r.dockCode), status: text(r.status), guardCheckInAt: iso(r.guardCheckInAt),
          dockAssignedAt: iso(r.dockAssignedAt), dockCompletedAt: iso(r.dockCompletedAt),
          guardCheckOutAt: iso(r.guardCheckOutAt), packingSlipAttached: r.packingSlipAttached };
      });
      if (new Set(docks.map(d => d.id)).size !== docks.length || new Set(docks.map(d => d.code)).size !== docks.length ||
          new Set(visits.map(v => v.id)).size !== visits.length) throw new Error('Duplicate TV snapshot identities.');
      const configured = settings.get('site_name')?.trim();
      return { schema: 'truck-log-tv-v1', generatedAt: iso(clock[0].generatedAt)!,
        siteName: configured && configured.toLowerCase() !== 'truck log'
          ? configured : settings.get('plant_location_name')?.trim() || 'Truck Log',
        warningMinutes, criticalMinutes, docks, visits };
    });
  }
}
@Controller('tv')
export class TvDisplaysController {
  constructor(private readonly displays: TvDisplaysService) {}
  @Get('board')
  @Header('Cache-Control', 'no-store, max-age=0')
  board(): Promise<TvBoardSnapshot> { return this.displays.snapshot(); }
}
@Module({ controllers: [TvDisplaysController], providers: [TvDisplaysService] })
export class TvDisplaysModule {}
