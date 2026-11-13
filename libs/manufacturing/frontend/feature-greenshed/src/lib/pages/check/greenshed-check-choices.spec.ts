import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import {
  GreenshedApiService,
  GreenshedBuild,
  GreenshedReferenceData,
} from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { GreenshedCheckComponent } from './greenshed-check.component';

const runningBuild: GreenshedBuild = {
  id: 'build-1', build_number: 'BUILD-1', build_increment: 1, cutter_body_serial_number: 'BODY-1',
  summary_number: '123', summary_model: '', part_type_code: 'RING', status_code: 'RUNNING', built_at: '', shelf_location: null,
  machine_run: {
    id: 'run-1', machine_number: 'M1', part_number: 'P1', current_piece_count: 120,
    last_check_piece_count: 75, next_check_piece_count: 100, installed_at: '',
  },
};
const choices: GreenshedReferenceData = {
  check_types: [{ code: 'FC', name: 'Frequency' }],
  check_results: [{ id: 'pass', code: 'PASS', name: 'Pass', description: null }],
  pull_reasons: [], check_interval: 25, dsf_cutter_counts: true,
};
const freshBuild = (): GreenshedBuild => ({
  ...runningBuild, machine_run: runningBuild.machine_run ? { ...runningBuild.machine_run } : null,
});

describe('Quality Check reference readiness', () => {
  let refs: Subject<GreenshedReferenceData>;
  let build: Subject<GreenshedBuild>;
  let api: { getReferenceData: jest.Mock; getBuild: jest.Mock; qualityCheck: jest.Mock; getDashboard: jest.Mock };
  let fixture: ComponentFixture<GreenshedCheckComponent> | undefined;
  beforeEach(() => {
    refs = new Subject<GreenshedReferenceData>();
    build = new Subject<GreenshedBuild>();
    api = {
      getReferenceData: jest.fn(() => refs), getBuild: jest.fn(() => build),
      getDashboard: jest.fn(() => of({ active_machines: [] })),
      qualityCheck: jest.fn(() => of({ piece_count: 100, next_check_piece_count: 125, check_type_code: 'FC', result_code: 'PASS' })),
    };
    TestBed.configureTestingModule({
      imports: [GreenshedCheckComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: new BehaviorSubject(convertToParamMap({ build: 'BUILD-1' })) } },
        { provide: GreenshedApiService, useValue: api },
        { provide: GearToastService, useValue: { success: jest.fn(), warning: jest.fn(), error: jest.fn() } },
      ],
    });
  });
  afterEach(() => { fixture?.destroy(); fixture = undefined; });
  function create(): GreenshedCheckComponent {
    const component = TestBed.runInInjectionContext(() => new GreenshedCheckComponent());
    component.ngOnInit();
    return component;
  }

  it('waits for delayed DSF settings before choosing the scheduled piece count', () => {
    const component = create();
    build.next(freshBuild());
    component.save();
    expect(api.qualityCheck).not.toHaveBeenCalled();
    refs.next(choices);
    expect(component.pieceCount).toBe(100);
    expect(component.minimumPieceCount).toBe(75);
  });

  it('chooses the same count when reference settings resolve before the build', () => {
    const component = create();
    refs.next(choices);
    build.next(freshBuild());
    expect(component.pieceCount).toBe(100);
  });

  it('preserves operator-counted defaults when DSF is not enabled', () => {
    const component = create();
    build.next(freshBuild());
    refs.next({ ...choices, dsf_cutter_counts: false });
    expect(component.pieceCount).toBe(120);
  });

  it('keeps failed references visible, prevents saves, and recovers through retry without changing the selected build', () => {
    api.getReferenceData.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503, error: { message: 'Check settings unavailable' } })));
    const component = create();
    build.next(freshBuild());
    component.pieceCount = 120;
    component.save();
    expect(component.choicesError).toBe('Check settings unavailable');
    expect(api.qualityCheck).not.toHaveBeenCalled();
    component.loadChoices();
    refs.next(choices);
    expect(component.build?.build_number).toBe('BUILD-1');
    expect(component.choicesError).toBe('');
    expect(component.pieceCount).toBe(100);
    component.save();
    expect(api.qualityCheck).toHaveBeenCalledWith(expect.objectContaining({ pieceCount: 100, expectedMachineRunId: 'run-1' }));
    expect(component.pieceCount).toBe(125);
  });

  it('disables the rendered check entry while references load and exposes an accessible retry after failure', () => {
    fixture = TestBed.createComponent(GreenshedCheckComponent);
    fixture.detectChanges();
    build.next(freshBuild());
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Loading quality check choices');
    refs.error(new HttpErrorResponse({ status: 503 }));
    fixture.detectChanges();
    const alert: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('Quality checks cannot be saved');
    const retry: HTMLButtonElement = alert.querySelector('button') as HTMLButtonElement;
    expect(retry.textContent?.trim()).toBe('Retry choices');
    expect(retry.disabled).toBe(false);
    expect((fixture.nativeElement.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  });
});
