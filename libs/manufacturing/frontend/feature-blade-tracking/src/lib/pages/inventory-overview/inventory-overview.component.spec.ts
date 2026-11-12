import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { of, Subject, throwError } from 'rxjs';
import { BladeTrackingApiService, InventoryTrayRow } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { InventoryOverviewComponent } from './inventory-overview.component';

const meta = { page: 1, perPage: 50, totalItems: 1, totalPages: 1, hasPreviousPage: false, hasNextPage: false };
const result = (serial: string) => ({ data: [{ id: serial, serial_number: serial } as InventoryTrayRow], meta });

function setup(api: object): InventoryOverviewComponent {
  TestBed.configureTestingModule({ providers: [{ provide: BladeTrackingApiService, useValue: api }, { provide: GearToastService, useValue: {} }] });
  return TestBed.runInInjectionContext(() => new InventoryOverviewComponent());
}

describe('Inventory Control Center independent loading', () => {
  it('keeps successful tabs usable when another inventory lookup is forbidden', () => {
    const component = setup({ getTrays: () => of(result('T123')), getContainers: () => throwError(() => new HttpErrorResponse({ status: 403 })),
      getLocations: () => of({ data: [], meta: { ...meta, totalItems: 0 } }), getBlades: () => of({ data: [], meta: { ...meta, totalItems: 0 } }) });
    component.ngOnInit();
    expect(component.trays.rows[0].serial_number).toBe('T123');
    expect(component.error).toBe(''); expect(component.activeLoading).toBe(false);
    component.setTab('containers');
    expect(component.error).toBeTruthy(); expect(component.totalContainers).toBe('—');
    component.setTab('trays'); expect(component.error).toBe(''); expect(component.totalTrays).toBe(1);
    component.ngOnDestroy();
  });

  it('renders successful inventory and a retryable failed tab instead of a false empty state', () => {
    const api = { getTrays: () => of({ data: [], meta }), getContainers: () => throwError(() => new HttpErrorResponse({ status: 403 })),
      getLocations: () => of({ data: [], meta }), getBlades: () => of({ data: [], meta }) };
    TestBed.configureTestingModule({ providers: [{ provide: BladeTrackingApiService, useValue: api }, { provide: GearToastService, useValue: {} }] });
    TestBed.overrideComponent(InventoryOverviewComponent, { set: { imports: [CommonModule, FormsModule], schemas: [NO_ERRORS_SCHEMA] } });
    const fixture = TestBed.createComponent(InventoryOverviewComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('table[aria-label="Tray inventory"]')).not.toBeNull();
    fixture.componentInstance.setTab('containers'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Retry current view');
    expect(fixture.nativeElement.querySelector('table[aria-label="Container inventory"]')).toBeNull();
    fixture.destroy();
  });

  it('does not overwrite a new search with a slow prior result or error', () => {
    const old = new Subject<ReturnType<typeof result>>(), latest = new Subject<ReturnType<typeof result>>();
    const component = setup({ getTrays: jest.fn().mockReturnValueOnce(old).mockReturnValueOnce(latest) });
    component.loadTrays(1); component.appliedSearchTerms.trays = 'NEW'; component.loadTrays(1);
    latest.next(result('NEW')); old.next(result('OLD')); old.error(new HttpErrorResponse({ status: 500 }));
    expect(component.trays.rows[0].serial_number).toBe('NEW'); expect(component.trays.error).toBe('');
    expect(component.trays.loading).toBe(false);
    expect(component.totalTrays).toBe('—'); // Filtered results do not invent an unfiltered inventory total.
    component.ngOnDestroy();
  });

  it('allows the current tab to recover while unrelated tabs are still loading', () => {
    const component = setup({ getTrays: () => of(result('T123')) });
    component.loadTrays(1);
    expect(component.anyLoading).toBe(true); expect(component.activeLoading).toBe(false);
    component.ngOnDestroy();
  });

  it('ignores late results after leaving the page', () => {
    const request = new Subject<ReturnType<typeof result>>();
    const component = setup({ getTrays: () => request });
    component.loadTrays(1); component.ngOnDestroy(); request.next(result('LATE'));
    expect(component.trays.rows).toEqual([]);
  });
});
