import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { FrontendFeatureAdminUsersComponent } from '../frontend-feature-admin-users/frontend-feature-admin-users.component';
import { LappingGearsetsComponent } from './lapping-gearsets.component';
import { LappingMachinesComponent } from './lapping-machines.component';
import { ARGONAUT_URL_PATTERN } from './machine-options';

describe('Lapping master data in Admin', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('lists gearsets from the shared gearset API', () => {
    const fixture = TestBed.createComponent(LappingGearsetsComponent);
    fixture.detectChanges();
    http.expectOne('/api/v1/gearset').flush([
      {
        id: 'g1',
        number: '060GS104',
        rev: 'A',
        ratio: 3.4167,
        status: 'active',
        summary_id: 's1',
        summary: { number: '060' },
        pinion_id: 'p1',
        pinion: { number: 'P1', teeth: 12 },
        ring_id: 'r1',
        ring: { number: 'R1', teeth: 41 },
        user_id: null,
      },
    ]);
    http.expectOne('/api/v1/part').flush([]);
    http.expectOne('/api/v1/part-summary').flush([]);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('060GS104');
    expect(text).toContain('P1 / R1');
    expect(text).toContain('(41:12)');
  });

  it('suggests enabled production machines that have no Lapping setup yet', () => {
    const fixture = TestBed.createComponent(LappingMachinesComponent);
    fixture.componentRef.setInput('sharedMachines', [
      { id: 'm1', machine_number: '01-094-001', department_id: 'd', cell: 1, machine_type: 'PRODUCTION', active: true, enabled: true },
      { id: 'm2', machine_number: '01-094-002', department_id: 'd', cell: 1, machine_type: 'PRODUCTION', active: true, enabled: true },
      { id: 'm3', machine_number: 'CB-1', department_id: 'd', cell: null, machine_type: 'CUTTER_BUILDER', active: true, enabled: true },
    ]);
    fixture.detectChanges();
    http.expectOne('/api/v1/machine').flush([
      { id: 'm1', number: '01-094-001', ip: '10.0.0.1', dept_id: '45', description: null, type: 'L-60', builder: 'Gleason', cell: '1', status: 'active' },
    ]);
    http.expectOne('/api/v1/scanner-detail').flush([]);
    http.expectOne('/api/v1/department').flush([]);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as { unconfiguredNumbers: () => string[] };
    expect(component.unconfiguredNumbers()).toEqual(['01-094-002']);
    expect(fixture.nativeElement.textContent).toContain('10.0.0.1');
  });

  it('shows where each machine sends cycles to Argonaut', () => {
    const fixture = TestBed.createComponent(LappingMachinesComponent);
    fixture.detectChanges();
    http.expectOne('/api/v1/machine').flush([
      { id: 'm1', number: 'A', ip: '10.0.0.1', dept_id: '45', description: null, type: null, builder: null, cell: '1', status: 'active',
        argonaut_url: 'https://10.0.0.9:3003/api/mes/trigger-transaction', argonaut_location_id: 'loc-1' },
      { id: 'm2', number: 'B', ip: '10.0.0.2', dept_id: '45', description: null, type: null, builder: null, cell: '1', status: 'active' },
    ]);
    http.expectOne('/api/v1/scanner-detail').flush([]);
    http.expectOne('/api/v1/department').flush([]);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('10.0.0.9:3003');
    expect(text).toContain('Default');
  });

  it('accepts only http(s) Argonaut addresses', () => {
    expect(ARGONAUT_URL_PATTERN.test('https://10.0.0.9:3003/api/mes/trigger-transaction?locationId=abc-123')).toBe(true);
    expect(ARGONAUT_URL_PATTERN.test('http://argonaut/x?y=1')).toBe(true);
    expect(ARGONAUT_URL_PATTERN.test('10.0.0.9:3003')).toBe(false);
    expect(ARGONAUT_URL_PATTERN.test('ftp://host/x')).toBe(false);
  });

  it('opens the tab named in ?tab= and keeps the URL in step with the selected tab', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?tab=gearsets');
    const fixture = TestBed.createComponent(FrontendFeatureAdminUsersComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTab).toBe('gearsets');

    fixture.componentInstance.setTab('lapping-machines');
    await fixture.whenStable();
    expect(router.url).toBe('/?tab=lapping-machines');
  });
});
