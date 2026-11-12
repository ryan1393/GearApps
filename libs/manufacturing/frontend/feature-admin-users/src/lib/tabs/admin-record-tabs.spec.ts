import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { Observable, of, Subject, throwError } from 'rxjs';

import { AdminApiService, AdminTrayRow, PagedResponse, RollMasterRow } from '../admin-api.service';
import { AdminTabBase } from '../shared/admin-tab-base';
import { AdminContainersTabComponent } from './containers/admin-containers-tab.component';
import { AdminCutterBodiesTabComponent } from './cutter-bodies/admin-cutter-bodies-tab.component';
import { AdminLocationsTabComponent } from './locations/admin-locations-tab.component';
import { AdminMachinesTabComponent } from './machines/admin-machines-tab.component';
import { AdminModelsTabComponent } from './models/admin-models-tab.component';
import { AdminPartSummariesTabComponent } from './part-summaries/admin-part-summaries-tab.component';
import { AdminPartsTabComponent } from './parts/admin-parts-tab.component';
import { AdminRollMastersTabComponent } from './roll-masters/admin-roll-masters-tab.component';
import { AdminTraysTabComponent } from './trays/admin-trays-tab.component';

const page = <T>(data: T[] = []): Observable<PagedResponse<T>> => of({ data, meta: { hasNextPage: false } });

/** Every list request answers with nothing unless a test says otherwise. */
function stubLists(api: AdminApiService): void {
  for (const method of ['listUsers', 'listPartSummaries', 'listTrays', 'listContainers', 'listLocations'] as const) {
    jest.spyOn(api, method).mockReturnValue(page() as never);
  }
  for (const method of ['listPartTypes', 'listParts', 'listRollMasters', 'listModels', 'listDepartments', 'listMachines',
    'listSummaryBodyRules', 'listPartSummarySettings', 'listCutterBodies', 'listCutterBodyDefinitions'] as const) {
    jest.spyOn(api, method).mockReturnValue(of([]) as never);
  }
}

function setup<T>(component: Type<T>, before?: (api: AdminApiService) => void) {
  TestBed.configureTestingModule({ imports: [component], providers: [provideHttpClient(), provideHttpClientTesting()] });
  const api = TestBed.inject(AdminApiService);
  stubLists(api);
  before?.(api);
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, api };
}

