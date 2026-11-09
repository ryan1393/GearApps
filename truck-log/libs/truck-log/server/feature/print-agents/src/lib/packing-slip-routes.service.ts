import { BadRequestException, ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  PACKING_SLIP_ROUTE_COUNT,
  confirmLiveMatches,
  newlyLivePackingSlipRoutes,
  packingSlipRouteChanges,
  validatePackingSlipRoutes,
  type PackingSlipRoute,
  type PackingSlipRouteConfig,
  type PackingSlipRouteMode,
} from '@truck-log/shared/contracts';

type Queryable = Pick<EntityManager, 'query'>;
interface ConfigRow { version: number; updated_at: Date | string; updated_by: string }
interface RouteRow { route: number; name: string; source_queue: string; output_printer: string; mode: string; upload_enabled: boolean }

/**
 * Packing-slip watcher routes: read by the SAP watcher (Print Agent token) and
 * edited by administrators. One config row carries the version; saves lock it,
 * so two administrators can never both save on top of the same version.
 */
@Injectable()
export class PackingSlipRoutesService {
  constructor(private readonly db: DataSource) {}

  async current(q: Queryable = this.db, lock = false): Promise<PackingSlipRouteConfig> {
    const config: ConfigRow[] = await q.query(
      `SELECT version, updated_at, updated_by FROM packing_slip_watcher_config WHERE id = 1${lock ? ' FOR UPDATE' : ''}`,
    );
    const rows: RouteRow[] = await q.query(
      `SELECT route, name, source_queue, output_printer, mode, upload_enabled
         FROM packing_slip_watcher_routes ORDER BY route`,
    );
    if (config.length !== 1 || rows.length !== PACKING_SLIP_ROUTE_COUNT) {
      // Never hand the watcher a partial document; it would reject it anyway.
      throw new InternalServerErrorException({ code: 'PACKING_SLIP_ROUTES_MISSING', message: 'Packing-slip watcher routes are not set up. Run the Truck Log database migrations.' });
    }
    return {
      version: Number(config[0].version),
      updatedAt: new Date(config[0].updated_at).toISOString(),
      updatedBy: config[0].updated_by,
      routes: rows.map((r) => ({
        route: Number(r.route),
        name: r.name,
        sourceQueue: r.source_queue,
        outputPrinter: r.output_printer,
        mode: r.mode as PackingSlipRouteMode,
        uploadEnabled: r.upload_enabled === true,
      })),
    };
  }

  /** Save all eight routes. Returns the saved document (unchanged, same version, when nothing differs). */
  async save(input: unknown, actor: string): Promise<PackingSlipRouteConfig> {
    const body = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
    const version = body['version'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new BadRequestException({ code: 'PACKING_SLIP_ROUTES_INVALID', message: 'The saved version is missing. Reload the routes and try again.', issues: [] });
    }
    const { routes, issues } = validatePackingSlipRoutes(body['routes']);
    if (issues.length) {
      throw new BadRequestException({ code: 'PACKING_SLIP_ROUTES_INVALID', message: issues[0].route ? `Route ${issues[0].route}: ${issues[0].message}` : issues[0].message, issues });
    }
    const confirmLive = body['confirmLive'] === undefined ? [] : body['confirmLive'];

    return this.db.transaction(async (q) => {
      const saved = await this.current(q, true);
      if (saved.version !== version) {
        throw new ConflictException({
          code: 'PACKING_SLIP_ROUTES_STALE',
          message: `Someone else saved the packing-slip watcher routes (version ${saved.version} by ${saved.updatedBy}). Reload and make your change again.`,
          current: saved,
        });
      }
      const newlyLive = newlyLivePackingSlipRoutes(saved.routes, routes);
      if (!confirmLiveMatches(newlyLive, confirmLive)) {
        throw new BadRequestException({
          code: 'PACKING_SLIP_ROUTES_CONFIRM_LIVE',
          message: newlyLive.length
            ? `Confirm paper printing for route${newlyLive.length === 1 ? '' : 's'} ${newlyLive.join(', ')} before switching to Live.`
            : 'No route is newly switched to Live; nothing needs confirming.',
          issues: [],
        });
      }
      const changes = packingSlipRouteChanges(saved.routes, routes);
      if (!changes.length) return saved;

      for (const r of routes) await this.writeRoute(q, r);
      const next = version + 1;
      await q.query(
        `UPDATE packing_slip_watcher_config SET version = $1, updated_at = now(), updated_by = $2 WHERE id = 1`,
        [next, actor],
      );
      await q.query(
        `INSERT INTO packing_slip_watcher_route_audit (actor, version_before, version_after, live_confirmed, changes)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [actor, version, next, newlyLive, JSON.stringify(changes)],
      );
      return this.current(q);
    });
  }

  private async writeRoute(q: Queryable, r: PackingSlipRoute): Promise<void> {
    await q.query(
      `UPDATE packing_slip_watcher_routes
          SET name = $2, source_queue = $3, output_printer = $4, mode = $5, upload_enabled = $6
        WHERE route = $1`,
      [r.route, r.name, r.sourceQueue, r.outputPrinter, r.mode, r.uploadEnabled],
    );
  }
}
