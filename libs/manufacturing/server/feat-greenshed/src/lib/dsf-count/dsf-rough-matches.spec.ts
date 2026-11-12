import { canonical, findRoughMatches, RoughMatchInput, roughMatch } from './dsf-rough-matches';
import { UniqueMatchSource } from './dsf-unique-matches';

const source = (mapping_id: string, department: string, whiteboard_name: string, changes: Partial<UniqueMatchSource> = {}): UniqueMatchSource => ({
  mapping_id, department, whiteboard_name, line_name: 'Line' + department,
  mapping_active: true, whiteboard_active: true, operation_line_matches: true, running_reasons: 1, ...changes,
});
const machine = (machine_id: string, machine_number: string, department = '132', active = true) => ({ machine_id, machine_number, department, active });
const input = (changes: Partial<RoughMatchInput>): RoughMatchInput => ({
  machines: [], sources: [], current: new Map(), leftUnmapped: new Set(), assigned: new Map(), withHistory: new Set(), ...changes,
});
const at = (department: string, whiteboard_name: string, line_name = 'Line' + department) => ({ department, whiteboard_name, line_name });

describe('DSF rough matches', () => {
  it('ignores case, punctuation and leading zeros', () => {
    expect(canonical(' g-01 ')).toBe('G1');
    expect(canonical('0549')).toBe('549');
    expect(canonical('000')).toBe('0');
  });

  it('says how a source name matches a machine number', () => {
    expect(roughMatch('549', at('132', '132 PIN CUTTER 549'))).toBe('ENDS_IN_NUMBER');
    expect(roughMatch('0549', at('132', '132 PIN CUTTER 549 '))).toBe('ENDS_IN_NUMBER');
    expect(roughMatch('549', at('132', '549 PIN CUTTER (OLD)'))).toBe('NAME_HAS_NUMBER');
    expect(roughMatch('549', at('132', 'PIN CUTTER', 'LIne132-PIN_549'))).toBe('LINE_HAS_NUMBER');
    expect(roughMatch('G01', at('45', 'GRINDER G-1'))).toBe('ENDS_IN_NUMBER');
    expect(roughMatch('LAP3', at('181', 'LAP 3 GLEASON'))).toBe('NAME_HAS_NUMBER');
    expect(roughMatch('G01', at('45', 'GRINDER 1'))).toBe('DIGITS_ONLY');
    expect(roughMatch('54', at('132', '132 PIN CUTTER 549'))).toBeNull();
    // The department number in a line name is not a machine number.
    expect(roughMatch('132', at('132', 'PIN CUTTER', 'LIne132-PIN_549'))).toBeNull();
  });

  it('pairs every machine with the clearly best free source in its department and lists every DSF source', () => {
    const result = findRoughMatches(input({
      machines: [machine('m549', '549'), machine('m550', '550'), machine('g1', 'G01', '45'), machine('m700', '700'), machine('old', '551', '132', false)],
      sources: [
        source('s549', '132', '132 PIN CUTTER 549'), source('s549old', '132', 'PIN CUTTER', { line_name: 'Line132-PIN_549' }),
        source('s550', '132', '550 PIN'), source('g', '45', 'GRINDER 1'),
        source('x', '132', '132 PIN CUTTER 551'), source('off', '132', '132 PIN CUTTER 700', { running_reasons: 0 }),
        source('ring', '152', '152 RING CUTTER 549'),
      ],
    }));
    expect(result.machines.map(m => [m.machine_number, m.status, m.proposed_mapping_id])).toEqual([
      ['G01', 'PROPOSED', 'g'], ['549', 'PROPOSED', 's549'], ['550', 'PROPOSED', 's550'], ['700', 'NO_CANDIDATE', null],
    ]);
    expect(result.machines[1].candidates.map(c => [c.mapping_id, c.reason])).toEqual([['s549', 'ENDS_IN_NUMBER'], ['s549old', 'LINE_HAS_NUMBER']]);
    expect(result.sources.map(s => [s.whiteboard_name, s.outcome, s.machine_numbers, s.other_departments])).toEqual([
      ['GRINDER 1', 'PROPOSED', ['G01'], []],
      ['132 PIN CUTTER 549', 'PROPOSED', ['549'], []],
      ['132 PIN CUTTER 551', 'NO_MACHINE', [], []],
      ['132 PIN CUTTER 700', 'NOT_ELIGIBLE', [], []],
      ['550 PIN', 'PROPOSED', ['550'], []],
      ['PIN CUTTER', 'CANDIDATE', ['549'], []],
      ['152 RING CUTTER 549', 'NO_MACHINE', [], ['132']],
    ]);
  });

  it('lets the administrator choose when it is a tie or two machines want one source', () => {
    const result = findRoughMatches(input({
      machines: [machine('a', '552'), machine('b', '0552'), machine('c', '553')],
      sources: [source('s552', '132', '132 PIN CUTTER 552'), source('s553a', '132', '553 A'), source('s553b', '132', '553 B')],
    }));
    const rows = result.machines.map(m => [m.machine_id, m.status, m.proposed_mapping_id, m.candidates.map(c => c.mapping_id)]);
    expect(rows.sort((x, y) => String(x[0]).localeCompare(String(y[0])))).toEqual([
      ['a', 'CHOOSE', null, ['s552']], ['b', 'CHOOSE', null, ['s552']], ['c', 'CHOOSE', null, ['s553a', 's553b']],
    ]);
  });

  it('leaves mapped, unmapped-on-purpose and crediting-history machines alone, and skips sources other machines use', () => {
    const result = findRoughMatches(input({
      machines: [machine('m1', '501'), machine('m2', '502'), machine('m3', '503'), machine('m4', '504'), machine('m5', '505')],
      sources: [source('s501', '132', '132 PIN CUTTER 501'), source('s503', '132', '132 PIN CUTTER 503'),
        source('s504', '132', '132 PIN CUTTER 504'), source('s505', '132', '132 PIN CUTTER 505')],
      current: new Map([['m1', { mapping_id: 's501', whiteboard_name: '132 PIN CUTTER 501', line_name: 'L' }],
        ['m2', { mapping_id: 's505', whiteboard_name: '132 PIN CUTTER 505', line_name: 'L' }]]),
      leftUnmapped: new Set(['m3']),
      assigned: new Map([['s501', 'm1'], ['s505', 'm2']]),
      withHistory: new Set(['m4']),
    }));
    expect(result.machines.map(m => [m.machine_number, m.status, m.current_looks_right, m.proposed_mapping_id])).toEqual([
      ['501', 'MAPPED', true, null], ['502', 'MAPPED', false, null], ['503', 'LEFT_UNMAPPED', null, null],
      ['504', 'CREDITING_HISTORY', null, null], ['505', 'NO_CANDIDATE', null, null],
    ]);
    expect(result.machines[3].candidates.map(c => c.mapping_id)).toEqual(['s504']);
    expect(result.sources.find(s => s.mapping_id === 's505')).toMatchObject({ outcome: 'IN_USE', machine_numbers: ['502'] });
  });
});

