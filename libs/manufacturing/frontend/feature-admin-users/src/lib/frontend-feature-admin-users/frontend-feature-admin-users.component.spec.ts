import { HttpClientModule } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AdminApiService, AdminLocationRow } from '../admin-api.service';

import { FrontendFeatureAdminUsersComponent } from './frontend-feature-admin-users.component';

describe('FrontendFeatureAdminUsersComponent', () => {
  let component: FrontendFeatureAdminUsersComponent;
  let fixture: ComponentFixture<FrontendFeatureAdminUsersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FrontendFeatureAdminUsersComponent, HttpClientModule],
    }).compileComponents();

    fixture = TestBed.createComponent(FrontendFeatureAdminUsersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('location Summary and part type', () => {
    const fill = (serial: string) => {
      component.locationForm = { serial_number: serial, number: 'A-03', description: '', department: '', location_type: 'SHELF', enabled: true, summary_id: 'summary-1', part_type_id: 'ring' };
    };

    it('saves the chosen Summary and part type with the location', () => {
      const create = jest.spyOn(TestBed.inject(AdminApiService), 'createLocation').mockReturnValue(of({} as AdminLocationRow));
      fill('RACK-A-03');
      component.saveLocation();

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ serial_number: 'RACK-A-03', summary_id: 'summary-1', part_type_id: 'ring' }));
    });

    it('sends none for a Green Shed summary shelf, whose barcode sets them', () => {
      const create = jest.spyOn(TestBed.inject(AdminApiService), 'createLocation').mockReturnValue(of({} as AdminLocationRow));
      fill('GSR-1.955FC');
      expect(component.locationContentsFromBarcode).toBe(true);
      component.saveLocation();

      const payload = create.mock.calls[0][0];
      expect(payload).not.toHaveProperty('summary_id');
      expect(payload).not.toHaveProperty('part_type_id');
    });

    it('takes the part type from the R or P in a shelf barcode and sends only the Summary', () => {
      const create = jest.spyOn(TestBed.inject(AdminApiService), 'createLocation').mockReturnValue(of({} as AdminLocationRow));
      fill('cgdp-a1a');
      expect(component.locationContentsFromBarcode).toBe(false);
      expect(component.locationBarcodePartType).toBe('PINION');
      component.saveLocation();

      const payload = create.mock.calls[0][0];
      expect(payload).toMatchObject({ serial_number: 'CGDP-A1A', summary_id: 'summary-1' });
      expect(payload).not.toHaveProperty('part_type_id');

      fill('CGFR-B2C');
      expect(component.locationBarcodePartType).toBe('RING');
      fill('RACK-A-03');
      expect(component.locationBarcodePartType).toBeNull();
    });

    it('lists each Summary number once, without revisions', () => {
      const row = (id: string, number: string, revision: string, active = true, enabled = true) =>
        ({ id, number, revision, active, enabled, model_id: null, hos: null });
      component.partSummaries = [
        row('a-1', '1.955FC', '1'),
        row('a-2', '1.955FC', '2'),
        row('a-3', '1.955FC', '3', false),
        row('b-1', '1.500FC', 'A'),
        row('c-1', '2.000FC', 'A', true, false),
      ];
      component.locationForm = { ...component.locationForm, summary_id: '' };
      expect(component.locationSummaryChoices.map((s) => s.id)).toEqual(['b-1', 'a-2']);

      component.locationForm = { ...component.locationForm, summary_id: 'a-1' };
      expect(component.locationSummaryChoices.map((s) => s.id)).toEqual(['b-1', 'a-1']);
    });

    it('reads the summary tag as Summary-PART TYPE, and only once both are set', () => {
      const location = { summary: { id: 's', number: '1.955fc' }, part_type: { id: 'r', code: 'RING' } } as AdminLocationRow;
      expect(component.locationSummaryTag(location)).toBe('1.955FC-RING');
      expect(component.locationSummaryTag({ ...location, part_type: null })).toBeNull();
    });
  });
});
