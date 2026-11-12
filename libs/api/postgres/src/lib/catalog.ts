import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { CYCLE_TIME_AVERAGE_OF, PER_CYCLE_MACROS } from '@meshforge/shared/domain';

export type Row = Record<string, unknown>;
export type Resource =
  | 'machine'
  | 'gearset'
  | 'macro'
  | 'macro-log'
  | 'machine-cycle'
  | 'scanner-detail'
  | 'machine-fanuc-variable'
  | 'department'
  | 'part'
  | 'part-summary';
export const text = (value: unknown): string => (value == null ? '' : String(value));
/**
 * PostgreSQL only knows the old alias zone names when its host installs them (Ubuntu 24.04
 * and later do not), and then every cycle insert fails. The canonical name works everywhere.
 */
const ZONE_ALIASES: Record<string, string> = {
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Fort_Wayne': 'America/Indiana/Indianapolis',
  'US/East-Indiana': 'America/Indiana/Indianapolis',
};
export const canonicalTimeZone = (zone: string): string => ZONE_ALIASES[zone] ?? zone;
export const numberOrNull = (value: unknown): number | null =>
  value == null ? null : Number(value);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const owner = (value: unknown) => (uuidPattern.test(text(value)) ? value : null);
const status = (row: Row) => (row.active && row.enabled && !row.deletedAt ? 'active' : 'inactive');
// Pending collector numbers may later become complete MeshForge assemblies.
// Resolve them at read time too, so their existing history follows that assembly.
const resolvedGearset = `COALESCE(g.public_gearset_id,(SELECT pg.id FROM public.gearsets pg
  JOIN public.parts gp ON gp.id=pg.gearset_part_id
  WHERE lower(btrim(gp.part_number))=lower(btrim(g.number)) ORDER BY pg.id LIMIT 1),g.id)`;
// A transaction has one PostgreSQL connection; do not queue concurrent queries on it.
const readBatch = async (...reads: Array<() => Promise<Row[]>>): Promise<Row[][]> => {
  const result: Row[][] = [];
  for (const read of reads) result.push(await read());
  return result;
};

@Injectable()
export class PostgresLapperCatalog {
  readonly timeZone: string;
  constructor(
    readonly db: DataSource,
    config: ConfigService,
  ) {
    this.timeZone = canonicalTimeZone(
      config.get<string>('db.lapperTimeZone') ?? 'America/Indianapolis',
    );
  }

  async departments(manager = this.db.manager): Promise<Row[]> {
    const rows = await manager
      .createQueryBuilder()
      .select('d.*')
      .from('public.departments', 'd')
      .where('d."deletedAt" IS NULL')
      .orderBy('d.code')
      .getRawMany<Row>();
    return rows.map((d) => ({ id: d.id, number: Number(d.code), description: d.description }));
  }

  async summaries(manager = this.db.manager): Promise<Row[]> {
    const rows = await manager
      .createQueryBuilder()
      .select('s.*')
      .addSelect('m.model_number', 'model_number')
      .from('public.part_summaries', 's')
      .leftJoin('(SELECT * FROM public.models)', 'm', 'm.id=s.model_id')
      .where('s."deletedAt" IS NULL')
      .orderBy('s.number')
      .getRawMany<Row>();
    return rows.map((s) => ({
      id: s.id,
      number: s.number,
      model: text(s.model_number),
      hos: s.hos ?? '',
      revision: s.revision,
      status: status(s),
      user_id: owner(s.createdBy),
    }));
  }

