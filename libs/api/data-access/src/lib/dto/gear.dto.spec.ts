import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateGearsetDto,
  CreateMachineCycleDto,
  CreateMacroLogDto,
  UpdateMacroDto,
  UpdateMacroLogDto,
  UpdateMachineFanucVariableDto,
} from './gear.dto';

describe('Imported SQL Server GUID compatibility', () => {
  const cycle = {
    machine_id: '01234567-89ab-cdef-0123-456789abcdef',
    gearset_id: 'fedcba98-7654-3210-fedc-ba9876543210',
    serial_number: 'TEST',
    consec: 1,
    timestamp: '2026-11-09T12:00:00Z',
  };

  it('accepts existing uniqueidentifier values without changing their IDs', async () => {
    const body = plainToInstance(CreateMachineCycleDto, cycle);
    expect(await validate(body)).toEqual([]);
    expect(body.machine_id).toBe(cycle.machine_id);
  });

  it('still rejects malformed identifiers', async () => {
    const body = plainToInstance(CreateMachineCycleDto, { ...cycle, machine_id: 'bad-id' });
    expect((await validate(body)).some((error) => error.property === 'machine_id')).toBe(true);
  });
});

describe('Machine cycle time', () => {
  const cycle = {
    machine_id: '01234567-89ab-cdef-0123-456789abcdef',
    gearset_id: 'fedcba98-7654-3210-fedc-ba9876543210',
    serial_number: 'TEST',
    consec: 1,
    timestamp: '2026-11-09T12:00:00Z',
  };
  const errors = async (extra: object) =>
    (await validate(plainToInstance(CreateMachineCycleDto, { ...cycle, ...extra }))).map((e) => e.property);

  it('is optional, so collectors that do not send it are still accepted', async () => {
    expect(await errors({})).toEqual([]);
    expect(await errors({ cycle_time_s: null })).toEqual([]);
  });

  it('accepts seconds to the millisecond', async () => {
    expect(await errors({ cycle_time_s: 124.25 })).toEqual([]);
    expect(await errors({ cycle_time_s: 0 })).toEqual([]);
  });

  it('rejects a negative, too long, too precise or non-numeric time', async () => {
    for (const bad of [-1, 86401, 1.2345, '90', Number.NaN]) {
      expect(await errors({ cycle_time_s: bad })).toEqual(['cycle_time_s']);
    }
  });
});

describe('Machine I/O running cycle time', () => {
  const errors = async (body: object) =>
    (await validate(plainToInstance(UpdateMachineFanucVariableDto, body))).map((e) => e.property);

  it('is optional, so collectors that do not send it are still accepted', async () => {
    expect(await errors({ y03_2_stack_inCycle: true })).toEqual([]);
  });

  it('accepts seconds, or null to clear it when the cycle ends or its start was not seen', async () => {
    expect(await errors({ y03_2_stack_inCycle: true, cycle_elapsed_s: 83.5 })).toEqual([]);
    expect(await errors({ y03_2_stack_inCycle: false, cycle_elapsed_s: null })).toEqual([]);
  });

  it('rejects a negative or longer-than-a-day time', async () => {
    for (const bad of [-1, 86401, '10']) {
      expect(await errors({ cycle_elapsed_s: bad })).toEqual(['cycle_elapsed_s']);
    }
  });
});

describe('Macro flag changes', () => {
  const errors = async (body: object) =>
    (await validate(plainToInstance(UpdateMacroDto, body))).map((e) => e.property);

  it('is optional and takes true or false', async () => {
    expect(await errors({ name: 'Torque' })).toEqual([]);
    expect(await errors({ flag_changes: false })).toEqual([]);
    expect(await errors({ flag_changes: true })).toEqual([]);
  });

  it('rejects anything but a boolean', async () => {
    expect(await errors({ flag_changes: 'no' })).toEqual(['flag_changes']);
  });
});

describe('Values bounded by their database column', () => {
  const log = { machine_cycle_id: '01234567-89ab-cdef-0123-456789abcdef', macro_id: 'fedcba98-7654-3210-fedc-ba9876543210' };
  const logErrors = async (value: unknown) => validate(plainToInstance(CreateMacroLogDto, { ...log, value }));

  it('accepts macro values numeric(13,5) stores, rounding extra decimal places as before', async () => {
    for (const value of [0, -12.34567, 99999999.99999, -99999999.99999, 1.234567891, 12]) {
      expect(await logErrors(value)).toEqual([]);
    }
  });

  it('refuses macro values numeric(13,5) cannot store, with a clear message', async () => {
    for (const value of [1e8, -1e8, 123456789, 99999999.999996, Number.POSITIVE_INFINITY, Number.NaN]) {
      const errors = await logErrors(value);
      expect(errors.map((e) => e.property)).toEqual(['value']);
    }
    const [error] = await logErrors(1e8);
    expect(Object.values(error.constraints ?? {})).toContain(
      'value must be a number between -99999999.99999 and 99999999.99999 (stored with 5 decimal places; further places are rounded)',
    );
    const [update] = await validate(plainToInstance(UpdateMacroLogDto, { value: 1e9 }));
    expect(update.property).toBe('value');
  });

  it('bounds macro limits like macro values', async () => {
    const errors = async (body: object) => (await validate(plainToInstance(UpdateMacroDto, body))).map((e) => e.property);
    expect(await errors({ min_value: -5, max_value: 99999999 })).toEqual([]);
    expect(await errors({ max_value: 1e8 })).toEqual(['max_value']);
    expect(await errors({ min_value: -1e8 })).toEqual(['min_value']);
  });

  it('keeps the consec counter within a PostgreSQL integer', async () => {
    const cycle = {
      machine_id: '01234567-89ab-cdef-0123-456789abcdef',
      gearset_id: 'fedcba98-7654-3210-fedc-ba9876543210',
      serial_number: 'TEST',
      timestamp: '2026-11-09T12:00:00Z',
    };
    const errors = async (consec: number) =>
      (await validate(plainToInstance(CreateMachineCycleDto, { ...cycle, consec }))).map((e) => e.property);
    expect(await errors(2_147_483_647)).toEqual([]);
    expect(await errors(2_147_483_648)).toEqual(['consec']);
  });

  it('keeps a gearset ratio within numeric(20,8)', async () => {
    const errors = async (ratio: number) =>
      (await validate(plainToInstance(CreateGearsetDto, { number: '410', status: 'active', ratio }))).map((e) => e.property);
    expect(await errors(3.73)).toEqual([]);
    expect(await errors(1e12)).toEqual(['ratio']);
  });
});
