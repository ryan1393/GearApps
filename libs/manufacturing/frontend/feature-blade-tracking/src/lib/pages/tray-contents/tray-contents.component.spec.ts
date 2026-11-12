import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, Subject } from 'rxjs';
import { BladeTrackingApiService, InventoryTrayRow, TrayDetails } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { TrayContentsComponent } from './tray-contents.component';

function setup(api: object, queryParamMap = new Subject<ReturnType<typeof convertToParamMap>>()): TrayContentsComponent {
  TestBed.configureTestingModule({ providers: [{ provide: BladeTrackingApiService, useValue: api }, { provide: GearToastService, useValue: {} },
    { provide: ActivatedRoute, useValue: { queryParamMap } }] });
  return TestBed.runInInjectionContext(() => new TrayContentsComponent());
}
const tray = (serial: string) => ({ id: serial, serial_number: serial } as InventoryTrayRow);
const details = (serial: string) => ({ tray: tray(serial), blades: [], location: null, container: null } as TrayDetails);

describe('Tray Contents serial navigation', () => {
  it('honors a newer top-bar search while old tray details are still loading', () => {
    const query = new Subject<ReturnType<typeof convertToParamMap>>();
    const oldDetails = new Subject<TrayDetails>();
    const api = { scanTray: jest.fn((serial: string) => of(tray(serial))), getTrayDetails: jest.fn().mockReturnValueOnce(oldDetails).mockReturnValueOnce(of(details('NEW'))) };
    const component = setup(api, query); component.ngOnInit();
    query.next(convertToParamMap({ serial: 'OLD' })); expect(component.busy).toBe(true);
    query.next(convertToParamMap({ serial: 'NEW' }));
    oldDetails.next(details('OLD')); oldDetails.error(new HttpErrorResponse({ status: 500 }));
    expect(component.details?.tray.serial_number).toBe('NEW'); expect(component.busy).toBe(false);
    expect(component.message?.tone).toBe('success'); component.ngOnDestroy();
  });

  it('does not start a details fetch from a superseded tray lookup', () => {
    const oldTray = new Subject<InventoryTrayRow>();
    const api = { scanTray: jest.fn().mockReturnValueOnce(oldTray).mockReturnValueOnce(of(tray('NEW'))), getTrayDetails: jest.fn(() => of(details('NEW'))) };
    const component = setup(api); component.scan('OLD'); component.scan('NEW'); oldTray.next(tray('OLD'));
    expect(api.getTrayDetails).toHaveBeenCalledTimes(1); expect(component.details?.tray.serial_number).toBe('NEW'); component.ngOnDestroy();
  });
});
