import { DsfCountRow, RunningMachineRow } from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { checkNeedsAttention, dsfCountCell, lastCheckKind, machineActionRoute, machineCheckStatus, sortRunningMachines } from './running-machines.logic';

const machine = (overrides: Partial<RunningMachineRow> = {}): RunningMachineRow => ({
  run_id: 'run-1', machine_id: 'm1', machine_number: '101', department_code: '152', cell: 1, machine_active: true,
  machine_background_color: '', has_cutter: true, build_number: 'BUILD-A', part_number: 'P1', summary_number: '123',
  part_type_code: 'RING', cutter_body_serial_number: 'BODY', shift: null, current_piece_count: 10, shift_piece_count: 4,
  last_check_code: 'FC', last_check_name: 'Frequency', last_check_result: 'PASS', last_check_at: '2026-11-12T10:00:00Z',
  next_check_piece_count: 25, check_due: false, ...overrides,
});

describe('Running Machines rules (shared by the table and the board)', () => {
  it('mirrors the table colours as board badges: red wins, then yellow, then green', () => {
    expect(machineCheckStatus(machine())).toEqual({ tone: 'success', label: 'PASS' });
    expect(machineCheckStatus(machine({ check_due: true }))).toEqual({ tone: 'danger', label: 'CHECK DUE' });
    expect(machineCheckStatus(machine({ last_check_result: 'FAIL' }))).toEqual({ tone: 'danger', label: 'FAIL' });
    expect(machineCheckStatus(machine({ last_check_result: 'hold' }))).toEqual({ tone: 'danger', label: 'HOLD' });
    expect(machineCheckStatus(machine({ last_check_code: 'CS', last_check_result: null }))).toEqual({ tone: 'warning', label: 'SETUP — NO CHECK YET' });
    // The table paints a due setup red (its due class comes after the setup class).
    expect(machineCheckStatus(machine({ last_check_code: 'CS', check_due: true }))).toEqual({ tone: 'danger', label: 'CHECK DUE' });
    expect(machineCheckStatus(machine({ has_cutter: false }))).toBeNull();
  });

  it('treats a setup record as never failed, whatever its result says', () => {
    expect(checkNeedsAttention(machine({ last_check_code: 'CS', last_check_result: 'FAIL' }))).toBe(false);
    expect(checkNeedsAttention(machine({ last_check_code: 'CMM', last_check_result: 'FAIL' }))).toBe(true);
  });

  it('names the last check as the table does', () => {
    expect(lastCheckKind(machine({ last_check_code: 'CS' }))).toBe('Setup');
    expect(lastCheckKind(machine({ last_check_code: 'CMM' }))).toBe('CMM');
    expect(lastCheckKind(machine({ last_check_code: 'X', last_check_name: 'Other' }))).toBe('Other');
  });

  it('sorts by cell (no cell last), then machine number', () => {
    const rows = [machine({ machine_number: '12', cell: null }), machine({ machine_number: '10', cell: 2 }), machine({ machine_number: '9', cell: 2 }), machine({ machine_number: '50', cell: 1 })];
    expect(sortRunningMachines(rows).map((row) => row.machine_number)).toEqual(['50', '9', '10', '12']);
  });

  it('marks a DSF count stale or pending exactly as before', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    const row = { machine_id: 'm1', status: 'OK', count: 42, shift_number: 2, shift_end: '2026-11-12T15:00:00Z', refreshed_at: '2026-11-12T11:59:00Z', as_of: null, note: 'ok', shift_date: '2026-11-12' } as DsfCountRow;
    expect(dsfCountCell(row, null, false, now)).toMatchObject({ value: 42, label: 'Shift 2', warning: false });
    expect(dsfCountCell(row, null, true, now)).toMatchObject({ value: 42, label: 'Stale', warning: true });
    expect(dsfCountCell({ ...row, shift_end: '2026-11-12T11:00:00Z' }, null, false, now)).toMatchObject({ value: null, label: 'New shift pending' });
    expect(dsfCountCell(undefined, null, false, now)).toMatchObject({ value: null, label: 'Not mapped' });
  });

  it('keeps the machine and run on every action link', () => {
    expect(machineActionRoute('cmm', machine())).toEqual({ commands: ['/greenshed/check'], queryParams: { build: 'BUILD-A', machine: '101', run: 'run-1', origin: 'running-machines', type: 'CMM' } });
    expect(machineActionRoute('setup', machine())).toEqual({ commands: ['/greenshed/setup'], queryParams: { machine: '101', origin: 'running-machines' } });
  });
});
