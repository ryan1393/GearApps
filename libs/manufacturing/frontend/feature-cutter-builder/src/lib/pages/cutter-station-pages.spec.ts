import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { CutterBody, CutterBuilderApiService, CutterBuildCard } from '@meshforge/manufacturing/frontend/data-access-cutter-builder';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { ITray } from '@meshforge/manufacturing/shared/util-types';
import { CutterBuildComponent } from './build/cutter-build.component';
import { CutterTeardownComponent } from './teardown/cutter-teardown.component';

const body = { id: 'body', dana_serial_number: 'CGRT064AAA', mf_serial_number: null, enabled: true, description: null, definition_id: null } as CutterBody;
const emptyTray = { id: 'tray', serial_number: 'TRAY-A', blade_count: 0, enabled: true, part_type: { code: 'RING' } } as unknown as ITray;
const pulled = { build_number: 'BUILD-A', status_code: 'PULLED', part_type_code: 'RING', blade_count: 11 } as CutterBuildCard;
const dullShelf = { id: 's1', serial_number: 'CGDR-A1A', location_type: 'SHELF', department: 'CUTTERGRIND', enabled: true, description: null };

describe('Cutter Builder Build and Teardown as scan stations', () => {
  let api: Record<string, jest.Mock>;
  function render<T>(component: new () => T) {
    api = {
      getDashboard: jest.fn(() => of({ ready_for_cutter: [], pulled_builds: [{ build_number: 'BUILD-A', summary_number: '123', part_type_code: 'RING', machine_number: 'M1' }] })),
      listCutterBodies: jest.fn(() => of([body, { ...body, id: 'no-rule', dana_serial_number: null, mf_serial_number: 'MF-1' }])),
      listCutterBuilderMachines: jest.fn(() => of([{ id: 'machine', machine_number: 'CB1' }])),
      getSelectionTrays: jest.fn(() => of([{ ...emptyTray, current_container: null, current_cutter_build: null }])),
      getSelectionLocations: jest.fn(() => of([dullShelf])),
      scanCutterBody: jest.fn(() => of(body)), scanTray: jest.fn(() => of(emptyTray)), validateTray: jest.fn(),
      getCard: jest.fn(() => of(pulled)), scanLocation: jest.fn(() => of(dullShelf)), teardownBuild: jest.fn(), createBuild: jest.fn(), printCard: jest.fn(),
    };
    TestBed.configureTestingModule({
      imports: [component],
      providers: [
        // The label printer picker and DSF count on Build read their own endpoints; left unanswered here.
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CutterBuilderApiService, useValue: api },
        { provide: GearToastService, useValue: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
    });
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    return fixture;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('Build: body and tray are numbered scan-or-pick steps with a status line', () => {
    const fixture = render(CutterBuildComponent);
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('gear-station-status')).toBeTruthy();
    expect(Array.from(host.querySelectorAll('input[data-gear-scan-step]')).map((input) => input.getAttribute('data-gear-scan-step'))).toEqual(['1', '2']);
    // A body without a known capacity could not be chosen before; it is not offered.
    expect(fixture.componentInstance.bodyOptions.map((option) => option.value)).toEqual(['CGRT064AAA']);
    fixture.destroy();
  });

  it('Build: scans through the same lookups and explains what blocks Create Cutter Build', () => {
    const fixture = render(CutterBuildComponent);
    const c = fixture.componentInstance;
    expect(c.buildBlockedReason).toContain('Cutter Body first');
    c.useBody('CGRT064AAA');
    expect(api['scanCutterBody']).toHaveBeenCalledWith('CGRT064AAA');
    expect(c.buildBlockedReason).toContain('ready blade tray');
    api['validateTray'].mockReturnValue(of({ valid: false, reason: 'Blades are not ready for cutter use.', required_blade_count: 11 }));
    c.useTray('TRAY-A');
    expect(api['validateTray']).toHaveBeenCalled();
    expect(c.status).toEqual({ tone: 'error', text: 'Blades are not ready for cutter use.' });
    expect(c.buildBlockedReason).toBe('Blades are not ready for cutter use.');
    c.changeBody();
    expect(c.cutterBody).toBeNull();
    expect(c.tray).toBeNull();
    fixture.destroy();
  });

  it('Teardown: build, tray and dull shelf are scan-or-pick steps; the reason Complete is blocked is shown', () => {
    const fixture = render(CutterTeardownComponent);
    const c = fixture.componentInstance;
    expect(c.teardownBlockedReason).toContain('pulled cutter build first');
    c.useBuild('BUILD-A');
    expect(api['getCard']).toHaveBeenCalledWith('BUILD-A');
    expect(c.teardownBlockedReason).toContain('empty teardown tray');
    c.useTray('TRAY-A');
    expect(c.teardownBlockedReason).toContain('dull shelf');
    fixture.detectChanges();
    expect(Array.from(fixture.nativeElement.querySelectorAll('gear-scan-panel')).map((panel) => (panel as HTMLElement).getAttribute('data-state'))).toEqual(['done', 'done', 'ready']);
    c.useShelf('CGDR-A1A');
    expect(c.teardownBlockedReason).toBe('');
    c.askTeardown();
    expect(c.teardownConfirmation).toBe(true);
    fixture.destroy();
  });

  it('Teardown: a failed lookup reports in the status line', () => {
    const fixture = render(CutterTeardownComponent);
    const c = fixture.componentInstance;
    api['getCard'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    c.useBuild('MISSING');
    expect(c.status).toEqual({ tone: 'error', text: 'Cutter build not found.' });
    fixture.destroy();
  });
});
