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

  it('shows both gearsets that share a pinion and Summary, with business status apart from Status', () => {
    const fixture = TestBed.createComponent(LappingGearsetsComponent);
    fixture.detectChanges();
    const pinion = { id: 'p', number: '10060466', teeth: 11 };
    const summary = { number: '30634', model: '200' };
    http.expectOne('/api/v1/gearset').flush([
      { id: 'g1', number: '10060460', rev: 'C', ratio: 3.7273, status: 'active', summary_id: 's', summary, pinion_id: 'p', pinion,
        ring_id: 'r1', ring: { number: '10060462', teeth: 41 }, user_id: null, customer: 'Stellantis', application: 'JL Jeep Wrangler Front',
        business_statuses: ['Production'], cut: '3-Axis', archived: false },
      { id: 'g2', number: '10161958', rev: 'C', ratio: 3.4545, status: 'active', summary_id: 's', summary, pinion_id: 'p', pinion,
        ring_id: 'r2', ring: { number: '10161959', teeth: 38 }, user_id: null, business_statuses: ['Service'], archived: false },
    ]);
    http.expectOne('/api/v1/part').flush([]);
    http.expectOne('/api/v1/part-summary').flush([]);
    fixture.detectChanges();
    const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'), (r) => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('10060466 / 10060462');
    expect(rows[1]).toContain('10060466 / 10161959');
    expect(rows.every((r) => r.includes('30634'))).toBe(true);
    expect(rows[0]).toContain('Stellantis');
    expect(rows[0]).toContain('Production');
    // A Service gearset keeps its business status and stays usable.
    expect(rows[1]).toContain('Service');
    expect(rows[1].toLowerCase()).toContain('active');
    expect(rows[1]).not.toContain('archived');
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
