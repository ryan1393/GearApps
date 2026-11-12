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

const body = { id: 'body', dana_serial_number: 'CGRT064AAA', mf_serial_number: null, enabled: true, description: null, definition_id: null } as CutterBody;
const tray = { id: 'tray', serial_number: 'TRAY-A', blade_count: 0, part_type: { code: 'RING' } } as unknown as ITray;
const build = { build_number: 'BUILD-A', status_code: 'PULLED', part_type_code: 'RING', blade_count: 11 } as CutterBuildCard;

describe('Cutter workflow selection safety', () => {
  let api: Record<string, jest.Mock>;
  beforeEach(() => {
    api = { getDashboard: jest.fn(() => of({ ready_for_cutter: [], pulled_builds: [] })), listCutterBodies: jest.fn(() => of([])),
      listCutterBuilderMachines: jest.fn(() => of([])), getSelectionTrays: jest.fn(() => of([])), getSelectionLocations: jest.fn(() => of([])),
      scanTray: jest.fn(() => of(tray)), scanCutterBody: jest.fn(() => of(body)), scanLocation: jest.fn(),
      searchBuilds: jest.fn(() => of([])), validateTray: jest.fn(), getCard: jest.fn(() => of(build)), teardownBuild: jest.fn(), createBuild: jest.fn(), printCard: jest.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: CutterBuilderApiService, useValue: api },
      { provide: GearToastService, useValue: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } },
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
    const component = cutter(); component.cutterBody = body; component.cutterBodySerial = 'CGRT064AAA';
    component.tray = tray; component.traySerial = 'TRAY-A'; component.selectedCutterBuilderMachineId = 'machine';
    component.availableCutterBuilderMachines = [{ id: 'machine' }] as typeof component.availableCutterBuilderMachines;
    component.trayValidation = { valid: true, required_blade_count: 19, blades_ready_for_cutter: true, tray_stage_ready: true,
      already_assigned_to_build: false, still_in_container: false } as CutterTrayValidation;
    expect(component.canBuild).toBe(false); component.trayValidation.required_blade_count = 11;
    expect(component.canBuild).toBe(true);
  });
  function readyToBuild() {
    const component = cutter(); component.cutterBody = body; component.cutterBodySerial = 'CGRT064AAA';
    component.tray = tray; component.traySerial = 'TRAY-A'; component.selectedCutterBuilderMachineId = 'machine';
    component.availableCutterBuilderMachines = [{ id: 'machine' }] as typeof component.availableCutterBuilderMachines;
    component.trayValidation = { valid: true, required_blade_count: 11, blades_ready_for_cutter: true, tray_stage_ready: true,
      already_assigned_to_build: false, still_in_container: false } as CutterTrayValidation;
    api['createBuild'].mockReturnValue(of({ build, blade_ids: [], tray_released: true }));
    return component;
  }
  it('prints the cutter card automatically once the build is created', () => {
    api['printCard'].mockReturnValue(of({ build_number: 'BUILD-A', printed: true, printer_configured: true, printer_name: 'Card 1' }));
    const component = readyToBuild(); component.build();
    expect(api['printCard']).toHaveBeenCalledWith('BUILD-A'); expect(component.printing).toBe(false);
  });
  it('does not print a card when the build fails', () => {
    const component = readyToBuild(); api['createBuild'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    component.build(); expect(api['printCard']).not.toHaveBeenCalled(); expect(component.error).toBe('Could not create Cutter Build.');
    expect(component.cutterBody).toBe(body); expect(component.tray).toBe(tray); expect(component.busy).toBe(false);
  });
  it('keeps the selected card visible while printing instead of clearing it through Back to Results', () => {
    const pending = new Subject<never>(); api['printCard'].mockReturnValue(pending);
    const component = TestBed.runInInjectionContext(() => new CutterLookupComponent());
    component.card = build; component.print(); component.backToResults();
    expect(component.card).toBe(build); expect(component.busy).toBe(true);
    expect(api['searchBuilds']).not.toHaveBeenCalled(); component.ngOnDestroy();
  });
  function readyToTeardown() {
    const component = teardown(); component.build = build; component.buildNumber = build.build_number;
    component.tray = tray; component.traySerial = tray.serial_number; component.scrappedBladeCount = build.blade_count;
    return component;
  }
  it('requires a confirmed teardown and revalidates the exact selected tray before submitting', () => {
    const component = readyToTeardown(); component.teardown();
    expect(api['teardownBuild']).not.toHaveBeenCalled();
    component.askTeardown(); expect(component.teardownConfirmation).toBe(true);
    expect(component.teardownConfirmationMessage).toContain('11 scrapped');
    component.trayChanged('OTHER'); component.teardown();
    expect(component.teardownConfirmation).toBe(false); expect(api['teardownBuild']).not.toHaveBeenCalled();
  });
  it('preserves teardown failure details and selections for retry, without a duplicate pending transaction', () => {
    const pending = new Subject<never>(); api['teardownBuild'].mockReturnValue(pending);
    const component = readyToTeardown(); component.askTeardown(); component.teardown(); component.teardown();
    expect(api['teardownBuild']).toHaveBeenCalledTimes(1);
    pending.error(new HttpErrorResponse({ status: 409, error: { message: 'The tray is already assigned.' } }));
    expect(component.error).toBe('The tray is already assigned.'); expect(component.busy).toBe(false);
    expect(component.build).toBe(build); expect(component.tray).toBe(tray); expect(component.scrappedBladeCount).toBe(11);
    component.askTeardown(); expect(component.teardownConfirmation).toBe(true);
  });
  it('falls back to browser print after the card renders when no card printer is set up', () => {
    jest.useFakeTimers();
    try {
      api['printCard'].mockReturnValue(of({ build_number: 'BUILD-A', printed: false, printer_configured: false, printer_name: null }));
      const component = readyToBuild(); const browserPrint = jest.spyOn(component, 'browserPrint').mockImplementation(() => undefined);
      component.build(); expect(browserPrint).not.toHaveBeenCalled();
      jest.runAllTimers(); expect(browserPrint).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });
  it('rejects a scanned tray whose server validation is valid but body capacity is wrong', () => {
    api['validateTray'].mockReturnValue(of({ valid: true, required_blade_count: 19 }));
    const component = cutter(); component.cutterBody = body; component.cutterBodySerial = 'CGRT064AAA'; component.traySerial = 'TRAY-A';
    component.scanTray(); expect(component.trayValidation).toBeNull(); expect(component.error).toContain('064 Standard');
  });
  function special105ReadyToBuild(summaryRule: string | null, cutterBody: CutterBody) {
    const component = cutter(); component.cutterBody = cutterBody; component.cutterBodySerial = cutterBody.dana_serial_number ?? cutterBody.mf_serial_number ?? '';
    component.tray = tray; component.traySerial = 'TRAY-A'; component.selectedCutterBuilderMachineId = 'machine';
    component.availableCutterBuilderMachines = [{ id: 'machine' }] as typeof component.availableCutterBuilderMachines;
    component.trayValidation = { valid: true, required_blade_count: 13, summary_body_rule: summaryRule, blades_ready_for_cutter: true, tray_stage_ready: true,
      already_assigned_to_build: false, still_in_container: false } as CutterTrayValidation;
    return component;
  }
  it('keeps 076 and special 105 apart when the Summary Body Size Rule is configured', () => {
    const std076 = { ...body, dana_serial_number: 'CGRT076AAA' } as CutterBody;
    const special = { ...body, dana_serial_number: 'CGRT1058AA' } as CutterBody;
    expect(special105ReadyToBuild('105-SPECIAL', special).canBuild).toBe(true);
    expect(special105ReadyToBuild('105-SPECIAL', std076).canBuild).toBe(false);
    expect(special105ReadyToBuild('076', std076).canBuild).toBe(true);
    expect(special105ReadyToBuild('076', special).canBuild).toBe(false);
  });
  it('blocks either 26-blade body until the Summary Body Size Rule is set', () => {
    for (const dana of ['CGRT076AAA', 'CGRT1058AA']) {
      const component = special105ReadyToBuild(null, { ...body, dana_serial_number: dana } as CutterBody);
      expect(component.canBuild).toBe(false);
      expect(component.bodyCompatibility?.reason).toContain('Body Size Rule is not set');
    }
  });
  it('sends the body to tray validation and obeys the API body answer', () => {
    api['validateTray'].mockReturnValue(of({ valid: false, required_blade_count: 13, body_compatible: false, body_reason: 'This Summary uses 076 Standard; cutter body CGRT1058AA is 105 Special (8th Dana S/N character 8)' }));
    const component = cutter(); component.cutterBody = { ...body, dana_serial_number: 'CGRT1058AA' } as CutterBody;
    component.cutterBodySerial = 'CGRT1058AA'; component.traySerial = 'TRAY-A';
    component.scanTray();
    expect(api['validateTray']).toHaveBeenCalledWith(expect.anything(), 'CGRT1058AA');
    expect(component.trayValidation).toBeNull();
    expect(component.error).toContain('076 Standard');
  });
  it('does not build with a compatible body that the API reports as unavailable', () => {
    const component = special105ReadyToBuild('105-SPECIAL', { ...body, dana_serial_number: 'CGRT1058AA' } as CutterBody);
    expect(component.canBuild).toBe(true);
    component.trayValidation = { ...component.trayValidation, body_compatible: true, body_available: false } as CutterTrayValidation;
    expect(component.canBuild).toBe(false);
  });
  it('builds an unetched body from its linked 076 definition, but never guesses a 105', () => {
    const definition = (code: string) => ({ definition_code: code, cutter_head_code: 'C', supplier_code: 'G', hand_code: code.charAt(2), blade_family_code: 'T',
      blade_family_name: 'TRI-AC', size_code: code.slice(4), supplier_name: 'Gleason', hand_name: 'RIGHT', size_description: null, enabled: true });
    const mfOnly076 = { ...body, dana_serial_number: null, mf_serial_number: 'A777', definition: definition('CGRT076') } as CutterBody;
    expect(special105ReadyToBuild('076', mfOnly076).canBuild).toBe(true);
    expect(cutter().cutterBodyCapacityText(mfOnly076)).toBe('076 Standard · 26 blades (13 sets) · from body definition (not etched)');
    const mfOnly105 = { ...body, dana_serial_number: null, mf_serial_number: '78', definition: definition('CGRT105') } as CutterBody;
    expect(special105ReadyToBuild('105-SPECIAL', mfOnly105).canBuild).toBe(false);
  });
  it('never takes capacity from the MF serial', () => {
    const component = special105ReadyToBuild(null, { ...body, dana_serial_number: null, mf_serial_number: 'CGRT1058AA' } as CutterBody);
    expect(component.canBuild).toBe(false);
    expect(component.cutterBodyCapacityText()).toBe('Blade capacity unresolved');
  });
  it('labels capacity in total blades and sets', () => {
    const component = cutter();
    expect(component.cutterBodyCapacityText({ ...body, dana_serial_number: 'CGRT105AAA' } as CutterBody)).toBe('105 Standard · 38 blades (19 sets)');
    expect(component.cutterBodyCapacityText({ ...body, dana_serial_number: 'CGRT1058AA' } as CutterBody)).toBe('105 Special (8th Dana S/N character 8) · 26 blades (13 sets)');
    expect(component.bladeSetText(19)).toBe('19 sets · 38 blades');
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