describe('Admin record tabs', () => {
  it.each([
    [AdminPartSummariesTabComponent, 'togglePartSummaryEnabled', 'updatePartSummary', { id: 's', number: '1.955FC', enabled: true, active: true }],
    [AdminPartsTabComponent, 'togglePartEnabled', 'updatePart', { id: 'p', part_number: 'P-1', enabled: true, active: true }],
    [AdminMachinesTabComponent, 'toggleMachineEnabled', 'updateMachine', { id: 'm', machine_number: '520G', enabled: true, active: true }],
    [AdminLocationsTabComponent, 'toggleLocationEnabled', 'updateLocation', { id: 'l', serial_number: 'CGRR-A1A', enabled: true }],
    [AdminTraysTabComponent, 'toggleTrayEnabled', 'updateTray', { id: 't', serial_number: 'T0001', enabled: true }],
    [AdminContainersTabComponent, 'toggleContainerEnabled', 'updateContainer', { id: 'c', serial_number: 'C0001', enabled: true }],
    [AdminCutterBodiesTabComponent, 'toggleCutterBodyEnabled', 'updateCutterBody', { id: 'b', mf_serial_number: 'MF-1', enabled: true }],
  ] as const)('%p confirms in the page before disabling (%s), and enables without asking', (type, method, apiMethod, row) => {
    const { component, api } = setup(type as Type<AdminTabBase>);
    const send = jest.spyOn(api as unknown as Record<string, () => Observable<unknown>>, apiMethod).mockReturnValue(of({}));
    const toggle = (component as unknown as Record<string, (record: unknown) => void>)[method].bind(component);
    toggle(row);
    expect(send).not.toHaveBeenCalled();
    expect(component.confirmation.request?.confirmLabel).toBe('Disable');
    expect(component.confirmation.request?.danger).toBe(true);
    component.confirmation.accept();
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown[])[1]).toMatchObject({ enabled: false });
    toggle({ ...row, enabled: false });
    expect(component.confirmation.request).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('shows a failed save once, in the banner beside the form, not also as a toast', () => {
    const { fixture, component, api } = setup(AdminModelsTabComponent);
    const toastError = jest.spyOn(TestBed.inject(GearToastService), 'error');
    jest.spyOn(api, 'createModel').mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Model exists.' } })));
    component.modelForm = { model_number: '174', model_type: '' };
    component.createModel();
    fixture.detectChanges();
    expect(toastError).not.toHaveBeenCalled();
    const alerts = fixture.nativeElement.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(1);
    expect(alerts[0].textContent).toContain('Model exists.');
  });

  it('says it is loading instead of "no trays", and keeps a newer reload over an older one', () => {
    const pages: Subject<PagedResponse<AdminTrayRow>>[] = [];
    const { fixture, component, api } = setup(AdminTraysTabComponent, (stubbed) => {
      jest.spyOn(stubbed, 'listTrays').mockImplementation(() => { const next = new Subject<PagedResponse<AdminTrayRow>>(); pages.push(next); return next; });
    });
    expect(fixture.nativeElement.textContent).toContain('Loading trays…');
    expect(fixture.nativeElement.textContent).not.toContain('No trays');
    component.loadTrays();
    expect(api.listTrays).toHaveBeenCalledTimes(2);
    pages[1].next({ data: [{ id: 'new', serial_number: 'T0002', blade_count: 0, enabled: true }], meta: { hasNextPage: false } });
    pages[1].complete();
    pages[0].next({ data: [{ id: 'old', serial_number: 'T0001', blade_count: 0, enabled: true }], meta: { hasNextPage: false } });
    pages[0].complete();
    expect(component.trays.map((tray) => tray.id)).toEqual(['new']);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Loading trays…');
  });

  it('stops loading when the tab is left', () => {
    const pages: Subject<PagedResponse<AdminTrayRow>>[] = [];
    const { fixture } = setup(AdminTraysTabComponent, (stubbed) => {
      jest.spyOn(stubbed, 'listTrays').mockImplementation(() => { const next = new Subject<PagedResponse<AdminTrayRow>>(); pages.push(next); return next; });
    });
    expect(pages[0].observed).toBe(true);
    fixture.destroy();
    expect(pages[0].observed).toBe(false);
  });

  it('shows a failed list with Retry, and an empty list as empty', () => {
    const { fixture, component, api } = setup(AdminMachinesTabComponent, (stubbed) => {
      jest.spyOn(stubbed, 'listMachines').mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503, error: { message: 'Database unavailable.' } })));
    });
    expect(fixture.nativeElement.textContent).toContain('Could not load machines.');
    expect(fixture.nativeElement.textContent).toContain('Database unavailable.');
    jest.spyOn(api, 'listMachines').mockReturnValue(of([]));
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find((button) => button.textContent?.includes('Retry'))?.click();
    fixture.detectChanges();
    expect(component.machinesList.error()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No machines yet.');
  });

  it('reports form choices that could not be loaded, once, with Retry', () => {
    const { fixture, api } = setup(AdminMachinesTabComponent, (stubbed) => {
      jest.spyOn(stubbed, 'listDepartments').mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    });
    expect(fixture.nativeElement.textContent).toContain('Some choices could not be loaded.');
    expect(fixture.nativeElement.textContent).toContain('departments');
    jest.spyOn(api, 'listDepartments').mockReturnValue(of([]));
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find((button) => button.textContent?.includes('Retry'))?.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Some choices could not be loaded.');
  });

  it('reads every page of a paged list before showing it', () => {
    const { component } = setup(AdminContainersTabComponent, (stubbed) => {
      jest.spyOn(stubbed, 'listContainers').mockImplementation((pageNumber: number) => of({
        data: [{ id: `c${pageNumber}`, serial_number: `C000${pageNumber}`, tray_count: 0, blade_count: 0, enabled: true }],
        meta: { hasNextPage: pageNumber < 3 },
      }));
    });
    expect(component.containers.map((row) => row.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('fills Roll Master quantities when the lists load, not while rendering', () => {
    const part = { id: 'p1', part_number: 'P-1', summary_id: 's', part_type_id: 't', teeth: null, active: true, enabled: true };
    const { component } = setup(AdminRollMastersTabComponent, (stubbed) => {
      jest.spyOn(stubbed, 'listParts').mockReturnValue(of([part]));
      jest.spyOn(stubbed, 'listRollMasters').mockReturnValue(of([{ id: 'r1', part_id: 'p1', required_count: 0, current_quantity: 4, minimum_quantity: 2, active: true, enabled: true, notes: null }]));
    });
    expect(component.rollMasterEdits['p1']).toEqual({ current_quantity: 4, minimum_quantity: 2 });
    const before = { ...component.rollMasterEdits };
    component.rollMasterEdit({ ...part, id: 'unknown' });
    expect(component.rollMasterEdits).toEqual(before);
  });

  it('keeps a typed Roll Master quantity for other parts when one part is saved', () => {
    const parts = ['p1', 'p2'].map((id) => ({ id, part_number: id, summary_id: 's', part_type_id: 't', teeth: null, active: true, enabled: true }));
    const { component, api } = setup(AdminRollMastersTabComponent, (stubbed) => {
      jest.spyOn(stubbed, 'listParts').mockReturnValue(of(parts));
    });
    component.rollMasterEdits['p1'].current_quantity = 7;
    component.rollMasterEdits['p2'].current_quantity = 9;
    jest.spyOn(api, 'createRollMaster').mockReturnValue(of({ id: 'r1' } as RollMasterRow));
    component.saveRollMaster(parts[0]);
    expect(api.createRollMaster).toHaveBeenCalledWith(expect.objectContaining({ part_id: 'p1', current_quantity: 7 }));
    expect(component.rollMasterEdits['p2'].current_quantity).toBe(9);
    expect(component.message).toBe('Roll Master quantity saved for p1.');
  });

  it('normalizes a tray serial and creates it with no blades', () => {
    const { component, api } = setup(AdminTraysTabComponent);
    const create = jest.spyOn(api, 'createTray').mockReturnValue(of({} as AdminTrayRow));
    component.trayForm.serial_number = '301';
    expect(component.traySerialPreview).toBe('T0301');
    component.createTray();
    expect(create).toHaveBeenCalledWith({ serial_number: '301', blade_count: 0, enabled: true });
    expect(component.message).toBe('Tray T0301 created.');
  });
});
