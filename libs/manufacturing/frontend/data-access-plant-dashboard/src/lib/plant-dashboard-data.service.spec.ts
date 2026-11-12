import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { PlantDashboardDataService } from './plant-dashboard-data.service';

const counts = { format: 'DSFCOUNT1', configured: false, interval_seconds: 60, last_success_at: null, served_at: new Date().toISOString(), rows: [] };
const mappings = { format: 'DSFMAPADMIN1', configured: false, interval_seconds: 60, source_options_status: 'WAITING', source_options_refreshed_at: null, source_options: [] };

describe('PlantDashboardDataService', () => {
  let http: HttpTestingController;
  function configure(role: string): PlantDashboardDataService {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), PlantDashboardDataService,
      { provide: AuthSessionService, useValue: { currentUser: { role } } }] });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(PlantDashboardDataService);
  }
  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  it('polls cached snapshots for administrators and stops polling when its scope is destroyed', fakeAsync(() => {
    const service = configure('ADMIN');
    tick(0);
    http.expectOne('/api/v1/dsf-counts').flush(counts);
    http.expectOne('/api/v1/dsf-counts/admin-mappings').flush(mappings);
    expect(service.board()).toEqual(counts);
    expect(service.mappingBoard()).toEqual(mappings);
    tick(30000);
    http.expectOne('/api/v1/dsf-counts').flush(counts);
    http.expectOne('/api/v1/dsf-counts/admin-mappings').flush(mappings);
    TestBed.resetTestingModule();
    tick(60000);
    http.verify();
  }));

  it('recovers after a failed count request without requesting administrator data for a regular user', fakeAsync(() => {
    const service = configure('USER');
    tick(0);
    http.expectOne('/api/v1/dsf-counts').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.board()).toBeNull();
    expect(service.error()).toContain('unavailable');
    expect(service.loading()).toBe(false);
    service.refresh();
    http.expectOne('/api/v1/dsf-counts').flush(counts);
    expect(service.error()).toBe('');
    expect(service.board()).toEqual(counts);
    http.expectNone('/api/v1/dsf-counts/admin-mappings');
    TestBed.resetTestingModule();
  }));

  it('keeps malformed source coverage unavailable without losing the production snapshot', fakeAsync(() => {
    const service = configure('ADMIN');
    tick(0);
    http.expectOne('/api/v1/dsf-counts').flush(counts);
    http.expectOne('/api/v1/dsf-counts/admin-mappings').flush({ format: 'UNSUPPORTED' });
    expect(service.mappingBoard()).toBeNull();
    expect(service.mappingError()).toContain('unavailable');
    expect(service.board()).toEqual(counts);
    TestBed.resetTestingModule();
  }));

  it('starts a clean user scope after an administrator leaves, without retaining source metadata', fakeAsync(() => {
    const admin = configure('ADMIN');
    tick(0);
    http.expectOne('/api/v1/dsf-counts').flush(counts);
    http.expectOne('/api/v1/dsf-counts/admin-mappings').flush(mappings);
    expect(admin.mappingBoard()).not.toBeNull();
    TestBed.resetTestingModule();
    const user = configure('USER');
    expect(user.mappingBoard()).toBeNull();
    tick(0);
    http.expectOne('/api/v1/dsf-counts').flush(counts);
    http.expectNone('/api/v1/dsf-counts/admin-mappings');
    TestBed.resetTestingModule();
  }));
});
