import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, RouterLink } from '@angular/router';
import { LapperAccess, MachinesApi, ScannerApi, ScannerDetailsApi, ToastService } from '@meshforge/client/core';
import { ScannerDetail } from '@meshforge/shared/domain';
import { of, throwError } from 'rxjs';
import { ScannersPageComponent } from './scanners-page.component';

describe('Scanners page image location', () => {
  const scanners = [
    { id: 'a', ip: '10.16.81.235', model: 'SR-X300', status: 'Active', machine_id: null, image_folder: null, image_file: null },
    { id: 'b', ip: '10.16.82.253', model: 'SR-1000', status: 'Active', machine_id: 'm1', image_folder: '181-lapper-scanners/53711922/', image_file: null },
  ] as unknown as ScannerDetail[];

  function render(imageDefaults: () => unknown) {
    TestBed.configureTestingModule({
      imports: [ScannersPageComponent],
      providers: [
        provideRouter([]),
        { provide: ScannerDetailsApi, useValue: { list: () => of(scanners) } },
        { provide: MachinesApi, useValue: { list: () => of([]) } },
        { provide: ScannerApi, useValue: { imageDefaults } },
        { provide: ToastService, useValue: { success: jest.fn(), error: jest.fn() } },
        { provide: LapperAccess, useValue: { canEditSetup: () => false } },
      ],
    });
    TestBed.overrideComponent(ScannersPageComponent, { set: { imports: [RouterLink], schemas: [NO_ERRORS_SCHEMA] } });
    const fixture = TestBed.createComponent(ScannersPageComponent);
    fixture.detectChanges();
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('td.image-path')].map((td) =>
      td.textContent?.replace(/\s+/g, ' ').trim(),
    );
  }

  it("shows each scanner's FTP folder and file, marking the default", () => {
    expect(render(() => of({ root: '181-lapper-scanners', imageFile: 'scanner-current.jpg' }))).toEqual([
      '181-lapper-scanners/10.16.81.235/scanner-current.jpgDefault: no folder set on this scanner',
      '181-lapper-scanners/53711922/scanner-current.jpg',
    ]);
  });

  it('still shows the folders set on scanners when the defaults cannot be read', () => {
    expect(render(() => throwError(() => new Error('offline')))).toEqual([
      'Default folder for 10.16.81.235',
      '181-lapper-scanners/53711922/',
    ]);
  });
});
