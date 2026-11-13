import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { GreenshedApiService, RunningMachineRow, RunningMachinesBoard } from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { GreenshedMachinesBoardComponent } from './greenshed-machines-board.component';

const machine = (overrides: Partial<RunningMachineRow>): RunningMachineRow => ({
  run_id: 'run-1', machine_id: 'm', machine_number: '101', department_code: '152', cell: 1, machine_active: true,
  machine_background_color: '', has_cutter: true, build_number: 'BUILD-A', part_number: 'P1', summary_number: '123',
  part_type_code: 'RING', cutter_body_serial_number: 'BODY', shift: null, current_piece_count: 1200, shift_piece_count: 40,
  last_check_code: 'FC', last_check_name: 'Frequency', last_check_result: 'PASS', last_check_at: '2026-11-12T10:00:00Z',
  next_check_piece_count: 1500, check_due: false, ...overrides,
});

const board: RunningMachinesBoard = {
  active_filter: 'ACTIVE',
  refreshed_at: '2026-11-12T12:00:00Z',
  current_shift: { number: 2, label: '2nd shift', starts_at: '', ends_at: '', time_zone: 'America/Indiana/Indianapolis', tracking_started_at: '', is_complete: false },
  departments: [
    { department_code: '152', machines: [
      machine({ machine_id: 'pass', machine_number: '101' }),
      machine({ machine_id: 'due', machine_number: '102', run_id: 'run-2', build_number: 'BUILD-B', check_due: true }),
      machine({ machine_id: 'fail', machine_number: '103', run_id: 'run-3', build_number: 'BUILD-C', last_check_result: 'FAIL' }),
      machine({ machine_id: 'setup', machine_number: '104', run_id: 'run-4', build_number: 'BUILD-D', last_check_code: 'CS', last_check_result: null }),
    ] },
    { department_code: '132', machines: [
      machine({ machine_id: 'empty', machine_number: '201', department_code: '132', has_cutter: false, run_id: null, build_number: null }),
      machine({ machine_id: 'idle', machine_number: '202', department_code: '132', has_cutter: false, machine_active: false, run_id: null, build_number: null }),
    ] },
  ],
};

describe('Running Machines Board', () => {
  let api: Record<string, jest.Mock>;
  let navigate: jest.Mock;

  function render() {
    api = {
      getRunningMachines: jest.fn(() => of(board)),
      getDsfCounts: jest.fn(() => of({ format: 'DSFCOUNT1', configured: false, rows: [] })),
    };
    navigate = jest.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      imports: [GreenshedMachinesBoardComponent],
      providers: [{ provide: GreenshedApiService, useValue: api }, { provide: Router, useValue: { navigate } }],
    });
    const fixture = TestBed.createComponent(GreenshedMachinesBoardComponent);
    fixture.detectChanges();
    return fixture;
  }
  const cardOf = (host: HTMLElement, number: string) =>
    host.querySelector(`article[aria-label="Machine ${number}"]`) as HTMLElement;

  afterEach(() => TestBed.resetTestingModule());

  it('splits machines by department and writes every check state as text', () => {
    const fixture = render();
    const host: HTMLElement = fixture.nativeElement;
    expect(Array.from(host.querySelectorAll('h2.board-department-title')).map((h) => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Department 152 4 machines', 'Department 132 2 machines']);
    expect(cardOf(host, '101').querySelector('.card-badge')?.textContent?.trim()).toBe('PASS');
    expect(cardOf(host, '102').querySelector('.card-badge')?.textContent?.trim()).toBe('CHECK DUE');
    expect(cardOf(host, '103').querySelector('.card-badge')?.textContent?.trim()).toBe('FAIL');
    expect(cardOf(host, '104').querySelector('.card-badge')?.textContent?.trim()).toBe('SETUP — NO CHECK YET');
    expect(cardOf(host, '101').textContent).toContain('Cell 1');
    expect(cardOf(host, '101').textContent).toContain('BUILD-A');
    expect(cardOf(host, '101').textContent).toContain('1,200');
    // The partial shift is written out, not a hover tooltip.
    expect(cardOf(host, '101').textContent).toContain('Partial shift');
    expect(host.textContent).toContain('Partial shift: counting began during this shift');
    fixture.destroy();
  });

  it('shows an inactive empty machine as "No cutter running" with nothing to tap', () => {
    const fixture = render();
    const idle = cardOf(fixture.nativeElement, '202');
    expect(idle.textContent).toContain('No cutter running');
    expect(idle.textContent).toContain('Inactive machine');
    expect(idle.querySelector('button')).toBeNull();
    fixture.destroy();
  });

  it('opens Machine Setup from an active empty machine, as the table does', () => {
    const fixture = render();
    const button = cardOf(fixture.nativeElement, '201').querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('Set up a cutter');
    button.click();
    expect(navigate).toHaveBeenCalledWith(['/greenshed/setup'], { queryParams: { machine: '201', origin: 'running-machines' } });
    fixture.destroy();
  });

  it('offers the table\'s Frequency / CMM / Pull actions for a running cutter', () => {
    const fixture = render();
    (cardOf(fixture.nativeElement, '103').querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedMachine?.build_number).toBe('BUILD-C');
    const actions = Array.from(fixture.nativeElement.querySelectorAll('.board-dialog-actions button')) as HTMLButtonElement[];
    expect(actions.map((button) => button.textContent?.trim())).toEqual(['Frequency Check', 'ZEISS / CMM Check', 'Cutter Change Over', 'Cutter Death Certificate', 'Close']);
    actions[2].click();
    expect(navigate).toHaveBeenCalledWith(['/greenshed/pull'], { queryParams: { build: 'BUILD-C', reason: 'CHANGEOVER', machine: '103', run: 'run-3', origin: 'running-machines' } });
    expect(fixture.componentInstance.selectedMachine).toBeNull();
    fixture.destroy();
  });

  it('uses the same Active / Inactive / All filter and refresh as the table', () => {
    const fixture = render();
    expect(api['getRunningMachines']).toHaveBeenLastCalledWith('ACTIVE');
    const inactive = Array.from(fixture.nativeElement.querySelectorAll('.board-filter button') as NodeListOf<HTMLButtonElement>).find((button) => button.textContent?.trim() === 'Inactive') as HTMLButtonElement;
    inactive.click();
    expect(api['getRunningMachines']).toHaveBeenLastCalledWith('INACTIVE');
    fixture.detectChanges();
    expect(inactive.getAttribute('aria-pressed')).toBe('true');
    fixture.destroy();
  });
});
