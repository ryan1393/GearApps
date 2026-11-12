import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Signal } from '@angular/core';
import { CycleTestsPageComponent } from './cycle-tests-page.component';

interface Lab {
  machineId: string; gearsetId: string; serial: string;
  values: Record<string,number|null>;
  working: Signal<boolean>; readError: Signal<string>;
  readFromMachine(): void; run(): void; sendToArgonaut(): void;
  argonautConfirm: Signal<{ message: string } | null>; confirmArgonautSend(): void; cancelArgonautSend(): void;
}

describe('Cycle Test Lab request context', () => {
  function setup() {
    TestBed.configureTestingModule({ imports:[CycleTestsPageComponent], providers:[provideHttpClient(),provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(CycleTestsPageComponent);
    const lab = fixture.componentInstance as unknown as Lab;
    lab.machineId='machine-a'; lab.gearsetId='gearset-a'; lab.serial='serial-a'; lab.values={'10020':5};
    return {fixture,lab,http:TestBed.inject(HttpTestingController)};
  }
  afterEach(()=>TestBed.inject(HttpTestingController).verify());
  it('ignores controller values after the selected machine changes', () => {
    const {lab,http} = setup();
    lab.readFromMachine();
    const read=http.expectOne('/api/v1/admin/cycle-tests/controller-values');
    expect(read.request.body).toEqual({machine_id:'machine-a'});
    expect(lab.working()).toBe(true);
    lab.run(); http.expectNone('/api/v1/admin/cycle-tests');
    lab.machineId='machine-b';
    read.flush({machine_id:'machine-a',read_at:'2026-11-12T00:00:00Z',values:{'10020':9}});
    expect(lab.values['10020']).toBe(5);
    expect(lab.working()).toBe(false);
    expect(lab.readError()).toContain('selected machine changed');
  });
  it('sends exactly the input previewed and confirmed, even if selection changes asynchronously', () => {
    const {lab,http} = setup();
    lab.sendToArgonaut();
    const preview=http.expectOne('/api/v1/admin/cycle-tests/argonaut/preview');
    const original=preview.request.body;
    preview.flush({url:'https://example.invalid/argonaut',payload:{request:{serialNumber:'serial-a',partNumber:'part-a',sequence:1}}});
    http.expectNone('/api/v1/admin/cycle-tests/argonaut');
    expect(lab.argonautConfirm()?.message).toContain('Serial: serial-a');
    lab.machineId='machine-b'; lab.serial='serial-b'; lab.values={'10020':99};
    lab.confirmArgonautSend();
    const sent=http.expectOne('/api/v1/admin/cycle-tests/argonaut');
    expect(sent.request.body).toEqual(original);
    expect(sent.request.body.serial_number).toBe('serial-a');
    expect(sent.request.body.machine_id).toBe('machine-a');
    expect(sent.request.body.values).toEqual({'10020':5});
    sent.flush({ok:true});
    expect(lab.working()).toBe(false);
  });
  it('sends nothing when the Argonaut confirmation is cancelled', () => {
    const {lab,http} = setup();
    lab.sendToArgonaut();
    http.expectOne('/api/v1/admin/cycle-tests/argonaut/preview')
      .flush({url:'https://example.invalid/argonaut',payload:{request:{serialNumber:'serial-a',partNumber:'part-a',sequence:1}}});
    expect(lab.working()).toBe(true);
    lab.cancelArgonautSend();
    http.expectNone('/api/v1/admin/cycle-tests/argonaut');
    expect(lab.argonautConfirm()).toBeNull();
    expect(lab.working()).toBe(false);
  });
});