  async parts(manager = this.db.manager): Promise<Row[]> {
    const [rows, summaries, gearsets] = await readBatch(
      () =>
        manager
          .createQueryBuilder()
          .select('p.*')
          .addSelect('t.name', 'part_type')
          .from('public.parts', 'p')
          .innerJoin('(SELECT * FROM public.part_types)', 't', 't.id=p.part_type_id')
          .where('p."deletedAt" IS NULL')
          .orderBy('p.part_number')
          .getRawMany<Row>(),
      () => this.summaries(manager),
      () =>
        manager.createQueryBuilder().select('g.*').from('public.gearsets', 'g').getRawMany<Row>(),
    );
    const summariesById = new Map(summaries.map((s) => [s.id, s]));
    const gearByPart = new Map(gearsets.map((g) => [g.gearset_part_id, g]));
    const result: Row[] = rows.map((p) => {
      const gear = gearByPart.get(p.id);
      return {
        id: p.id,
        number: p.part_number,
        type: p.part_type,
        summary_id: p.summary_id,
        summary: summariesById.get(p.summary_id),
        teeth: gear ? numberOrNull(gear.ratio_value) : numberOrNull(p.teeth),
        status: status(p),
        user_id: owner(p.createdBy),
        ring_id: gear?.ring_part_id ?? null,
        pinion_id: gear?.pinion_part_id ?? null,
      };
    });
    const byId = new Map(result.map((p) => [p.id, p]));
    return result.map((p) => ({ ...p, ring: byId.get(p.ring_id), pinion: byId.get(p.pinion_id) }));
  }

  async gearsets(manager = this.db.manager): Promise<Row[]> {
    const [current, legacy, parts] = await readBatch(
      () =>
        manager.createQueryBuilder().select('g.*').from('public.gearsets', 'g').getRawMany<Row>(),
      () =>
        manager
          .createQueryBuilder()
          .select('g.*')
          .from('lapper.gearsets', 'g')
          .orderBy('g.id')
          .getRawMany<Row>(),
      () => this.parts(manager),
    );
    const partById = new Map(parts.map((p) => [p.id, p]));
    const result: Row[] = current.flatMap((g) => {
      const part = partById.get(g.gearset_part_id);
      if (!part) return [];
      const override = legacy.find((l) => l.public_gearset_id === g.id);
      const summary = part.summary as Row | undefined;
      return [
        {
          id: g.id,
          number: part.number,
          rev: override?.rev ?? summary?.revision ?? null,
          ratio: numberOrNull(g.ratio_value),
          status:
            g.active && g.enabled && !g.archived_at ? (override?.status ?? 'active') : 'inactive',
          summary_id: g.summary_id,
          summary,
          ring_id: g.ring_part_id,
          ring: partById.get(g.ring_part_id),
          pinion_id: g.pinion_part_id,
          pinion: partById.get(g.pinion_part_id),
          user_id: override?.user_id ?? owner(g.created_by),
          // Stored master fields, read-only here. business_statuses is the business
          // classification (Production, Service, ...), kept apart from status above.
          ratio_text: g.ratio_text ?? null,
          model: summary?.model ? text(summary.model) : null,
          customer: g.customer ?? null,
          application: g.application ?? null,
          business_statuses: Array.isArray(g.statuses) ? (g.statuses as unknown[]).map(text) : [],
          cut: g.cut ?? null,
          archived: Boolean(g.archived_at),
        },
      ];
    });
    const knownNumbers = new Set(result.map((g) => text(g.number).trim().toLowerCase()));
    for (const g of legacy) {
      if (g.public_gearset_id || knownNumbers.has(text(g.number).trim().toLowerCase())) continue;
      result.push({ ...g, ratio: numberOrNull(g.ratio) });
      knownNumbers.add(text(g.number).trim().toLowerCase());
    }
    return result.sort((a, b) => text(a.number).localeCompare(text(b.number)));
  }

  async machines(manager = this.db.manager, withScanners = true): Promise<Row[]> {
    const rows = await manager
      .createQueryBuilder()
      .select('l.*')
      .addSelect('p.id', 'api_id')
      .addSelect('p.machine_number', 'api_number')
      .addSelect('p.cell', 'api_cell')
      .addSelect('p.description', 'api_description')
      .addSelect('p.active', 'api_active')
      .addSelect('p.enabled', 'api_enabled')
      .addSelect('d.code', 'department_code')
      .from('lapper.machines', 'l')
      .innerJoin('(SELECT * FROM public.machines)', 'p', 'p.id=l.public_machine_id')
      .innerJoin('(SELECT * FROM public.departments)', 'd', 'd.id=p.department_id')
      .where('p."deletedAt" IS NULL')
      .orderBy('p.cell', 'ASC')
      .addOrderBy('p.machine_number', 'ASC')
      .getRawMany<Row>();
    const scanners = withScanners
      ? await manager
          .createQueryBuilder()
          .select('s.*')
          .from('lapper.scanners', 's')
          .orderBy('s.id')
          .getRawMany<Row>()
      : [];
    return rows.map((l) => {
      const scanner = scanners.find((s) => s.machine_id === l.id);
      return {
        id: l.api_id,
        legacy_id: l.id,
        number: l.api_number,
        ip: l.machine_ip,
        dept_id: l.department_code,
        description: l.api_description,
        type: l.type,
        builder: l.builder,
        cell: l.api_cell == null ? null : text(l.api_cell),
        status: l.api_active && l.api_enabled ? l.status : 'inactive',
        scanner_id: scanner?.id ?? null,
        scanner: scanner ? { ...scanner, machine_id: l.api_id } : null,
        argonaut_url: l.argonaut_url ?? null,
        argonaut_location_id: l.argonaut_location_id ?? null,
      };
    });
  }

