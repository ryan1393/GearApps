import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IPartSummarySettings, ISummaryBodyRuleRow } from '@meshforge/manufacturing/shared/util-types';
import { of, throwError } from 'rxjs';

import { AdminApiService, PartSummaryRow } from '../../admin-api.service';
import { AdminPartSummariesTabComponent } from './admin-part-summaries-tab.component';

describe('AdminPartSummariesTabComponent', () => {
  let component: AdminPartSummariesTabComponent;
  let fixture: ComponentFixture<AdminPartSummariesTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminPartSummariesTabComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const api = TestBed.inject(AdminApiService);
    jest.spyOn(api, 'listPartSummaries').mockReturnValue(of({ data: [], meta: { hasNextPage: false } }));
    jest.spyOn(api, 'listModels').mockReturnValue(of([]));
    jest.spyOn(api, 'listSummaryBodyRules').mockReturnValue(of([]));
    jest.spyOn(api, 'listPartSummarySettings').mockReturnValue(of([]));
    fixture = TestBed.createComponent(AdminPartSummariesTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('Edit Part Summary: one save for every field', () => {
    const summary = { id: 's30538', number: '30538', revision: 'D', model_id: null, hos: 'LH', active: true, enabled: true } as PartSummaryRow;
    const settings: IPartSummarySettings = {
      summary_id: 's30538', summary_number: '30538', summary_revision: 'D', model_id: null, hos: 'LH',
      part_types: [
        { part_type_id: 'r', part_type_code: 'RING', hos: 'RH', inner_blade: 'RH IB', outer_blade: 'RH OB' },
        { part_type_id: 'p', part_type_code: 'PINION', hos: 'LH', inner_blade: 'LH IB', outer_blade: 'RH IB' },
      ],
      body_rule: { summary_id: 's30538', required_blade_sets: 19, required_total_blades: 38, configured_body_rule: null } as ISummaryBodyRuleRow,
    };
    beforeEach(() => {
      component.summarySettingsList.set(new Map([[summary.id, settings]]));
      component.summaryBodyRulesList.set(new Map([[summary.id, settings.body_rule]]));
      component.beginEditPartSummary(summary);
    });

    it('loads each Part Type group separately, keeping PINION Outer blade RH IB', () => {
      expect(component.summaryTypeForm.RING).toEqual({ hos: 'RH', inner_blade: 'RH IB', outer_blade: 'RH OB' });
      expect(component.summaryTypeForm.PINION).toEqual({ hos: 'LH', inner_blade: 'LH IB', outer_blade: 'RH IB' });
      expect(component.summaryBodyRuleChoice).toBe('KEEP');
      expect(component.summaryRequiredBladesPreview).toContain('38 blades (19 sets)');
    });

    it('sends Revision, both groups and no body rule in ONE request when the rule is kept', () => {
      const save = jest.spyOn(TestBed.inject(AdminApiService), 'savePartSummary').mockReturnValue(of(settings));
      component.summaryForm.revision = 'E';
      component.summaryTypeForm.RING.inner_blade = '';
      component.createPartSummary();
      expect(save).toHaveBeenCalledTimes(1);
      const [, body] = save.mock.calls[0];
      expect(body).toEqual({
        number: '30538', revision: 'E', model_id: null, hos: 'LH',
        part_types: {
          RING: { hos: 'RH', inner_blade: null, outer_blade: 'RH OB' },
          PINION: { hos: 'LH', inner_blade: 'LH IB', outer_blade: 'RH IB' },
        },
      });
      expect('body_rule' in body).toBe(false);
    });

    it('includes an explicit Body Size change and previews its Required Blades', () => {
      const save = jest.spyOn(TestBed.inject(AdminApiService), 'savePartSummary').mockReturnValue(of(settings));
      component.summaryBodyRuleChoice = '105';
      expect(component.summaryRequiredBladesPreview).toContain('38 blades');
      component.createPartSummary();
      expect(save.mock.calls[0][1].body_rule).toBe('105');
    });

    it('asks in the page before a Body Size change alters Required Blades', () => {
      const save = jest.spyOn(TestBed.inject(AdminApiService), 'savePartSummary').mockReturnValue(of(settings));
      component.summaryBodyRuleChoice = '088';
      component.createPartSummary();
      expect(save).not.toHaveBeenCalled();
      expect(component.confirmation.request?.message).toContain('Required Blades from 38 to 34');
      component.confirmation.accept();
      expect(save.mock.calls[0][1].body_rule).toBe('088');
    });

    it('keeps the draft when the save fails', () => {
      jest.spyOn(TestBed.inject(AdminApiService), 'savePartSummary').mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'already exists' } })));
      component.summaryForm.revision = 'C';
      component.summaryTypeForm.PINION.outer_blade = 'RH IB';
      component.createPartSummary();
      expect(component.editingPartSummaryId).toBe('s30538');
      expect(component.summaryForm.revision).toBe('C');
      expect(component.summaryTypeForm.PINION.outer_blade).toBe('RH IB');
      expect(component.busy).toBe(false);
    });
  });

});
