import { Injectable } from '@angular/core';
import {
  CreateGearset,
  CreateMachine,
  CreateMachineCycle,
  CreatePart,
  CreateScannerDetail,
  CreateSummary,
  CycleHistoryPage,
  Department,
  Gearset,
  LappingChange,
  LappingSummaryRow,
  LapperProduction,
  Machine,
  MachineCycle,
  MachineFanucVariable,
  Macro,
  MacroForm,
  MacroLog,
  Part,
  ScannerDetail,
  Summary,
  UpdateGearset,
  UpdateMachine,
  UpdatePart,
  UpdateScannerDetail,
  UpdateSummary,
} from '@meshforge/shared/domain';
import { Observable } from 'rxjs';
import { CrudApi } from './crud-api';

@Injectable({ providedIn: 'root' })
export class MachinesApi extends CrudApi<Machine, CreateMachine, UpdateMachine> {
  constructor() {
    super('machine');
  }
  byGearset(gearsetId: string): Observable<Machine[]> {
    return this.http.get<Machine[]>(`${this.url}/gearset/${gearsetId}`);
  }
}

@Injectable({ providedIn: 'root' })
export class GearsetsApi extends CrudApi<Gearset, CreateGearset, UpdateGearset> {
  constructor() {
    super('gearset');
  }
  byMachine(machineId: string): Observable<Gearset[]> {
    return this.http.get<Gearset[]>(`${this.url}/machine/${machineId}`);
  }
}

@Injectable({ providedIn: 'root' })
export class PartsApi extends CrudApi<Part, CreatePart, UpdatePart> {
  constructor() {
    super('part');
  }
}

@Injectable({ providedIn: 'root' })
export class SummariesApi extends CrudApi<Summary, CreateSummary, UpdateSummary> {
  constructor() {
    super('part-summary');
  }
}

@Injectable({ providedIn: 'root' })
export class DepartmentsApi extends CrudApi<Department> {
  constructor() {
    super('department');
  }
}

@Injectable({ providedIn: 'root' })
export class ScannerDetailsApi extends CrudApi<
  ScannerDetail,
  CreateScannerDetail,
  UpdateScannerDetail
> {
  constructor() {
    super('scanner-detail');
  }
  byMachine(machineId: string): Observable<ScannerDetail> {
    return this.http.get<ScannerDetail>(`${this.url}/machine/${machineId}`);
  }
}

@Injectable({ providedIn: 'root' })
export class MachineCyclesApi extends CrudApi<MachineCycle, CreateMachineCycle> {
  constructor() {
    super('machine-cycle');
  }
  production(): Observable<LapperProduction> {
    return this.http.get<LapperProduction>(`${this.url}/production`);
  }
  history(machineId: string, gearsetId: string): Observable<MachineCycle[]> {
    return this.http.get<MachineCycle[]>(`${this.url}/history/${machineId}/${gearsetId}`);
  }
  historyPage(machineId: string, gearsetId: string, page: number, pageSize: number, serial?: string): Observable<CycleHistoryPage> {
    return this.http.get<CycleHistoryPage>(`${this.url}/history-page/${machineId}/${gearsetId}`, {
      params: { page, pageSize, ...(serial?.trim() ? { serial: serial.trim() } : {}) },
    });
  }
  latest(machineId: string, gearsetId: string): Observable<MachineCycle> {
    return this.http.get<MachineCycle>(`${this.url}/latest/${machineId}/${gearsetId}`);
  }
}

@Injectable({ providedIn: 'root' })
export class FanucVariablesApi extends CrudApi<MachineFanucVariable> {
  constructor() {
    super('machine-fanuc-variable');
  }
  byMachine(machineId: string): Observable<MachineFanucVariable> {
    return this.http.get<MachineFanucVariable>(`${this.url}/by-machine/${machineId}`);
  }
}

@Injectable({ providedIn: 'root' })
export class MacrosApi extends CrudApi<Macro> {
  constructor() {
    super('macro');
  }
}

@Injectable({ providedIn: 'root' })
export class MacroLogsApi extends CrudApi<MacroLog> {
  constructor() {
    super('macro-log');
  }
  /** Recently recorded macro values beside the values they replaced, newest first. */
  changes(machineId: string, gearsetId: string, cycleId?: string, limit = 500): Observable<LappingChange[]> {
    return this.http.get<LappingChange[]>(`${this.url}/changes/${machineId}/${gearsetId}`, {
      params: { limit, ...(cycleId ? { cycleId } : {}) },
    });
  }
  /** Latest value of each macro for a machine + gearset, optionally one form group. */
  lappingSummary(
    machineId: string,
    gearsetId: string,
    form?: MacroForm,
    cycleId?: string,
    upToCycleId?: string,
  ): Observable<LappingSummaryRow[]> {
    return this.http.get<LappingSummaryRow[]>(`${this.url}/summary/${machineId}/${gearsetId}`, {
      params: { ...(form ? { form } : {}), ...(cycleId ? { cycleId } : {}), ...(upToCycleId ? { upTo: upToCycleId } : {}) },
    });
  }
}
