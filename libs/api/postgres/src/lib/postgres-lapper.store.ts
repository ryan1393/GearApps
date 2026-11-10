import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { PostgresLapperCatalog, Resource, Row, text } from './catalog';
import { migrateLapperPostgres } from './schema';

const columns: Partial<Record<Resource, string[]>> = {
  macro: ['number', 'name', 'status', 'type', 'tab_index', 'used_form', 'l60_table', 'extra'],
  'scanner-detail': [
    'model',
    'type',
    'description',
    'sn_procces',
    'sn_queue',
    'sn_scanner',
    'status',
    'ip',
  ],
  'machine-fanuc-variable': ['x06_7_frt_dr_closed', 'x01_2_start_cycle', 'y03_2_stack_inCycle'],
  toc: ['name', 'description'],
  'gearset-marriage': ['rev', 'gearset_id', 'pinion_id', 'ring_id'],
};
const tables: Partial<Record<Resource, string>> = {
  macro: 'lapper.macros',
  'scanner-detail': 'lapper.scanners',
  'machine-fanuc-variable': 'lapper.machine_fanuc_variables',
  'machine-cycle': 'lapper.machine_cycles',
  'macro-log': 'lapper.macro_logs',
  toc: 'lapper.type_of_checks',
  'gearset-marriage': 'lapper.gearset_marriages',
  machine: 'lapper.machines',
  gearset: 'lapper.gearsets',
};
const localTable = (kind: Resource): string => {
  const table = tables[kind];
  if (!table) throw new BadRequestException('Unsupported Lapper resource');
  return table;
};
const pick = (data: Row, names: readonly string[]): Row =>
  Object.fromEntries(names.filter((n) => data[n] !== undefined).map((n) => [n, data[n]]));
const normalize = (value: unknown): unknown =>
  value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, normalize(v)]),
          )
        : value;
export const ingestFingerprint = (body: Row): string =>
  createHash('sha256')
    .update(JSON.stringify(normalize(body)))
    .digest('hex');

@Injectable()
export class PostgresLapperStore implements OnApplicationBootstrap {
  constructor(readonly catalog: PostgresLapperCatalog) {}
  async onApplicationBootstrap(): Promise<void> {
    await migrateLapperPostgres(this.catalog.db);
  }
  list(kind: Resource): Promise<Row[]> {
    return this.catalog.list(kind);
  }
  one(kind: Resource, id: string): Promise<Row> {
    return this.catalog.one(kind, id);
  }

  async create(kind: Resource, data: Row, key?: string): Promise<Row> {
    return this.catalog.db.transaction(async (manager) =>
      this.withRequestKey(manager, kind, data, key, async () => {
        const id = await this.write(manager, kind, undefined, data, false);
        return this.catalog.one(kind, id, manager);
      }),
    );
  }
  async update(kind: Resource, id: string, data: Row, upsert = false): Promise<Row> {
    if (data.id && data.id !== id) throw new BadRequestException('Body id does not match URL id');
    return this.catalog.db.transaction(async (manager) => {
      let existing: Row | undefined;
      try {
        existing = await this.catalog.one(kind, id, manager);
      } catch (error) {
        if (!upsert || !(error instanceof NotFoundException)) throw error;
      }
      const needsContext = [
        'machine',
        'machine-cycle',
        'part',
        'part-summary',
        'department',
        'gearset-marriage',
      ].includes(kind);
      const effectiveId =
        existing && ['machine-cycle', 'macro-log'].includes(kind) ? text(existing.id) : id;
      const saved = await this.write(
        manager,
        kind,
        effectiveId,
        needsContext ? { ...existing, ...data } : data,
        true,
      );
      return this.catalog.one(kind, saved, manager);
    });
  }

