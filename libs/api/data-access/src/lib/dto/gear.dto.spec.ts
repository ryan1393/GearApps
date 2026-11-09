import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMachineCycleDto } from './gear.dto';

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