  async machineByIp(ip: string, number?: string): Promise<Row> {
    const rows = (await this.machines()).filter(
      (m) => m.ip === ip && (!number || m.number === number),
    );
    if (rows.length > 1)
      throw new ConflictException(
        'More than one machine uses this IP. Configure the collector MachineNumber or correct the machine IP assignments.',
      );
    if (!rows.length) throw new NotFoundException('Machine not found');
    return rows[0];
  }

  async legacyMachine(id: string, manager = this.db.manager): Promise<Row> {
    const row = await manager
      .createQueryBuilder()
      .select('m.*')
      .from('lapper.machines', 'm')
      .where('(m.id=:id OR m.public_machine_id=:id)', { id })
      .getRawOne<Row>();
    if (!row) throw new NotFoundException('Machine not found');
    return row;
  }

  async scanners(manager = this.db.manager): Promise<Row[]> {
    const [rows, machines] = await readBatch(
      () =>
        manager.createQueryBuilder().select('s.*').from('lapper.scanners', 's').getRawMany<Row>(),
      () => this.machines(manager, false),
    );
    return rows.map((s) => {
      const machine = machines.find((m) => m.legacy_id === s.machine_id);
      return { ...s, machine_id: machine?.id ?? s.machine_id, machine };
    });
  }

  async variables(manager = this.db.manager): Promise<Row[]> {
    const [rows, machines] = await readBatch(
      () =>
        manager
          .createQueryBuilder()
          .select('v.*')
          // Ages on the database clock, the same clock that stamped them, so no other clock matters.
          .addSelect('EXTRACT(EPOCH FROM clock_timestamp() - v.in_cycle_since)', 'cycle_elapsed_s')
          .addSelect('EXTRACT(EPOCH FROM clock_timestamp() - v.reported_at)', 'reported_age_s')
          .from('lapper.machine_fanuc_variables', 'v')
          .getRawMany<Row>(),
      () => this.machines(manager, false),
    );
    return rows.map((v) => {
      // Internal timestamps: callers get the ages below instead.
      delete v.in_cycle_since;
      delete v.reported_at;
      const machine = machines.find((m) => m.legacy_id === v.machine_id);
      const elapsed = numberOrNull(v.cycle_elapsed_s);
      return {
        ...v,
        // Only while the machine says it is in cycle; never negative from a just-written start.
        cycle_elapsed_s: v['y03_2_stack_inCycle'] && elapsed !== null ? Math.max(0, Math.round(elapsed * 1000) / 1000) : null,
        reported_age_s: numberOrNull(v.reported_age_s) === null ? null : Math.max(0, Math.round(Number(v.reported_age_s) * 10) / 10),
        machine_id: machine?.id ?? v.machine_id,
        machine,
      };
    });
  }

  async macros(manager = this.db.manager): Promise<Row[]> {
    const rows = await manager
      .createQueryBuilder()
      .select('m.*')
      .from('lapper.macros', 'm')
      .orderBy('m.number')
      .getRawMany<Row>();
    // PostgreSQL returns numeric columns as text.
    return rows.map((m) => ({
      ...m,
      min_value: numberOrNull(m.min_value),
      max_value: numberOrNull(m.max_value),
    }));
  }

