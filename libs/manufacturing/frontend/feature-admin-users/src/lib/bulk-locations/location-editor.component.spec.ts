import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { AdminApiService, AdminLocationRow } from '../admin-api.service';
import { LocationEditorComponent } from './location-editor.component';

const location = (id: string): AdminLocationRow => ({ id, serial_number: 'CGRR-' + id, number: id, description: 'Original', department: 'CUTTERGRIND', location_type: 'SHELF', enabled: true, tray_count: 0, blade_count: 0 });
describe('location mass edit', () => {
  it('keeps a matching row visible while its description is being edited', () => {
    TestBed.configureTestingModule({ providers: [
      { provide: AdminApiService, useValue: {} },
      { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn() } },
    ] });
    const editor = TestBed.runInInjectionContext(() => new LocationEditorComponent());
    editor.locations = [location('A1A')];
    editor.filter = 'Original';
    editor.rows[0].description = 'Replacement';
    expect(editor.visible).toHaveLength(1);
    editor.cancel();
    expect(editor.visible[0].description).toBe('Original');
  });
  it('retains successful edits, reports failed rows, and cancels only unsaved changes', async () => {
    const update = jest.fn().mockReturnValueOnce(of({ ...location('A1A'), description: 'Saved' }))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Conflict' } })));
    TestBed.configureTestingModule({ providers: [
      { provide: AdminApiService, useValue: { updateLocation: update } },
      { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn() } },
    ] });
    const editor = TestBed.runInInjectionContext(() => new LocationEditorComponent());
    editor.locations = [location('A1A'), location('A1B')];
    editor.selectVisible();
    editor.rows[0].description = 'Saved'; editor.rows[1].description = 'Failed';
    await editor.save();
    expect(editor.message).toContain('1 saved; 1 failed');
    expect(editor.rows[0]).toMatchObject({ original: 'Saved', selected: false, result: 'Saved' });
    expect(editor.rows[1]).toMatchObject({ original: 'Original', description: 'Failed', selected: true, result: 'Conflict' });
    editor.cancel();
    expect(editor.rows.map(row => row.description)).toEqual(['Saved', 'Original']);
  });
  it('does not send invalid or unselected edits', async () => {
    const update = jest.fn();
    TestBed.configureTestingModule({ providers: [
      { provide: AdminApiService, useValue: { updateLocation: update } },
      { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn() } },
    ] });
    const editor = TestBed.runInInjectionContext(() => new LocationEditorComponent());
    editor.locations = [location('A1A')]; editor.rows[0].description = 'x'.repeat(256); editor.selectVisible();
    await editor.save(); expect(update).not.toHaveBeenCalled();
    editor.rows[0].description = 'Valid'; editor.rows[0].selected = false;
    await editor.save(); expect(update).not.toHaveBeenCalled();
  });
});
