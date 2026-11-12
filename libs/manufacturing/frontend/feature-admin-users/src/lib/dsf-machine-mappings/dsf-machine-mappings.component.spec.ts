import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DsfMachineMappingsComponent } from './dsf-machine-mappings.component';

const ADMIN = '/api/v1/greenshed/dsf-counts/admin-mappings';
const MATCHES = ADMIN + '/unique-matches';
const ROUGH = ADMIN + '/rough-matches';
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

  it('rough-matches every DSF source, lets you choose, and maps what you picked', () => {
    button('Rough Match').click();
    http.expectOne(ROUGH).flush({
      machines: [
        { machine_id: 'm549', machine_number: '549', department: '132', status: 'PROPOSED', current_source: null, current_looks_right: null, proposed_mapping_id: 's549',
          candidates: [{ mapping_id: 's549', whiteboard_name: '132 PIN CUTTER 549', line_name: 'L', reason: 'ENDS_IN_NUMBER' }] },
        { machine_id: 'm553', machine_number: '553', department: '132', status: 'CHOOSE', current_source: null, current_looks_right: null, proposed_mapping_id: null,
          candidates: [{ mapping_id: 's553a', whiteboard_name: '553 A', line_name: 'L', reason: 'NAME_HAS_NUMBER' }, { mapping_id: 's553b', whiteboard_name: '553 B', line_name: 'L', reason: 'NAME_HAS_NUMBER' }] },
        { machine_id: 'm501', machine_number: '501', department: '132', status: 'MAPPED', current_source: '132 PIN CUTTER 502', current_looks_right: false, proposed_mapping_id: null, candidates: [] },
      ],
      sources: [{ mapping_id: 'x', department: '152', whiteboard_name: '152 RING CUTTER 549', line_name: 'L', outcome: 'NO_MACHINE', machine_numbers: [], other_departments: ['132'] }],
    });
    fixture.detectChanges();
    const text = page().textContent || '';
    expect(text).toContain('1 matched, 1 to choose');
    expect(text).toContain('More than one possible source: choose one');
    expect(text).toContain('does not look like it: 132 PIN CUTTER 502');
    expect(text).toContain('No machine: the number is a machine in Dept 132');

    const selects = page().querySelectorAll<HTMLSelectElement>('select[aria-label^="DSF source for machine"]');
    selects[1].value = selects[1].options[2].value;
    selects[1].dispatchEvent(new Event('change'));
    fixture.detectChanges();
    button('Map 2 Machines').click();
    const save = http.expectOne(ROUGH);
    expect(save.request.method).toBe('POST');
    expect(save.request.body).toEqual({ matches: [{ machine_id: 'm549', mapping_id: 's549' }, { machine_id: 'm553', mapping_id: 's553b' }] });
    save.flush({ mapped: [{ machine_id: 'm549', machine_number: '549', whiteboard_name: '132 PIN CUTTER 549' }, { machine_id: 'm553', machine_number: '553', whiteboard_name: '553 B' }], skipped: [] });
    fixture.detectChanges();
    expect(page().textContent).toContain('2 machines mapped.');
  });

  it('asks in the page before unmapping a machine and sends nothing until confirmed', () => {
    const component = fixture.componentInstance;
    const row = { machine_id: 'm549', machine_number: '549', department: '132', active: true, status: 'OK', count: 1, note: '', shift_number: 1,
      as_of: null, mapping_origin: 'ADMIN', mapping: { mapping_id: 's549', whiteboard_name: '132 PIN CUTTER 549', line_name: 'Line 549' }, writer_status: '', writer_reason: '' };
    (component as unknown as { board: unknown }).board = { ...board, rows: [row] };
    component.open(row as never);
    component.unmap();
    http.expectNone(request => request.method === 'DELETE');
    expect(component.confirmingUnmap).toBe(true);
    component.unmap(true);
    expect(component.confirmingUnmap).toBe(false);
    http.expectOne(request => request.method === 'DELETE' && request.url === ADMIN + '/m549').flush(null);
    http.match(() => true).forEach(request => request.flush(board));
  });
});