describe('DSF rough matches: saving', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const option = (n: number, whiteboard_name: string) => ({
    mapping_id: uuid(100 + n), whiteboard_id: uuid(200 + n), op_id: uuid(300 + n), line_id: uuid(400 + n), department_id: uuid(500),
    department: '132', line_name: 'Line132', whiteboard_name, mapping_active: true, whiteboard_active: true,
    operation_line_matches: true, active_mappings: 1, running_reasons: 1,
  });
  const service = async () => {
    const { DsfCountService } = await import('./dsf-count.service');
    const machines = [
      { machine_id: uuid(1), machine_number: '601', department: '132', machine_type: 'PRODUCTION', active: true },
      { machine_id: uuid(2), machine_number: '603', department: '132', machine_type: 'PRODUCTION', active: true },
    ];
    const query = jest.fn(async (sql: string) => sql.includes('FROM public.machines') ? machines : []);
    const counts = new DsfCountService({ options: { type: 'postgres' }, query } as never);
    Object.assign(counts, { sourceOptions: [option(1, '132 PIN CUTTER 601'), option(2, '603 A'), option(3, '603 B')], sourceOptionsRefreshedAt: new Date().toISOString() });
    const save = jest.spyOn(counts, 'saveAdminMapping').mockResolvedValue({ status: 'SAVED', machine_id: '', mapping_id: '', refresh_requested: true });
    return { counts, save };
  };

  it('saves the picked candidates through the normal Admin save and refuses anything else', async () => {
    const { counts, save } = await service();
    const preview = await counts.roughMatches();
    expect(preview.machines.map(m => [m.machine_number, m.status])).toEqual([['601', 'PROPOSED'], ['603', 'CHOOSE']]);
    const result = await counts.applyRoughMatches([
      { machine_id: uuid(1), mapping_id: uuid(101) }, { machine_id: uuid(2), mapping_id: uuid(103) },
    ], uuid(9));
    expect(result.mapped.map(m => [m.machine_number, m.whiteboard_name])).toEqual([['601', '132 PIN CUTTER 601'], ['603', '603 B']]);
    expect(save).toHaveBeenCalledTimes(2);

    save.mockClear();
    const refused = await counts.applyRoughMatches([{ machine_id: uuid(1), mapping_id: uuid(102) }], uuid(9));
    expect(refused.skipped.map(s => s.machine_number)).toEqual(['601']);
    expect(save).not.toHaveBeenCalled();
    await expect(counts.applyRoughMatches([{ machine_id: uuid(1), mapping_id: uuid(102) }, { machine_id: uuid(2), mapping_id: uuid(102) }], uuid(9)))
      .rejects.toThrow('more than one machine');
  });
});
