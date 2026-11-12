import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { CoaterRpaSetupComponent } from './coater-rpa-setup.component';

const API = '/api/v1/admin/coater-rpa';
const mapping = { summary: '1.955FC', part_type: 'RING' as const, outer_part: 'OUT-1', inner_part: 'IN-1' };
const setup = { settings: null, form: null, part_map: [mapping], last_number: null, email_enabled: false, ready: false };

describe('CoaterRpaSetupComponent: removing a part mapping', () => {
  it('asks in the page first and sends nothing until confirmed', () => {
    TestBed.configureTestingModule({ imports: [CoaterRpaSetupComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(CoaterRpaSetupComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(API).flush(setup);
    const component = fixture.componentInstance;

    component.removeMapping(mapping);
    http.expectNone(`${API}/part-map/remove`);
    expect(component.pendingRemoval).toBe(mapping);

    component.pendingRemoval = null;
    component.confirmRemoval();
    http.expectNone(`${API}/part-map/remove`);

    component.removeMapping(mapping);
    component.confirmRemoval();
    const request = http.expectOne(`${API}/part-map/remove`);
    expect(request.request.body).toEqual({ summary: '1.955FC', part_type: 'RING' });
    request.flush({ ...setup, part_map: [] });
    expect(component.pendingRemoval).toBeNull();
    http.verify();
  });
});