  private async withRequestKey(
    manager: EntityManager,
    kind: Resource,
    body: Row,
    key: string | undefined,
    write: () => Promise<Row>,
  ): Promise<Row> {
    if (!key || !['machine-cycle', 'macro-log'].includes(kind)) return write();
    if (key.length > 160 || !/^[\x21-\x7e]+$/.test(key))
      throw new BadRequestException('Invalid Idempotency-Key');
    const scope = 'POST:' + kind;
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      scope + ':' + key,
    ]);
    const previous = await manager
      .createQueryBuilder()
      .select('r.*')
      .from('lapper.ingest_requests', 'r')
      .where('r.scope=:scope AND r.request_key=:key', { scope, key })
      .getRawOne<Row>();
    const fingerprint = ingestFingerprint(body);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new ConflictException('Idempotency-Key was already used for different data');
      return previous.response as Row;
    }
    const result = await write();
    await manager
      .createQueryBuilder()
      .insert()
      .into('lapper.ingest_requests')
      .values({ scope, request_key: key, fingerprint, response: JSON.stringify(result) })
      .execute();
    return result;
  }

  private async gearReference(manager: EntityManager, apiId: string): Promise<Row> {
    const publicGear = await manager
      .createQueryBuilder()
      .select('g.*')
      .addSelect('p.part_number', 'number')
      .from('public.gearsets', 'g')
      .innerJoin('(SELECT * FROM public.parts)', 'p', 'p.id=g.gearset_part_id')
      .where('g.id=:id', { id: apiId })
      .getRawOne<Row>();
    const query = manager
      .createQueryBuilder()
      .select('g.*')
      .from('lapper.gearsets', 'g')
      .where('(g.id=:id OR g.public_gearset_id=:id)', { id: apiId });
    if (publicGear)
      query.orWhere(
        '(g.public_gearset_id IS NULL AND lower(btrim(g.number))=lower(btrim(:number)))',
        { number: publicGear.number },
      );
    const existing = await query.orderBy('g.id', 'ASC').getRawOne<Row>();
    if (existing) {
      if (publicGear && !existing.public_gearset_id) {
        await manager
          .createQueryBuilder()
          .update('lapper.gearsets')
          .set({ public_gearset_id: publicGear.id })
          .where('id=:id', { id: existing.id })
          .execute();
      }
      return existing;
    }
    if (!publicGear) throw new NotFoundException('Gearset not found');
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'lapper-gear:' + apiId,
    ]);
    const values = {
      id: apiId,
      number: publicGear.number,
      rev: null,
      ratio: publicGear.ratio_value,
      status: publicGear.active && publicGear.enabled ? 'active' : 'inactive',
      public_gearset_id: apiId,
    };
    await manager
      .createQueryBuilder()
      .insert()
      .into('lapper.gearsets')
      .values(values)
      .orIgnore()
      .execute();
    return values;
  }

  private async write(
    manager: EntityManager,
    kind: Resource,
    id: string | undefined,
    data: Row,
    upsert: boolean,
  ): Promise<string> {
    if (kind === 'machine') return this.writeMachine(manager, id, data);
    if (kind === 'gearset') return this.writeGearset(manager, id, data);
    if (kind === 'gearset-marriage') return this.writeMarriage(manager, id, data);
    if (['department', 'part', 'part-summary'].includes(kind))
      return this.writeMaster(manager, kind, id, data);
    const table = localTable(kind);
    const rowId = id ?? randomUUID();
    const exists = id
      ? await manager
          .createQueryBuilder()
          .select('r.id')
          .from(table, 'r')
          .where('r.id=:id', { id })
          .getRawOne()
      : null;
    let values: Row = pick(data, columns[kind] ?? []);
    if (kind === 'machine-cycle') {
      const machine = await this.catalog.legacyMachine(text(data.machine_id), manager);
      const gear = await this.gearReference(manager, text(data.gearset_id));
      const timestamp = new Date(
        data.timestamp instanceof Date ? data.timestamp.getTime() : text(data.timestamp),
      );
      if (!Number.isFinite(timestamp.getTime()))
        throw new BadRequestException('A valid cycle timestamp is required');
      values = {
        machine_id: machine.id,
        gearset_id: gear.id,
        consec: data.consec,
        serial_number: data.serial_number ?? null,
        recorded_at: timestamp.toISOString(),
        timestamp: () => '(CAST(:recorded AS timestamptz) AT TIME ZONE :zone)',
      };
      if (exists)
        await manager
          .createQueryBuilder()
          .update(table)
          .set(values)
          .where('id=:id', { id: rowId })
          .setParameters({ recorded: timestamp.toISOString(), zone: this.catalog.timeZone })
          .execute();
      else
        await manager
          .createQueryBuilder()
          .insert()
          .into(table)
          .values({ id: rowId, ...values })
          .setParameters({ recorded: timestamp.toISOString(), zone: this.catalog.timeZone })
          .orIgnore()
          .execute();
      if (exists) return rowId;
      const saved = await manager
        .createQueryBuilder()
        .select('c.id', 'id')
        .from(table, 'c')
        .where(
          'c.machine_id=:machine AND c.gearset_id=:gear AND c.consec=:consec AND c.serial_number IS NOT DISTINCT FROM :serial',
          {
            machine: machine.id,
            gear: gear.id,
            consec: data.consec,
            serial: data.serial_number ?? null,
          },
        )
        .andWhere(
          'c.recorded_at=CAST(:recorded AS timestamptz) AND c.timestamp=(CAST(:recorded AS timestamptz) AT TIME ZONE :zone)',
          { recorded: timestamp.toISOString(), zone: this.catalog.timeZone },
        )
        .getRawOne<Row>();
      if (!saved) throw new ConflictException('Cycle could not be recorded');
      return text(saved.id);
    }
    if (kind === 'macro-log') {
      if (exists) {
        await manager
          .createQueryBuilder()
          .update(table)
          .set(pick(data, ['value']))
          .where('id=:id', { id: rowId })
          .execute();
        return rowId;
      }
      const cycle = await manager
        .createQueryBuilder()
        .select('c.id', 'id')
        .from('lapper.machine_cycles', 'c')
        .where(
          'c.id=COALESCE((SELECT a.canonical_id FROM lapper.machine_cycle_aliases a WHERE a.original_id=:id),CAST(:id AS uuid))',
          { id: data.machine_cycle_id },
        )
        .getRawOne<Row>();
      const macro = await manager
        .createQueryBuilder()
        .select('m.id')
        .from('lapper.macros', 'm')
        .where('m.id=:id', { id: data.macro_id })
        .getRawOne();
      if (!cycle || !macro) throw new BadRequestException('Cycle and macro must exist');
      values = { machine_cycle_id: cycle.id, macro_id: data.macro_id, value: data.value };
      await manager
        .createQueryBuilder()
        .insert()
        .into(table)
        .values({ id: rowId, ...values })
        .orIgnore()
        .execute();
      const saved = await manager
        .createQueryBuilder()
        .select('l.id', 'id')
        .from(table, 'l')
        .where(
          'l.machine_cycle_id=:cycle AND l.macro_id=:macro AND l.value=CAST(:value AS numeric(13,5))',
          { cycle: cycle.id, macro: data.macro_id, value: data.value },
        )
        .getRawOne<Row>();
      if (!saved)
        throw new ConflictException('This cycle already has a different value for that macro');
      return text(saved.id);
    }
    if (kind === 'scanner-detail' && data.machine_id !== undefined) {
      values.machine_id =
        data.machine_id === null
          ? null
          : (await this.catalog.legacyMachine(text(data.machine_id), manager)).id;
    }
    if (kind === 'machine-fanuc-variable' && !exists) {
      const machine = await this.catalog.legacyMachine(text(data.machine_id), manager);
      values.machine_id = machine.id;
      const defaults = {
        x06_7_frt_dr_closed: false,
        x01_2_start_cycle: false,
        y03_2_stack_inCycle: false,
      };
      await manager
        .createQueryBuilder()
        .insert()
        .into(table)
        .values({ id: rowId, ...defaults, ...values })
        .orIgnore()
        .execute();
      const saved = await manager
        .createQueryBuilder()
        .select('r.id', 'id')
        .from(table, 'r')
        .where('r.machine_id=:id', { id: machine.id })
        .getRawOne<Row>();
      if (!saved) throw new ConflictException('Machine snapshot could not be created');
      return text(saved.id);
    }
    if (exists)
      await manager
        .createQueryBuilder()
        .update(table)
        .set(values)
        .where('id=:id', { id: rowId })
        .execute();
    else if (upsert || !id)
      await manager
        .createQueryBuilder()
        .insert()
        .into(table)
        .values({ id: rowId, ...values })
        .execute();
    else throw new NotFoundException('Record not found');
    return rowId;
  }

  private async writeGearset(
    manager: EntityManager,
    id: string | undefined,
    data: Row,
  ): Promise<string> {
    if (id) {
      const ref = await this.gearReference(manager, id);
      await manager
        .createQueryBuilder()
        .update('lapper.gearsets')
        .set(pick(data, ['rev', 'status', 'user_id']))
        .where('id=:id', { id: ref.id })
        .execute();
      return id;
    }
    const name = text(data.number).trim();
    if (!name) throw new BadRequestException('Gearset number is required');
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'lapper-gear-number:' + name.toLowerCase(),
    ]);
    const existing = (await this.catalog.gearsets(manager)).find(
      (g) => text(g.number).trim().toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      const master = await manager
        .createQueryBuilder()
        .select('g.id', 'id')
        .from('public.gearsets', 'g')
        .where('g.id=:id', { id: existing.id })
        .getRawOne<Row>();
      if (!master && (data.ring_id || data.pinion_id)) {
        const assembly = await this.createAssembly(manager, name, data);
        await manager
          .createQueryBuilder()
          .update('lapper.gearsets')
          .set({ public_gearset_id: assembly, ...pick(data, ['rev', 'status', 'user_id']) })
          .where('id=:id', { id: existing.id })
          .execute();
        return assembly;
      }
      return text(existing.id);
    }
    if (data.ring_id || data.pinion_id) {
      const assembly = await this.createAssembly(manager, name, data);
      await manager
        .createQueryBuilder()
        .insert()
        .into('lapper.gearsets')
        .values({
          id: assembly,
          number: name,
          public_gearset_id: assembly,
          ratio: data.ratio ?? null,
          status: data.status ?? 'active',
          ...pick(data, ['rev', 'user_id']),
        })
        .execute();
      return assembly;
    }
    const rowId = randomUUID();
    await manager
      .createQueryBuilder()
      .insert()
      .into('lapper.gearsets')
      .values({
        id: rowId,
        number: name,
        status: 'active',
        ...pick(data, ['rev', 'ratio', 'status', 'summary_id', 'ring_id', 'pinion_id', 'user_id']),
      })
      .execute();
    return rowId;
  }

  private async createAssembly(manager: EntityManager, name: string, data: Row): Promise<string> {
    const parts = await manager
      .createQueryBuilder()
      .select('p.*')
      .addSelect('t.code', 'type_code')
      .from('public.parts', 'p')
      .innerJoin('(SELECT * FROM public.part_types)', 't', 't.id=p.part_type_id')
      .where('(p.id=:ring OR p.id=:pinion)', {
        ring: data.ring_id ?? null,
        pinion: data.pinion_id ?? null,
      })
      .getRawMany<Row>();
    const ring = parts.find((p) => p.id === data.ring_id && p.type_code === 'RING');
    const pinion = parts.find((p) => p.id === data.pinion_id && p.type_code === 'PINION');
    if (
      !ring ||
      !pinion ||
      !ring.active ||
      !ring.enabled ||
      ring.deletedAt ||
      !pinion.active ||
      !pinion.enabled ||
      pinion.deletedAt
    )
      throw new BadRequestException('Select an active ring and pinion');
    const summaryId = data.summary_id ?? ring.summary_id;
    const summaries = await manager
      .createQueryBuilder()
      .select('s.id', 'id')
      .addSelect('s.number', 'number')
      .from('public.part_summaries', 's')
      .where('s.id IN (:...ids)', { ids: [ring.summary_id, pinion.summary_id, summaryId] })
      .getRawMany<Row>();
    const family = (id: unknown) =>
      text(summaries.find((s) => s.id === id)?.number)
        .trim()
        .toLowerCase();
    if (
      !family(summaryId) ||
      family(ring.summary_id) !== family(summaryId) ||
      family(pinion.summary_id) !== family(summaryId)
    )
      throw new BadRequestException(
        'Ring, pinion and gearset must use the same summary number; revisions may differ',
      );
    if (Number(ring.teeth) <= 0 || Number(pinion.teeth) <= 0)
      throw new BadRequestException('Ring and pinion require positive tooth counts');
    const ratio = Number((Number(ring.teeth) / Number(pinion.teeth)).toFixed(4));
    if (data.ratio != null && Math.abs(Number(data.ratio) - ratio) > 0.0001)
      throw new BadRequestException('Ratio must match ring and pinion tooth counts');
    const type = await manager
      .createQueryBuilder()
      .select('t.id', 'id')
      .from('public.part_types', 't')
      .where("t.code='GEARSET'")
      .getRawOne<Row>();
    if (!type) throw new BadRequestException('GearApps gearset part type is missing');
    const oldPart = await manager
      .createQueryBuilder()
      .select('p.id')
      .from('public.parts', 'p')
      .where('lower(btrim(p.part_number))=lower(btrim(:name)) AND p.part_type_id=:type', {
        name,
        type: type.id,
      })
      .getRawOne();
    if (oldPart)
      throw new ConflictException(
        'A gearset part with this number already exists. Complete its assembly in GearApps.',
      );
    const partId = randomUUID();
    const gearId = randomUUID();
    const active = text(data.status ?? 'active').toLowerCase() === 'active';
    await manager
      .createQueryBuilder()
      .insert()
      .into('public.parts')
      .values({
        id: partId,
        part_number: name,
        part_type_id: type.id,
        summary_id: summaryId,
        teeth: null,
        active,
        enabled: true,
        createdBy: data.user_id ?? null,
        updatedBy: data.user_id ?? null,
      })
      .execute();
    await manager
      .createQueryBuilder()
      .insert()
      .into('public.gearsets')
      .values({
        id: gearId,
        gearset_part_id: partId,
        ring_part_id: ring.id,
        pinion_part_id: pinion.id,
        summary_id: summaryId,
        ratio_value: ratio,
        ratio_text: ratio.toFixed(2) + ' (' + ring.teeth + '-' + pinion.teeth + ')',
        active,
        enabled: true,
        created_by: data.user_id ?? null,
        updated_by: data.user_id ?? null,
      })
      .execute();
    return gearId;
  }

  private async writeMarriage(
    manager: EntityManager,
    id: string | undefined,
    data: Row,
  ): Promise<string> {
    const gear = await manager
      .createQueryBuilder()
      .select('g.*')
      .from('public.gearsets', 'g')
      .where(id ? 'g.id=:id' : 'g.gearset_part_id=:id', { id: id ?? data.gearset_id })
      .getRawOne<Row>();
    if (!gear)
      throw new BadRequestException(
        'Create the complete assembly using Gearsets or GearApps master data',
      );
    if (
      (data.ring_id && data.ring_id !== gear.ring_part_id) ||
      (data.pinion_id && data.pinion_id !== gear.pinion_part_id)
    )
      throw new ConflictException('Assembly components must match GearApps master data');
    await manager
      .createQueryBuilder()
      .insert()
      .into('lapper.gearset_marriages')
      .values({
        id: gear.id,
        gearset_id: gear.gearset_part_id,
        ring_id: gear.ring_part_id,
        pinion_id: gear.pinion_part_id,
        rev: data.rev ?? null,
      })
      .orUpdate(['rev'], ['id'])
      .execute();
    return text(gear.id);
  }

  private async writeMachine(
    manager: EntityManager,
    id: string | undefined,
    data: Row,
  ): Promise<string> {
    let profile = id
      ? await manager
          .createQueryBuilder()
          .select('m.*')
          .from('lapper.machines', 'm')
          .where('(m.id=:id OR m.public_machine_id=:id)', { id })
          .getRawOne<Row>()
      : undefined;
    const profileId = profile?.id;
    const current = profile
      ? (await this.catalog.machines(manager, false)).find((m) => m.legacy_id === profileId)
      : undefined;
    const name = text(data.number ?? current?.number).trim();
    if (!name) throw new BadRequestException('Machine asset number is required');
    if (current && name !== current.number)
      throw new ConflictException('Change machine asset numbers in GearApps master data');
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'lapper-machine-number:' + name.toLowerCase(),
    ]);
    let master = await manager
      .createQueryBuilder()
      .select('m.*')
      .from('public.machines', 'm')
      .where('lower(btrim(m.machine_number))=lower(btrim(:number))', { number: name })
      .getRawOne<Row>();
    const departmentCode = text(data.dept_id ?? current?.dept_id ?? '181');
    const department = await manager
      .createQueryBuilder()
      .select('d.id', 'id')
      .from('public.departments', 'd')
      .where('(d.code=:code OR d.id::text=:code)', { code: departmentCode })
      .getRawOne<Row>();
    if (!department) throw new BadRequestException('Choose an existing GearApps department');
    const active = text(data.status ?? current?.status ?? 'active').toLowerCase() === 'active';
    const cell = data.cell === undefined ? current?.cell : data.cell;
    const parsedCell = cell == null || cell === '' ? null : Number(cell);
    if (parsedCell !== null && (!Number.isSafeInteger(parsedCell) || parsedCell < 0))
      throw new BadRequestException('Cell must be a non-negative integer');
    if (!master) {
      const masterId = id ?? randomUUID();
      await manager
        .createQueryBuilder()
        .insert()
        .into('public.machines')
        .values({
          id: masterId,
          machine_number: name,
          department_id: department.id,
          cell: parsedCell,
          description: data.description ?? null,
          active,
          enabled: true,
          machine_type: 'PRODUCTION',
        })
        .execute();
      master = { id: masterId, department_id: department.id };
    } else if (profile) {
      // Department changes must go through manufacturing's compatibility workflow.
      if (master.department_id !== department.id)
        throw new ConflictException('Change the machine department in GearApps master data');
      await manager
        .createQueryBuilder()
        .update('public.machines')
        .set({ cell: parsedCell, ...pick(data, ['description']) })
        .where('id=:id', { id: master.id })
        .execute();
    }
    const existingProfile = await manager
      .createQueryBuilder()
      .select('m.*')
      .from('lapper.machines', 'm')
      .where('m.public_machine_id=:id', { id: master.id })
      .getRawOne<Row>();
    profile = profile ?? existingProfile;
    const legacyId = text(profile?.id ?? master.id);
    const fields = {
      number: name,
      dept_id: departmentCode,
      cell: parsedCell == null ? null : text(parsedCell),
      ...pick(data, ['description', 'type', 'builder', 'status']),
      machine_ip: data.ip ?? profile?.machine_ip ?? '',
      public_machine_id: master.id,
    };
    if (!text(fields.machine_ip)) throw new BadRequestException('Machine IP address is required');
    if (profile)
      await manager
        .createQueryBuilder()
        .update('lapper.machines')
        .set(fields)
        .where('id=:id', { id: legacyId })
        .execute();
    else
      await manager
        .createQueryBuilder()
        .insert()
        .into('lapper.machines')
        .values({ id: legacyId, status: 'active', scanner_ip: '', ...fields })
        .execute();
    if (data.scanner_id !== undefined) {
      await manager
        .createQueryBuilder()
        .update('lapper.scanners')
        .set({ machine_id: null })
        .where('machine_id=:id', { id: legacyId })
        .execute();
      if (data.scanner_id !== null) {
        const scanner = await manager
          .createQueryBuilder()
          .select('s.*')
          .from('lapper.scanners', 's')
          .where('s.id=:id', { id: data.scanner_id })
          .getRawOne<Row>();
        if (!scanner || (scanner.machine_id && scanner.machine_id !== legacyId))
          throw new ConflictException('Scanner is assigned to another machine');
        await manager
          .createQueryBuilder()
          .update('lapper.scanners')
          .set({ machine_id: legacyId })
          .where('id=:id', { id: scanner.id })
          .execute();
      }
    }
    return text(master.id);
  }

  private async writeMaster(
    manager: EntityManager,
    kind: Resource,
    id: string | undefined,
    data: Row,
  ): Promise<string> {
    const rowId = id ?? randomUUID();
    const table =
      kind === 'department'
        ? 'public.departments'
        : kind === 'part-summary'
          ? 'public.part_summaries'
          : 'public.parts';
    const current = id
      ? await manager
          .createQueryBuilder()
          .select('r.*')
          .from(table, 'r')
          .where('r.id=:id', { id })
          .getRawOne<Row>()
      : undefined;
    const active = text(data.status ?? 'active').toLowerCase() === 'active';
    let values: Row;
    if (kind === 'department') values = { code: text(data.number), description: data.description };
    else if (kind === 'part-summary') {
      values = { ...pick(data, ['number', 'hos']), active, enabled: active };
      if (data.model !== undefined && (data.model !== '' || current?.model_id != null)) {
        const model = await manager
          .createQueryBuilder()
          .select('m.id', 'id')
          .from('public.models', 'm')
          .where('m.model_number::text=:number', { number: text(data.model) })
          .getRawOne<Row>();
        if (!model) throw new BadRequestException('Choose an existing GearApps model number');
        values.model_id = model.id;
      }
      if (
        current &&
        ((data.number !== undefined && data.number !== current.number) ||
          (values.model_id !== undefined && values.model_id !== current.model_id))
      )
        throw new ConflictException('Change summary identity and model in GearApps master data');
    } else {
      const summaryId = data.summary_id ?? current?.summary_id;
      if (!summaryId) throw new BadRequestException('Choose a GearApps part summary');
      const type = data.type
        ? await manager
            .createQueryBuilder()
            .select('t.*')
            .from('public.part_types', 't')
            .where('upper(t.code)=:code', { code: text(data.type).toUpperCase() })
            .getRawOne<Row>()
        : undefined;
      if (!current && !type) throw new BadRequestException('Choose Ring, Pinion or Gearset');
      if (
        current &&
        ((type && type.id !== current.part_type_id) ||
          (data.number !== undefined && data.number !== current.part_number))
      )
        throw new ConflictException('Change part identity and type in GearApps master data');
      const currentType = current
        ? await manager
            .createQueryBuilder()
            .select('t.code', 'code')
            .from('public.part_types', 't')
            .where('t.id=:id', { id: current.part_type_id })
            .getRawOne<Row>()
        : undefined;
      const isGearset = (type?.code ?? currentType?.code) === 'GEARSET';
      const teeth = isGearset ? null : data.teeth === undefined ? current?.teeth : data.teeth;
      if (type?.code === 'GEARSET' && !current)
        throw new BadRequestException(
          'Create complete gearset assemblies in GearApps master data; they are immediately available in Lapper',
        );
      if (
        teeth !== null &&
        teeth !== undefined &&
        (!Number.isSafeInteger(Number(teeth)) || Number(teeth) <= 0)
      )
        throw new BadRequestException('Tooth count must be a positive integer');
      if (
        current &&
        (summaryId !== current.summary_id ||
          (!isGearset && data.teeth !== undefined && Number(teeth) !== Number(current.teeth)))
      ) {
        const linked = await manager
          .createQueryBuilder()
          .select('g.id')
          .from('public.gearsets', 'g')
          .where('(g.ring_part_id=:id OR g.pinion_part_id=:id OR g.gearset_part_id=:id)', {
            id: rowId,
          })
          .getRawOne();
        if (linked)
          throw new ConflictException(
            'Update parts used by gearset assemblies in GearApps master data',
          );
      }
      values = { summary_id: summaryId, teeth: teeth ?? null, active, enabled: active };
      if (data.number !== undefined) values.part_number = data.number;
      if (type) values.part_type_id = type.id;
    }
    const audit: Row = { updatedAt: new Date() };
    if (data.user_id) audit.updatedBy = data.user_id;
    if (current)
      await manager
        .createQueryBuilder()
        .update(table)
        .set({ ...values, ...audit })
        .where('id=:id', { id: rowId })
        .execute();
    else
      await manager
        .createQueryBuilder()
        .insert()
        .into(table)
        .values({ id: rowId, ...values, ...audit, createdBy: data.user_id ?? null })
        .execute();
    return rowId;
  }

  async remove(kind: Resource, id: string): Promise<void> {
    await this.catalog.db.transaction(async (manager) => {
      const record = await this.catalog.one(kind, id, manager);
      if (
        [
          'department',
          'part',
          'part-summary',
          'gearset-marriage',
          'machine-cycle',
          'macro-log',
        ].includes(kind)
      ) {
        // Shared manufacturing records are managed by its guarded workflows.
        throw new ConflictException(
          'Remove shared master data in GearApps so inventory and history checks run',
        );
      }
      if (kind === 'gearset') {
        const shared = await manager
          .createQueryBuilder()
          .select('g.id')
          .from('public.gearsets', 'g')
          .where('g.id=:id', { id: record.id })
          .getRawOne();
        if (shared)
          throw new ConflictException(
            'Remove shared gearsets in GearApps so inventory and history checks run',
          );
        const ref = await this.gearReference(manager, id);
        await manager
          .createQueryBuilder()
          .delete()
          .from('lapper.gearsets')
          .where('id=:id', { id: ref.id })
          .execute();
      } else if (kind === 'machine') {
        const ref = await this.catalog.legacyMachine(id, manager);
        await manager
          .createQueryBuilder()
          .delete()
          .from('lapper.machines')
          .where('id=:id', { id: ref.id })
          .execute();
      } else
        await manager
          .createQueryBuilder()
          .delete()
          .from(localTable(kind))
          .where('id=:id', { id })
          .execute();
    });
  }
}
