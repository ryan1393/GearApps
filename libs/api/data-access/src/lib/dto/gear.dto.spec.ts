import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMachineCycleDto, UpdateMachineFanucVariableDto } from './gear.dto';

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
