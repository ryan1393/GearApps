import { findUniqueMatches, trailingMachineNumber, UniqueMatchInput, UniqueMatchSource } from './dsf-unique-matches';

const source = (mapping_id: string, department: string, whiteboard_name: string, changes: Partial<UniqueMatchSource> = {}): UniqueMatchSource => ({
  mapping_id, department, whiteboard_name, line_name: 'Line ' + whiteboard_name,
  mapping_active: true, whiteboard_active: true, operation_line_matches: true, running_reasons: 1, ...changes,
});
const machine = (machine_id: string, machine_number: string, department = '132', active = true) => ({ machine_id, machine_number, department, active });
const input = (changes: Partial<UniqueMatchInput>): UniqueMatchInput => ({
  machines: [], sources: [], adminDecided: new Set(), assigned: new Map(), withHistory: new Set(), ...changes,
});

describe('DSF unique matches', () => {
  it('reads the machine number a whiteboard name ends in', () => {
    expect(trailingMachineNumber('132 PIN CUTTER 549')).toBe('549');
    expect(trailingMachineNumber('152 RING CUTTER 554 ')).toBe('554');
    expect(trailingMachineNumber('GRINDER')).toBeNull();
  });

  it('maps a machine to the only eligible source in its department ending in its number', () => {
    const result = findUniqueMatches(input({
      machines: [machine('m549', '549'), machine('m554', '554', '152')],
      sources: [source('s549', '132', '132 PIN CUTTER 549'), source('s554', '152', '152 RING CUTTER 554'), source('x', '152', '152 RING CUTTER 549')],
    }));
    expect(result.matches.map(m => [m.machine_number, m.mapping_id])).toEqual([['549', 's549'], ['554', 's554']]);
    expect(result.skipped).toEqual([]);
  });

  it('skips anything ambiguous, already decided or with crediting history', () => {
    const result = findUniqueMatches(input({
      machines: [
        machine('m551', '551'), machine('m552', '552'), machine('m553', '553'), machine('a558', '558'), machine('b558', '558'),
        machine('m560', '560'), machine('m561', '561'), machine('m562', '562'), machine('m563', '563', '132', false),
      ],
      sources: [
        source('s551', '132', '132 PIN CUTTER 551'),
        source('s552a', '132', '132 PIN CUTTER 552'), source('s552b', '132', '132 PIN CUTTER 552'),
        source('s553', '132', '132 PIN CUTTER 553', { mapping_active: false }),
        source('s558', '132', '132 PIN CUTTER 558'),
        source('s560', '132', '132 PIN CUTTER 560'), source('s561', '132', '132 PIN CUTTER 561'),
        source('s563', '132', '132 PIN CUTTER 563'),
      ],
      adminDecided: new Set(['m551']),
      assigned: new Map([['s551', 'm551'], ['s560', 'm999']]),
      withHistory: new Set(['m561']),
    }));
    expect(result.matches).toEqual([]);
    expect(result.skipped.map(s => [s.machine_number, s.reason])).toEqual([
      ['552', 'SEVERAL_SOURCES'], ['553', 'NO_SOURCE'], ['558', 'SEVERAL_MACHINES'], ['558', 'SEVERAL_MACHINES'],
      ['560', 'SOURCE_IN_USE'], ['561', 'CREDITING_HISTORY'], ['562', 'NO_SOURCE'],
    ]);
  });

  it('still matches a machine whose reference mapping already uses that source', () => {
    const result = findUniqueMatches(input({
      machines: [machine('m549', '549')], sources: [source('s549', '132', '132 PIN CUTTER 549')], assigned: new Map([['s549', 'm549']]),
    }));
    expect(result.matches.map(m => m.machine_id)).toEqual(['m549']);
  });
});
