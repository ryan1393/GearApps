import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BulkOpeningComponent } from './bulk-opening.component';
import { OPENING_IMPORT_HEADER } from './opening-import';

const API = '/api/v1/bladeTrays/opening-inventory';
const csv = OPENING_IMPORT_HEADER + '\nT0001,1010 rev A,RING,READY_FOR_COATING,CGRR-A1A,0\nT0002,1010 rev A,RING,READY_FOR_COATING,CGRR-A1B,0';

describe('BulkOpeningComponent', () => {
  let fixture: ComponentFixture<BulkOpeningComponent>;
  let component: BulkOpeningComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    fixture = TestBed.createComponent(BulkOpeningComponent);
    component = fixture.componentInstance;
    component.summaries = [{ id: 'summary-one', label: '1010 rev A' }];
    component.partTypes = [{ id: 'ring-one', code: 'RING' }];
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const event = (file: { size: number; text: () => Promise<string> }) => ({ target: { files: [file], value: 'inventory.csv' } } as unknown as Event);

  it('does not let a late file read replace CSV pasted or cleared afterward', async () => {
    let resolve!: (text: string) => void;
    const pending = component.file(event({ size: 100, text: () => new Promise<string>(done => { resolve = done; }) }));
    expect(component.readingFile).toBe(true);
    component.text = csv;
    component.invalidate();
    resolve('outdated file');
    await pending;
    expect(component.text).toBe(csv);
    expect(component.readingFile).toBe(false);
    http.expectNone(API + '/preview');
  });

  it('clears stale CSV when the chosen file is too large instead of allowing the old import', async () => {
    component.text = csv;
    const read = jest.fn();
    await component.file(event({ size: 100_001, text: read }));
    expect(read).not.toHaveBeenCalled();
    expect(component.text).toBe('');
    expect(component.error).toContain('smaller than 100 KB');
    expect(component.canCommit).toBe(false);
  });

  it('reports row progress and retains successful inventory when another row fails', async () => {
    component.text = csv;
    const preview = component.preview();
    expect(component.progress).toContain('Validating tray 1 of 2');
    http.expectOne(API + '/preview').flush({ blade_count: 38 });
    await Promise.resolve();
    expect(component.progress).toContain('Validating tray 2 of 2');
    http.expectOne(API + '/preview').flush({ blade_count: 38 });
    await preview;
    expect(component.canCommit).toBe(true);
    const recorded = jest.spyOn(component.recorded, 'emit');
    const commit = component.commit();
    expect(component.progress).toContain('Recording tray 1 of 2');
    http.expectOne(API).flush({});
    await Promise.resolve();
    expect(component.progress).toContain('Recording tray 2 of 2');
    http.expectOne(API).flush({ message: 'Tray is already in use.' }, { status: 409, statusText: 'Conflict' });
    await commit;
    expect(component.rows.map(row => row.state)).toEqual(['saved', 'failed']);
    expect(component.rows[1].error).toContain('already in use');
    expect(component.message).toBe('1 saved; 1 failed.');
    expect(component.canCommit).toBe(false);
    expect(component.busy).toBe(false);
    expect(component.progress).toBe('');
    expect(recorded).toHaveBeenCalledTimes(1);
    component.clear();
    expect(component.rows).toEqual([]);
    http.expectNone(API);
  });
});
