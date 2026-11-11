import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCycleTestDto } from './cycle-test.dto';

describe('CreateCycleTestDto', () => {
  const test = {
    machine_id: '01234567-89ab-cdef-0123-456789abcdef',
    gearset_id: 'fedcba98-7654-3210-fedc-ba9876543210',
    serial_number: 'DD1A6BB0T6',
    values: { '500': 1 },
  };

  it('accepts imported SQL Server machine and gearset IDs', async () => {
    expect(await validate(plainToInstance(CreateCycleTestDto, test))).toEqual([]);
  });

  it('still rejects malformed identifiers', async () => {
    const errors = await validate(plainToInstance(CreateCycleTestDto, { ...test, machine_id: 'bad-id' }));
    expect(errors.some((error) => error.property === 'machine_id')).toBe(true);
  });
});
