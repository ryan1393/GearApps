import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { CutterBuilderApiService, CutterBody, CutterBuildCard, CutterTrayValidation } from '@meshforge/manufacturing/frontend/data-access-cutter-builder';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { ITray } from '@meshforge/manufacturing/shared/util-types';
import { CutterTeardownComponent } from './teardown/cutter-teardown.component';
import { CutterBuildComponent } from './build/cutter-build.component';
import { CutterLookupComponent } from './lookup/cutter-lookup.component';

const body = { id: 'body', dana_serial_number: 'BODY064', mf_serial_number: null, enabled: true, description: null, definition_id: null } as CutterBody;
const tray = { id: 'tray', serial_number: 'TRAY-A', blade_count: 0, part_type: { code: 'RING' } } as unknown as ITray;
const build = { build_number: 'BUILD-A', status_code: 'PULLED', part_type_code: 'RING', blade_count: 11 } as CutterBuildCard;

describe('Cutter workflow selection safety', () => {
  let api: Record<string, jest.Mock>;
  beforeEach(() => {
    api = { getDashboard: jest.fn(() => of({ ready_for_cutter: [], pulled_builds: [] })), listCutterBodies: jest.fn(() => of([])),
      listCutterBuilderMachines: jest.fn(() => of([])), getSelectionTrays: jest.fn(() => of([])), getSelectionLocations: jest.fn(() => of([])),
      scanTray: jest.fn(() => of(tray)), scanCutterBody: jest.fn(() => of(body)), scanLocation: jest.fn(),
      searchBuilds: jest.fn(() => of([])), validateTray: jest.fn(), getCard: jest.fn(() => of(build)), teardownBuild: jest.fn(), createBuild: jest.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: CutterBuilderApiService, useValue: api },
      { provide: GearToastService, useValue: { success: jest.fn(), error: jest.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } }] });
  });
  function teardown() { return TestBed.runInInjectionContext(() => new CutterTeardownComponent()); }
  function cutter() { return TestBed.runInInjectionContext(() => new CutterBuildComponent()); }
  it('clears an old tray when replacement lookup fails and prevents teardown', () => {
    const component = teardown(); component.build = build; component.buildNumber = build.build_number;
    component.tray = tray; component.traySerial = 'MISSING-B'; component.scrappedBladeCount = 11;
    api['scanTray'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    component.scanTray(); component.teardown();
    expect(component.tray).toBeNull(); expect(api['teardownBuild']).not.toHaveBeenCalled();
  });
  it('ignores an outstanding tray lookup after its input is edited', () => {
    const response = new Subject<ITray>(); api['scanTray'].mockReturnValue(response);
    const component = teardown(); component.build = build; component.traySerial = 'TRAY-A'; component.scanTray();
    component.trayChanged('TRAY-B'); response.next(tray);
    expect(component.tray).toBeNull(); expect(component.traySerial).toBe('TRAY-B');
  });
  it('ignores an older cutter card after a newer lookup starts', () => {
    const first = new Subject<CutterBuildCard>(); const second = new Subject<CutterBuildCard>();
    api['getCard'].mockReturnValueOnce(first).mockReturnValueOnce(second);
    const component = TestBed.runInInjectionContext(() => new CutterLookupComponent());
    component.openCard('FIRST'); component.openCard('SECOND');
    second.next({ ...build, build_number: 'SECOND' }); first.next({ ...build, build_number: 'FIRST' });
    expect(component.card?.build_number).toBe('SECOND');
  });
  it('rejects fractional scrap quantities', () => {
    const component = teardown(); component.build = build; component.scrappedBladeCount = 0.5;
    expect(component.scrapCountValid).toBe(false);
  });
  it('clears a validated tray when its cutter body input changes', () => {
    const component = cutter(); component.cutterBody = body; component.tray = tray;
    component.cutterBodyChanged('OTHER'); expect(component.cutterBody).toBeNull(); expect(component.tray).toBeNull();
  });
  it('requires body capacity compatibility in final build eligibility', () => {
    const component = cutter(); component.cutterBody = body; component.cutterBodySerial = 'BODY064';
    component.tray = tray; component.traySerial = 'TRAY-A'; component.selectedCutterBuilderMachineId = 'machine';
    component.availableCutterBuilderMachines = [{ id: 'machine' }] as typeof component.availableCutterBuilderMachines;
    component.trayValidation = { valid: true, required_blade_count: 19, blades_ready_for_cutter: true, tray_stage_ready: true,
      already_assigned_to_build: false, still_in_container: false } as CutterTrayValidation;
    expect(component.canBuild).toBe(false); component.trayValidation.required_blade_count = 11;
    expect(component.canBuild).toBe(true);
  });
  it('rejects a scanned tray whose server validation is valid but body capacity is wrong', () => {
    api['validateTray'].mockReturnValue(of({ valid: true, required_blade_count: 19 }));
    const component = cutter(); component.cutterBody = body; component.cutterBodySerial = 'BODY064'; component.traySerial = 'TRAY-A';
    component.scanTray(); expect(component.trayValidation).toBeNull(); expect(component.error).toContain('capacity');
  });
});

describe('Cutter picker pagination', () => {
  let api: CutterBuilderApiService; let backend: HttpTestingController;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(CutterBuilderApiService); backend = TestBed.inject(HttpTestingController); });
  afterEach(() => backend.verify());
  it.each(['trays', 'locations'])('follows metadata to retrieve every %s page', resource => {
    let rows: Array<{ id: string }> = [];
    const pages: Observable<Array<{ id: string }>> = resource === 'trays' ? api.getSelectionTrays() : api.getSelectionLocations();
    pages.subscribe(value => rows = value);
    const first = backend.expectOne(request => request.url === '/api/v1/' + resource && request.params.get('page') === '1');
    expect(first.request.params.get('perPage')).toBe('50'); first.flush({ data: [{ id: 'one' }], meta: { page: 1, hasNextPage: true } });
    backend.expectOne(request => request.url === '/api/v1/' + resource && request.params.get('page') === '2').flush({ data: [{ id: 'two' }], meta: { page: 2, hasNextPage: false } });
    expect(rows.map(row => row.id)).toEqual(['one', 'two']);
  });
});