  private cycleQuery(
    manager: EntityManager,
    filter: { id?: string; machineId?: string; gearsetId?: string; ids?: string[] },
  ) {
    const query = manager
      .createQueryBuilder()
      .select('c.*')
      .addSelect('COALESCE(c.recorded_at,c.timestamp AT TIME ZONE :zone)', 'occurred_at')
      .addSelect('lm.public_machine_id', 'api_machine_id')
      .addSelect(resolvedGearset, 'api_gearset_id')
      .from('lapper.machine_cycles', 'c')
      .innerJoin('(SELECT * FROM lapper.machines)', 'lm', 'lm.id=c.machine_id')
      .innerJoin('(SELECT * FROM lapper.gearsets)', 'g', 'g.id=c.gearset_id')
      .setParameter('zone', this.timeZone);
    if (filter.id)
      query.andWhere(
        'c.id=COALESCE((SELECT a.canonical_id FROM lapper.machine_cycle_aliases a WHERE a.original_id=:id),CAST(:id AS uuid))',
        { id: filter.id },
      );
    if (filter.ids) query.andWhere('c.id IN (:...ids)', { ids: filter.ids });
    if (filter.machineId)
      query.andWhere('(lm.public_machine_id=:machineId OR lm.id=:machineId)', {
        machineId: filter.machineId,
      });
    if (filter.gearsetId)
      query.andWhere('(' + resolvedGearset + '=:gearsetId OR g.id=:gearsetId)', {
        gearsetId: filter.gearsetId,
      });
    return query
      .orderBy('COALESCE(c.recorded_at,c.timestamp AT TIME ZONE :zone)', 'DESC')
      .addOrderBy('c.id', 'DESC');
  }

  async production() {
    const [row] = await this.db.query(`SELECT
      COUNT(*) FILTER (WHERE occurred_at >= now() - interval '24 hours')::integer AS cycles_24h,
      COUNT(DISTINCT machine_id) FILTER (WHERE occurred_at >= now() - interval '24 hours')::integer AS machines_reporting_24h,
      COUNT(*) FILTER (WHERE occurred_at >= now() - interval '24 hours' AND NULLIF(BTRIM(serial_number), '') IS NULL)::integer AS missing_serial_24h,
      MAX(occurred_at) AS last_cycle_at
      FROM (SELECT machine_id, serial_number, COALESCE(recorded_at, timestamp AT TIME ZONE $1) AS occurred_at FROM lapper.machine_cycles) cycles`, [this.timeZone]);
    // Every lapper, busiest first, so an idle or untraceable machine stands out.
    const machines = await this.db.query(`SELECT
      lm.public_machine_id AS machine_id,
      COALESCE(NULLIF(BTRIM(pm.machine_number), ''), lm.machine_ip) AS number,
      pm.cell::text AS cell, lm.status,
      COALESCE(p.cycles_1h, 0)::integer AS cycles_1h,
      COALESCE(p.cycles_24h, 0)::integer AS cycles_24h,
      COALESCE(p.missing_serial_24h, 0)::integer AS missing_serial_24h,
      p.last_cycle_at, p.last_gearset_id, p.last_gearset, p.last_serial_number
      FROM lapper.machines lm
      JOIN public.machines pm ON pm.id = lm.public_machine_id
      LEFT JOIN (SELECT c.machine_id,
        COUNT(*) FILTER (WHERE c.occurred_at >= now() - interval '1 hour') AS cycles_1h,
        COUNT(*) FILTER (WHERE c.occurred_at >= now() - interval '24 hours') AS cycles_24h,
        COUNT(*) FILTER (WHERE c.occurred_at >= now() - interval '24 hours' AND NULLIF(BTRIM(c.serial_number), '') IS NULL) AS missing_serial_24h,
        MAX(c.occurred_at) AS last_cycle_at,
        (ARRAY_AGG(COALESCE(g.public_gearset_id, g.id) ORDER BY c.occurred_at DESC, c.id DESC) FILTER (WHERE c.occurred_at >= now() - interval '24 hours'))[1] AS last_gearset_id,
        (ARRAY_AGG(COALESCE(gp.part_number, g.number) ORDER BY c.occurred_at DESC, c.id DESC) FILTER (WHERE c.occurred_at >= now() - interval '24 hours'))[1] AS last_gearset,
        (ARRAY_AGG(c.serial_number ORDER BY c.occurred_at DESC, c.id DESC) FILTER (WHERE c.occurred_at >= now() - interval '24 hours'))[1] AS last_serial_number
        FROM (SELECT id, machine_id, gearset_id, serial_number, COALESCE(recorded_at, timestamp AT TIME ZONE $1) AS occurred_at FROM lapper.machine_cycles) c
        JOIN lapper.gearsets g ON g.id = c.gearset_id
        LEFT JOIN public.gearsets pg ON pg.id = g.public_gearset_id
        LEFT JOIN public.parts gp ON gp.id = pg.gearset_part_id
        GROUP BY c.machine_id) p ON p.machine_id = lm.id
      ORDER BY COALESCE(p.cycles_24h, 0) DESC, 2`, [this.timeZone]);
    return { ...row, machines };
  }

