import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DsfMachineMappingsComponent } from './dsf-machine-mappings.component';

const ADMIN = '/api/v1/greenshed/dsf-counts/admin-mappings';
const MATCHES = ADMIN + '/unique-matches';
const board = {
  format: 'DSFMAPADMIN1', status: 'OK', enabled: true, configured: true, interval_seconds: 60,
  last_success_at: '2026-11-12T00:00:00Z', served_at: '2026-11-12T00:00:00Z', cutter_write_enabled: false,
  last_failure: null, config_problem: null, source_options_problem: null,
  source_options_status: 'READY', source_options_refreshed_at: '2026-11-12T00:00:00Z', source_options: [], rows: [],
};

describe('DsfMachineMappingsComponent: Map Unique Matches', () => {
  let fixture: ComponentFixture<DsfMachineMappingsComponent>;
  let http: HttpTestingController;
  const page = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) => Array.from(page().querySelectorAll('button')).find(b => b.textContent?.includes(text)) as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DsfMachineMappingsComponent], providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(DsfMachineMappingsComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(ADMIN).flush(board);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('previews the matches, then maps the confirmed ones and reports any it could not', () => {
    button('Map Unique Matches').click();
    http.expectOne(MATCHES).flush({
      matches: [{ machine_id: 'm549', machine_number: '549', department: '132', mapping_id: 's549', whiteboard_name: '132 PIN CUTTER 549', line_name: 'Line 549' }],
      skipped: [{ machine_id: 'm552', machine_number: '552', department: '132', reason: 'SEVERAL_SOURCES' }],
    });
    fixture.detectChanges();
    expect(page().textContent).toContain('132 PIN CUTTER 549');
    expect(page().textContent).toContain('More than one DSF source ends in this machine number');

    button('Map 1 Machine').click();
    const save = http.expectOne(MATCHES);
    expect(save.request.method).toBe('POST');
    expect(save.request.body).toEqual({ matches: [{ machine_id: 'm549', mapping_id: 's549' }] });
    save.flush({ mapped: [{ machine_id: 'm549', machine_number: '549', whiteboard_name: '132 PIN CUTTER 549' }], skipped: [] });
    fixture.detectChanges();
    expect(page().textContent).toContain('1 machine mapped.');
    expect(page().textContent).not.toContain('Map 1 Machine');
  });

  it('says so when nothing matches', () => {
    button('Map Unique Matches').click();
    http.expectOne(MATCHES).flush({ matches: [], skipped: [] });
    fixture.detectChanges();
    expect(page().textContent).toContain('No unmapped machine has exactly one matching DSF source.');
  });
});
