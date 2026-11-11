import { Machine } from '@meshforge/shared/domain';
import { groupByCell } from './cells';

const m = (number: string, cell: string | null, status = 'Active'): Machine =>
  ({
    id: number,
    number,
    cell,
    status,
    ip: '',
    dept_id: null,
    description: null,
    type: null,
    builder: null,
  }) as Machine;

describe('groupByCell', () => {
  it('groups numerically with unassigned last and counts active machines', () => {
    const cells = groupByCell([m('b', '10'), m('a', '3'), m('c', null), m('d', '3', 'Inactive')]);
    expect(cells.map((c) => c.id)).toEqual(['3', '10', 'Unassigned']);
    expect(cells[0].machines.map((x) => x.number)).toEqual(['a', 'd']);
    expect(cells[0].active).toBe(1);
  });
});