  async cycles(
    filter: {
      id?: string;
      machineId?: string;
      gearsetId?: string;
      ids?: string[];
      latest?: boolean;
      limit?: number;
    } = {},
    manager = this.db.manager,
  ): Promise<Row[]> {
    if (filter.ids && !filter.ids.length) return [];
    const query = this.cycleQuery(manager, filter);
    if (filter.latest) query.limit(1);
    else if (filter.limit) query.limit(filter.limit);
    const [rows, machines, gearsets] = await readBatch(
      () => query.getRawMany<Row>(),
      () => this.machines(manager),
      () => this.gearsets(manager),
    );
    const machineById = new Map(machines.map((m) => [m.id, m]));
    const gearById = new Map(gearsets.map((g) => [g.id, g]));
    return rows.map((c) => ({
      id: c.id,
      consec: c.consec,
      serial_number: c.serial_number,
      timestamp: c.occurred_at,
      cycle_time_s: numberOrNull(c.cycle_time_s),
      machine_id: c.api_machine_id,
      machine: machineById.get(c.api_machine_id),
      gearset_id: c.api_gearset_id,
      gearset: gearById.get(c.api_gearset_id),
    }));
  }

  async logs(id?: string, manager = this.db.manager): Promise<Row[]> {
    const query = manager.createQueryBuilder().select('l.*').from('lapper.macro_logs', 'l');
    if (id)
      query.where(
        'l.id=COALESCE((SELECT a.canonical_id FROM lapper.macro_log_aliases a WHERE a.original_id=:id),CAST(:id AS uuid))',
        { id },
      );
    const [rows, macros] = await readBatch(
      () => query.getRawMany<Row>(),
      () => this.macros(manager),
    );
    const ids = [...new Set(rows.map((l) => text(l.machine_cycle_id)))];
    const cycles = await this.cycles(ids.length > 10000 ? {} : { ids }, manager);
    const cycleById = new Map(cycles.map((c) => [c.id, c]));
    const macroById = new Map(macros.map((m) => [m.id, m]));
    return rows.map((l) => ({
      ...l,
      value: Number(l.value),
      macro: macroById.get(l.macro_id),
      machine_cycle: cycleById.get(l.machine_cycle_id),
    }));
  }

