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

    it('reads the summary tag as Summary-PART TYPE, and only once both are set', () => {
      const location = { summary: { id: 's', number: '1.955fc' }, part_type: { id: 'r', code: 'RING' } } as AdminLocationRow;
      expect(component.locationSummaryTag(location)).toBe('1.955FC-RING');
      expect(component.locationSummaryTag({ ...location, part_type: null })).toBeNull();
    });
  });
});
