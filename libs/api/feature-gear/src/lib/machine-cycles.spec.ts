import { BadRequestException } from '@nestjs/common';
import { MachineCyclesController, MachineCyclesService, RECENT_CYCLES_MAX } from './machine-cycles';

describe('GET machine-cycle/machine/:id?limit=', () => {
  const id = '9d9e0c7d-0000-4000-8000-000000000001';
  const findByMachine = jest.fn().mockResolvedValue([]);
  const controller = new MachineCyclesController({ findByMachine } as unknown as MachineCyclesService);
  beforeEach(() => findByMachine.mockClear());

  it('returns every cycle without a limit, as before', async () => {
    await controller.findByMachine(id);
    await controller.findByMachine(id, '');
    expect(findByMachine.mock.calls).toEqual([[id], [id]]);
  });

  it('keeps only the newest few, capped', async () => {
    await controller.findByMachine(id, '5');
    await controller.findByMachine(id, '100000');
    expect(findByMachine.mock.calls).toEqual([[id, 5], [id, RECENT_CYCLES_MAX]]);
  });

  it('refuses a limit that is not a whole number from 1', () => {
    for (const bad of ['0', '-3', '2.5', 'many']) expect(() => controller.findByMachine(id, bad)).toThrow(BadRequestException);
    expect(findByMachine).not.toHaveBeenCalled();
  });
});