  /**
   * Cycles of the past `hours`, on every machine, that changed a flagged macro (Admin > Macros >
   * Flag changes; never the per-cycle counters in PER_CYCLE_MACROS) since the previous reading of
   * that value on the same machine and gearset. A value's first reading has no previous one and is
   * not a change. Newest first.
   */
  async settingChanges(hours: number, limit: number) {
    const rows = await this.db.query(
      `WITH recent AS (
         SELECT c.id, c.machine_id, c.gearset_id, c.consec, c.serial_number,
                COALESCE(c.recorded_at, c.timestamp AT TIME ZONE $1) AS occurred_at
           FROM lapper.machine_cycles c
          WHERE COALESCE(c.recorded_at, c.timestamp AT TIME ZONE $1) >= now() - make_interval(hours => $2::int)
       ), changed AS (
         SELECT r.id, m.number, m.name, m.unit, l.value, previous.value AS previous_value
           FROM recent r
           JOIN lapper.macro_logs l ON l.machine_cycle_id = r.id
           JOIN lapper.macros m ON m.id = l.macro_id
           CROSS JOIN LATERAL (
             SELECT pl.value
               FROM lapper.macro_logs pl
               JOIN lapper.machine_cycles pc ON pc.id = pl.machine_cycle_id
              WHERE pl.macro_id = l.macro_id AND pc.machine_id = r.machine_id AND pc.gearset_id = r.gearset_id
                AND (COALESCE(pc.recorded_at, pc.timestamp AT TIME ZONE $1), pc.id) < (r.occurred_at, r.id)
              ORDER BY COALESCE(pc.recorded_at, pc.timestamp AT TIME ZONE $1) DESC, pc.id DESC
              LIMIT 1
           ) previous
          WHERE m.flag_changes AND m.number <> ALL($3::int[]) AND previous.value IS DISTINCT FROM l.value
       ), flagged AS (
         SELECT r.*, json_agg(json_build_object('number', ch.number, 'name', ch.name, 'unit', ch.unit,
                  'previous_value', ch.previous_value, 'value', ch.value) ORDER BY ch.number) AS changes
           FROM recent r JOIN changed ch ON ch.id = r.id
          GROUP BY r.id, r.machine_id, r.gearset_id, r.consec, r.serial_number, r.occurred_at
       )
       SELECT f.id AS machine_cycle_id, f.consec, f.serial_number, f.occurred_at AS timestamp, f.changes,
              lm.public_machine_id AS machine_id, ${resolvedGearset} AS gearset_id,
              COUNT(*) OVER () AS total
         FROM flagged f
         JOIN lapper.machines lm ON lm.id = f.machine_id
         JOIN lapper.gearsets g ON g.id = f.gearset_id
        ORDER BY f.occurred_at DESC, f.id DESC
        LIMIT $4`,
      [this.timeZone, hours, PER_CYCLE_MACROS, limit],
    );
    const [machines, gearsets] = await readBatch(() => this.machines(), () => this.gearsets());
    const machineById = new Map(machines.map((m) => [m.id, m]));
    const gearById = new Map(gearsets.map((g) => [g.id, g]));
    return {
      hours,
      total: Number(rows[0]?.total ?? 0),
      items: rows.map((row: Row) => ({
        machine_cycle_id: row.machine_cycle_id,
        machine_id: row.machine_id,
        machine_number: machineById.get(text(row.machine_id))?.number ?? null,
        gearset_id: row.gearset_id,
        gearset_number: gearById.get(text(row.gearset_id))?.number ?? null,
        serial_number: row.serial_number,
        consec: row.consec,
        timestamp: row.timestamp,
        changes: (row.changes as Row[]).map((change) => ({
          number: Number(change.number),
          name: change.name,
          unit: change.unit ?? null,
          previous_value: Number(change.previous_value),
          value: Number(change.value),
        })),
      })),
    };
  }

  /** One page of a machine and gearset's cycles, newest first, optionally filtered by serial. */
  async historyPage(machineId: string, gearsetId: string, page: number, pageSize: number, serial?: string) {
    const query = this.cycleQuery(this.db.manager, { machineId, gearsetId });
    const wanted = serial?.trim();
    // The serial is matched as text typed by the user: escape the LIKE wildcards.
    if (wanted) query.andWhere("c.serial_number ILIKE :serial ESCAPE '\\'", { serial: '%' + wanted.replace(/[\\%_]/g, '\\$&') + '%' });
    const counted = await query.clone().select('COUNT(*)', 'total').orderBy().getRawOne<Row>();
    // Average of the most recent timed cycles, whatever serial the list is filtered by.
    const timed = await this.cycleQuery(this.db.manager, { machineId, gearsetId })
      .andWhere('c.cycle_time_s IS NOT NULL')
      .select('c.cycle_time_s', 'cycle_time_s')
      .limit(CYCLE_TIME_AVERAGE_OF)
      .getRawMany<Row>();
    const times = timed.map((t) => Number(t.cycle_time_s)).filter(Number.isFinite);
    const rows = await query
      .addSelect('(SELECT COUNT(*) FROM lapper.macro_logs l WHERE l.machine_cycle_id=c.id)', 'changed_count')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getRawMany<Row>();
    return {
      items: rows.map((c) => ({
        id: c.id, consec: c.consec, serial_number: c.serial_number, timestamp: c.occurred_at,
        machine_id: c.api_machine_id, gearset_id: c.api_gearset_id, changed_count: Number(c.changed_count),
        cycle_time_s: numberOrNull(c.cycle_time_s),
      })),
      total: Number(counted?.total ?? 0), page, page_size: pageSize,
      cycle_time: {
        average_s: times.length ? Math.round((times.reduce((sum, t) => sum + t, 0) / times.length) * 1000) / 1000 : null,
        average_of: times.length,
      },
    };
  }

