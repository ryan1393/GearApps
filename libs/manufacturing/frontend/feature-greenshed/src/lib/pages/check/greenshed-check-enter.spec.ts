import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { GreenshedApiService, GreenshedBuild } from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { GreenshedCheckComponent } from './greenshed-check.component';

const running: GreenshedBuild = {
  id: 'b', build_number: 'BUILD-A', build_increment: 1, cutter_body_serial_number: 'BODY', summary_number: '123',
  summary_model: '', part_type_code: 'RING', status_code: 'RUNNING', built_at: '', shelf_location: null,
  machine_run: { id: 'run-1', machine_number: 'M1', part_number: 'P', current_piece_count: 10, last_check_piece_count: 0, next_check_piece_count: 25, installed_at: '' },
};

describe('Greenshed Quality Check: only Save saves', () => {
  let api: Record<string, jest.Mock>;

  async function render() {
    api = {
      getDashboard: jest.fn(() => of({ active_machines: [] })),
      getReferenceData: jest.fn(() => of({
        check_types: [{ code: 'FC', name: 'Frequency' }, { code: 'CMM', name: 'CMM' }],
        check_results: [{ id: 'p', code: 'PASS', name: 'Pass', description: null }, { id: 'f', code: 'FAIL', name: 'Fail', description: null }],
        pull_reasons: [], check_interval: 25,
      })),
      getBuild: jest.fn(() => of(JSON.parse(JSON.stringify(running)) as GreenshedBuild)),
      qualityCheck: jest.fn(() => of({ check_type_code: 'FC', result_code: 'PASS', piece_count: 25, next_check_piece_count: 50 })),
    };
    TestBed.configureTestingModule({
      imports: [GreenshedCheckComponent],
      providers: [
        provideRouter([]),
        { provide: GreenshedApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { queryParamMap: new BehaviorSubject(convertToParamMap({ build: 'BUILD-A' })) } },
        { provide: GearToastService, useValue: { success: jest.fn(), warning: jest.fn(), error: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(GreenshedCheckComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function enter(target: Element): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  it('never saves a PASS from Enter in a measurement or count field, or a form submit', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;
    const measurement = host.querySelector('.gear-workflow-form-grid-four input') as HTMLInputElement;
    const count = host.querySelector('input[name="pieces"]') as HTMLInputElement;
    expect(measurement).toBeTruthy();
    expect(enter(measurement).defaultPrevented).toBe(true);
    expect(enter(count).defaultPrevented).toBe(true);
    host.querySelector('form.gear-workflow-section')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(api['qualityCheck']).not.toHaveBeenCalled();
    expect(host.querySelector('form.gear-workflow-section button[type="submit"]')).toBeNull();
  });

  it('keeps Enter for new lines in Comments, and saves from the Save button', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;
    expect(enter(host.querySelector('textarea[name="comments"]') as HTMLTextAreaElement).defaultPrevented).toBe(false);
    const save = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Save Quality Check')) as HTMLButtonElement;
    save.click();
    expect(api['qualityCheck']).toHaveBeenCalledTimes(1);
    expect(api['qualityCheck']).toHaveBeenCalledWith(expect.objectContaining({ resultCode: 'PASS', buildNumber: 'BUILD-A' }));
  });
});
