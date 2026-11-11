import {
  Department,
  Gearset,
  GearsetMarriage,
  Machine,
  MachineCycle,
  MachineFanucVariable,
  Macro,
  MacroLog,
  Part,
  ScannerDetail,
  Summary,
  TypeOfCheck,
} from '@meshforge/shared/domain';
import { EntitySchema } from 'typeorm';
import { bool, date, decimal, fk, int, manyToOne, num, str, uuidPrimary } from './column-helpers';

export const DepartmentEntity = new EntitySchema<Department>({
  name: 'Departments',
  columns: { id: uuidPrimary, number: int(), description: str() },
});

export const TypeOfCheckEntity = new EntitySchema<TypeOfCheck>({
  name: 'Type_Of_Checks',
  columns: { id: uuidPrimary, name: str(), description: str() },
});

export const SummaryEntity = new EntitySchema<Summary>({
  name: 'Summaries',
  columns: {
    id: uuidPrimary,
    number: str(),
    model: str(),
    hos: str(),
    status: str(),
    user_id: fk(),
  },
  relations: { user: manyToOne('Users', 'user_id') },
});

export const PartEntity = new EntitySchema<Part>({
  name: 'Parts',
  columns: {
    id: uuidPrimary,
    number: str(),
    type: str(),
    teeth: decimal(13, 2, true),
    status: str(),
    summary_id: fk(true),
    user_id: fk(),
  },
  relations: {
    summary: manyToOne('Summaries', 'summary_id', { nullable: true, eager: true }),
    user: manyToOne('Users', 'user_id', { eager: true }),
  },
});

export const GearsetEntity = new EntitySchema<Gearset>({
  name: 'Gearsets',
  columns: {
    id: uuidPrimary,
    number: str(),
    rev: str(true),
    ratio: num(true),
    status: str(),
    summary_id: fk(true),
    pinion_id: fk(true),
    ring_id: fk(true),
    user_id: fk(true),
  },
  relations: {
    summary: manyToOne('Summaries', 'summary_id', { nullable: true }),
    pinion: manyToOne('Parts', 'pinion_id', { nullable: true }),
    ring: manyToOne('Parts', 'ring_id', { nullable: true }),
    user: manyToOne('Users', 'user_id', { nullable: true }),
  },
});

export const GearsetMarriageEntity = new EntitySchema<GearsetMarriage>({
  name: 'GearsetMarriages',
  columns: {
    id: uuidPrimary,
    rev: str(true),
    gearset_id: fk(true),
    pinion_id: fk(true),
    ring_id: fk(true),
  },
  relations: {
    gearset: manyToOne('Parts', 'gearset_id', { nullable: true }),
    pinion: manyToOne('Parts', 'pinion_id', { nullable: true }),
    ring: manyToOne('Parts', 'ring_id', { nullable: true }),
  },
});

export const ScannerDetailEntity = new EntitySchema<ScannerDetail>({
  name: 'Scanners',
  columns: {
    id: uuidPrimary,
    ip: str(true),
    model: str(true),
    type: str(true),
    description: str(true),
    sn_procces: str(true),
    sn_queue: str(true),
    sn_scanner: str(true),
    status: str(),
    machine_id: fk(true),
  },
  relations: {
    machine: {
      type: 'one-to-one',
      target: 'Machines',
      joinColumn: { name: 'machine_id' },
      nullable: true,
      createForeignKeyConstraints: true,
    },
  },
});

export const MachineEntity = new EntitySchema<Machine>({
  name: 'Machines',
  columns: {
    id: uuidPrimary,
    number: str(true),
    ip: str(),
    dept_id: str(true),
    description: str(true),
    type: str(true),
    builder: str(true),
    cell: str(true),
    status: str(),
    scanner_id: fk(true),
  },
  relations: {
    scanner: {
      type: 'one-to-one',
      target: 'Scanners',
      joinColumn: { name: 'scanner_id' },
      nullable: true,
      createForeignKeyConstraints: true,
    },
  },
});

export const MachineCycleEntity = new EntitySchema<MachineCycle>({
  name: 'Machine_Cycles',
  columns: {
    id: uuidPrimary,
    serial_number: str(true),
    consec: int(),
    timestamp: date(),
    machine_id: fk(),
    gearset_id: fk(),
  },
  relations: {
    machine: manyToOne('Machines', 'machine_id'),
    gearset: manyToOne('Gearsets', 'gearset_id'),
  },
  indices: [{ columns: ['machine_id', 'gearset_id', 'timestamp'] }],
});

export const MachineFanucVariableEntity = new EntitySchema<MachineFanucVariable>({
  name: 'Machine_Fanuc_Variables',
  columns: {
    id: uuidPrimary,
    x06_7_frt_dr_closed: bool(),
    y03_2_stack_inCycle: bool(),
    x01_2_start_cycle: bool(),
    machine_id: fk(),
  },
  relations: { machine: manyToOne('Machines', 'machine_id') },
});

export const MacroEntity = new EntitySchema<Macro>({
  name: 'Macros',
  columns: {
    id: uuidPrimary,
    number: int(),
    name: str(),
    status: int(true),
    type: str(),
    tab_index: int(true),
    used_form: str(true),
    l60_table: str(),
    extra: str(true),
  },
  indices: [{ columns: ['used_form'] }],
});

export const MacroLogEntity = new EntitySchema<MacroLog>({
  name: 'Macro_Logs',
  columns: {
    id: uuidPrimary,
    value: decimal(13, 5),
    machine_cycle_id: fk(),
    macro_id: fk(),
  },
  relations: {
    machine_cycle: manyToOne('Machine_Cycles', 'machine_cycle_id', { onDelete: 'CASCADE' }),
    macro: manyToOne('Macros', 'macro_id'),
  },
});