  /**
   * The most recent recorded macro values for a machine and gearset, each beside the value it
   * replaced. The collector records a macro only when it changes, so every row is a change
   * (or, with no previous value, the first reading).
   */
  async changes(machineId: string, gearsetId: string, limit: number, cycleId?: string): Promise<Row[]> {
    const rows = await this.db.query(
      `SELECT * FROM (
         SELECT c.id AS machine_cycle_id, COALESCE(c.recorded_at, c.timestamp AT TIME ZONE $3) AS timestamp,
                c.serial_number, c.consec, m.id AS macro_id, m.number, m.name, m.used_form, m.unit,
                m.min_value, m.max_value, l.value,
                LAG(l.value) OVER (PARTITION BY m.id
                  ORDER BY COALESCE(c.recorded_at, c.timestamp AT TIME ZONE $3), c.id, l.id) AS previous_value
           FROM lapper.macro_logs l
           JOIN lapper.machine_cycles c ON c.id = l.machine_cycle_id
           JOIN lapper.machines lm ON lm.id = c.machine_id
           JOIN lapper.gearsets g ON g.id = c.gearset_id
           JOIN lapper.macros m ON m.id = l.macro_id
          WHERE (lm.id = $1 OR lm.public_machine_id = $1) AND (g.id = $2 OR ${resolvedGearset} = $2)
       ) recorded
       WHERE previous_value IS DISTINCT FROM value AND ($5::uuid IS NULL OR machine_cycle_id = $5::uuid)
       ORDER BY timestamp DESC, machine_cycle_id DESC, number
       LIMIT $4`,
      [machineId, gearsetId, this.timeZone, limit, cycleId ?? null],
    );
    return rows.map((row: Row) => ({
      ...row, value: Number(row.value), previous_value: numberOrNull(row.previous_value),
      min_value: numberOrNull(row.min_value), max_value: numberOrNull(row.max_value),
    }));
  }

  /**
   * Latest value of each macro. With cycleId only that cycle's own records; with upToCycleId the
   * values as they stood when that cycle finished.
   */
  async summary(machineId: string, gearsetId: string, form?: string, cycleId?: string, upToCycleId?: string): Promise<Row[]> {
    const ranked = this.db
      .createQueryBuilder()
      .select('l.id', 'id')
      .addSelect('c.id', 'machine_cycle_id')
      .addSelect('m.id', 'macro_id')
      .addSelect('m.number', 'number')
      .addSelect('m.name', 'name')
      .addSelect('m.status', 'status')
      .addSelect('m.type', 'type')
      .addSelect('m.tab_index', 'tab_index')
      .addSelect('m.used_form', 'used_form')
      .addSelect('m.l60_table', 'l60_table')
      .addSelect('m.extra', 'extra')
      .addSelect('m.min_value', 'min_value')
      .addSelect('m.max_value', 'max_value')
      .addSelect('m.unit', 'unit')
      .addSelect('l.value', 'value')
      .addSelect(
        'ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY COALESCE(c.recorded_at,c.timestamp AT TIME ZONE :zone) DESC,c.id DESC,l.id DESC)',
        'rn',
      )
      .from('lapper.macro_logs', 'l')
      .innerJoin('(SELECT * FROM lapper.machine_cycles)', 'c', 'c.id=l.machine_cycle_id')
      .innerJoin('(SELECT * FROM lapper.machines)', 'lm', 'lm.id=c.machine_id')
      .innerJoin('(SELECT * FROM lapper.gearsets)', 'g', 'g.id=c.gearset_id')
      .innerJoin('(SELECT * FROM lapper.macros)', 'm', 'm.id=l.macro_id')
      .where('(lm.id=:machineId OR lm.public_machine_id=:machineId)', { machineId })
      .andWhere('(g.id=:gearsetId OR ' + resolvedGearset + '=:gearsetId)', { gearsetId })
      .setParameter('zone', this.timeZone);
    if (form) ranked.andWhere('m.used_form=:form', { form });
    if (cycleId) ranked.andWhere('c.id=:cycleId', { cycleId });
    if (upToCycleId)
      ranked.andWhere(
        `(COALESCE(c.recorded_at,c.timestamp AT TIME ZONE :zone), c.id) <= (SELECT COALESCE(u.recorded_at,u.timestamp AT TIME ZONE :zone), u.id
           FROM lapper.machine_cycles u WHERE u.id=:upToCycleId)`,
        { upToCycleId },
      );
    const rows = await this.db
      .createQueryBuilder()
      .select('*')
      .from('(' + ranked.getQuery() + ')', 'latest')
      .where('latest.rn=1')
      .orderBy('latest.tab_index', 'ASC')
      .addOrderBy('latest.number', 'ASC')
      .setParameters(ranked.getParameters())
      .getRawMany<Row>();
    return rows.map((row) => {
      const result: Row = {
        ...row,
        value: Number(row.value),
        min_value: numberOrNull(row.min_value),
        max_value: numberOrNull(row.max_value),
      };
      delete result.rn;
      return result;
    });
  }

