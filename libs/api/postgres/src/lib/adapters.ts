import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BaseEntity,
  Gearset,
  LappingSummaryRow,
  LapperProduction,
  SettingChanges,
  LappingChange,
  CycleHistoryPage,
  Machine,
  MachineCycle,
  MachineFanucVariable,
  Macro,
  MacroLog,
  ScannerDetail,
} from '@meshforge/shared/domain';
import { PostgresLapperStore } from './postgres-lapper.store';
import { CrudService } from '@meshforge/api/core';
import { Resource, Row } from './catalog';

const project = <T>(promise: Promise<unknown>): Promise<T> => promise as Promise<T>;
const body = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('A request body is required');
  return value as Row;
};

/** Public service port used by the unchanged, DTO-validated REST controllers. */
export class PostgresCrudAdapter<T extends BaseEntity> implements CrudService<T> {
  constructor(
    protected readonly store: PostgresLapperStore,
    private readonly resource: Resource,
  ) {}
  findAll(): Promise<T[]> {
    return project(this.store.list(this.resource));
  }
  findOne(id: string): Promise<T> {
    return project(this.store.one(this.resource, id));
  }
  create(data: unknown, key?: string): Promise<T> {
    return project(this.store.create(this.resource, body(data), key));
  }
  update(id: string, data: unknown): Promise<T> {
    return project(this.store.update(this.resource, id, body(data)));
  }
  upsert(id: string, data: unknown): Promise<T> {
    return project(this.store.update(this.resource, id, body(data), true));
  }
  remove(id: string): Promise<void> {
    return this.store.remove(this.resource, id);
  }
}

@Injectable()
export class PostgresMachines extends PostgresCrudAdapter<Machine> {
  constructor(store: PostgresLapperStore) {
    super(store, 'machine');
  }
  findByIp(ip: string, number?: string): Promise<Machine> {
    return project(this.store.catalog.machineByIp(ip, number));
  }
  findByGearset(id: string): Promise<Machine[]> {
    return project(this.store.catalog.machinesByGearset(id));
  }
}
@Injectable()
export class PostgresGearsets extends PostgresCrudAdapter<Gearset> {
  constructor(store: PostgresLapperStore) {
    super(store, 'gearset');
  }
  async findByNumber(number: string): Promise<Gearset> {
    const row = (await this.store.catalog.gearsets()).find(
      (g) => String(g.number).trim().toLowerCase() === number.trim().toLowerCase(),
    );
    if (!row) throw new NotFoundException('Gearset not found');
    return row as unknown as Gearset;
  }
  findByMachine(id: string): Promise<Gearset[]> {
    return project(this.store.catalog.gearsetsByMachine(id));
  }
}
@Injectable()
export class PostgresCycles extends PostgresCrudAdapter<MachineCycle> {
  constructor(store: PostgresLapperStore) {
    super(store, 'machine-cycle');
  }
  findPage(page: number, pageSize: number): Promise<MachineCycle[]> {
    return project(this.store.catalog.cyclePage(page, pageSize));
  }
  findByMachine(id: string, limit?: number): Promise<MachineCycle[]> {
    return project(this.store.catalog.cycles({ machineId: id, ...(limit ? { limit } : {}) }));
  }
  findByGearset(id: string): Promise<MachineCycle[]> {
    return project(this.store.catalog.cycles({ gearsetId: id }));
  }
  async production(): Promise<LapperProduction> {
    return this.store.catalog.production();
  }
  settingChanges(hours: number, limit: number): Promise<SettingChanges> {
    return project(this.store.catalog.settingChanges(hours, limit));
  }
  history(machineId: string, gearsetId: string): Promise<MachineCycle[]> {
    return project(this.store.catalog.cycles({ machineId, gearsetId, limit: 200 }));
  }
  historyPage(machineId: string, gearsetId: string, page: number, pageSize: number, serial?: string): Promise<CycleHistoryPage> {
    return project(this.store.catalog.historyPage(machineId, gearsetId, page, pageSize, serial));
  }
  async findLatest(machineId: string, gearsetId: string): Promise<MachineCycle> {
    const rows = await this.store.catalog.cycles({ machineId, gearsetId, latest: true });
    if (!rows.length) throw new NotFoundException('No cycles recorded for that machine/gearset');
    return rows[0] as unknown as MachineCycle;
  }
}
@Injectable()
export class PostgresLogs extends PostgresCrudAdapter<MacroLog> {
  constructor(store: PostgresLapperStore) {
    super(store, 'macro-log');
  }
  findPage(page: number, pageSize: number): Promise<MacroLog[]> {
    return project(this.store.catalog.logs(undefined, undefined, { page, pageSize }));
  }
  lappingSummary(machine: string, gearset: string, form?: string, cycleId?: string, upToCycleId?: string): Promise<LappingSummaryRow[]> {
    return project(this.store.catalog.summary(machine, gearset, form, cycleId, upToCycleId));
  }
  changes(machine: string, gearset: string, limit: number, cycleId?: string): Promise<LappingChange[]> {
    return project(this.store.catalog.changes(machine, gearset, limit, cycleId));
  }
}
@Injectable()
export class PostgresMacros extends PostgresCrudAdapter<Macro> {
  constructor(store: PostgresLapperStore) {
    super(store, 'macro');
  }
  async findByType(type: string): Promise<Macro[]> {
    return (await this.findAll()).filter((m) => m.type === type);
  }
  async findByForm(form: string): Promise<Macro[]> {
    return (await this.findAll()).filter((m) => m.used_form === form);
  }
}
@Injectable()
export class PostgresScanners extends PostgresCrudAdapter<ScannerDetail> {
  constructor(store: PostgresLapperStore) {
    super(store, 'scanner-detail');
  }
  async findByIp(ip: string): Promise<ScannerDetail> {
    const rows = (await this.findAll()).filter((s) => s.ip === ip);
    if (rows.length > 1) throw new ConflictException('Scanner IP is assigned more than once');
    if (!rows.length) throw new NotFoundException('Scanner not found');
    return rows[0];
  }
  async findByMachine(id: string): Promise<ScannerDetail> {
    const row = (await this.findAll()).find((s) => s.machine_id === id);
    if (!row) throw new NotFoundException('No scanner assigned to machine');
    return row;
  }
}
@Injectable()
export class PostgresVariables extends PostgresCrudAdapter<MachineFanucVariable> {
  constructor(store: PostgresLapperStore) {
    super(store, 'machine-fanuc-variable');
  }
  async findByMachine(id: string): Promise<MachineFanucVariable> {
    const machine = await this.store.catalog.one('machine', id);
    const row = (await this.findAll()).find((v) => v.machine_id === machine.id);
    if (!row) throw new NotFoundException('No machine snapshot recorded');
    return row;
  }
}