  async gearsetsByMachine(machineId: string): Promise<Row[]> {
    const rows = await this.db
      .createQueryBuilder()
      .select(resolvedGearset, 'id')
      .distinct(true)
      .from('lapper.machine_cycles', 'c')
      .innerJoin('(SELECT * FROM lapper.machines)', 'm', 'm.id=c.machine_id')
      .innerJoin('(SELECT * FROM lapper.gearsets)', 'g', 'g.id=c.gearset_id')
      .where('(m.id=:id OR m.public_machine_id=:id)', { id: machineId })
      .getRawMany<Row>();
    const ids = new Set(rows.map((r) => r.id));
    return (await this.gearsets()).filter((g) => ids.has(g.id));
  }

  async machinesByGearset(gearsetId: string): Promise<Row[]> {
    const rows = await this.db
      .createQueryBuilder()
      .select('m.public_machine_id', 'id')
      .distinct(true)
      .from('lapper.machine_cycles', 'c')
      .innerJoin('(SELECT * FROM lapper.machines)', 'm', 'm.id=c.machine_id')
      .innerJoin('(SELECT * FROM lapper.gearsets)', 'g', 'g.id=c.gearset_id')
      .where('(g.id=:id OR ' + resolvedGearset + '=:id)', { id: gearsetId })
      .getRawMany<Row>();
    const ids = new Set(rows.map((r) => r.id));
    return (await this.machines()).filter((m) => ids.has(m.id));
  }

  async list(resource: Resource, manager = this.db.manager): Promise<Row[]> {
    switch (resource) {
      case 'machine':
        return this.machines(manager);
      case 'gearset':
        return this.gearsets(manager);
      case 'department':
        return this.departments(manager);
      case 'part':
        return this.parts(manager);
      case 'part-summary':
        return this.summaries(manager);
      case 'macro':
        return this.macros(manager);
      case 'scanner-detail':
        return this.scanners(manager);
      case 'machine-fanuc-variable':
        return this.variables(manager);
      case 'machine-cycle':
        return this.cycles({}, manager);
      case 'macro-log':
        return this.logs(undefined, manager);
    }
  }

  async one(resource: Resource, id: string, manager = this.db.manager): Promise<Row> {
    let row: Row | undefined;
    if (resource === 'machine-cycle') row = (await this.cycles({ id }, manager))[0];
    else if (resource === 'macro-log') row = (await this.logs(id, manager))[0];
    else {
      const rows = await this.list(resource, manager);
      row = rows.find((r) => r.id === id || r.legacy_id === id);
      if (!row && resource === 'gearset') {
        const reference = await manager
          .createQueryBuilder()
          .select('g.*')
          .from('lapper.gearsets', 'g')
          .where('g.id=:id', { id })
          .getRawOne<Row>();
        if (reference)
          row = reference.public_gearset_id
            ? rows.find((r) => r.id === reference.public_gearset_id)
            : rows.find(
                (r) =>
                  text(r.number).trim().toLowerCase() ===
                  text(reference.number).trim().toLowerCase(),
              );
      }
    }
    if (!row) throw new NotFoundException('Record not found');
    return row;
  }
}
