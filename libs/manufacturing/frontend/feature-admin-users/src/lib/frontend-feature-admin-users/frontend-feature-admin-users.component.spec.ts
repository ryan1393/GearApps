import { HttpClientModule } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { HttpErrorResponse } from '@angular/common/http';
import { IPartSummarySettings, ISummaryBodyRuleRow } from '@meshforge/manufacturing/shared/util-types';

import { AdminApiService, AdminLocationRow, AdminTrayRow, AdminUser, PartSummaryRow } from '../admin-api.service';

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

  describe('account form feedback', () => {
    it('focuses invalid account details and prevents a malformed email from reaching the API', () => {
      const create = jest.spyOn(TestBed.inject(AdminApiService), 'createUser');
      component.userForm = { email: 'not-an-email', password: 'Valid-Password1!', firstName: '', lastName: '', departmentId: 'department-one', role: 'user' };
      component.createUser();
      expect(create).not.toHaveBeenCalled();
      expect(component.error).toContain('valid email address');
      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#admin-user-email'));
    });

    it('keeps a failed save visible with the typed account draft', () => {
      jest.spyOn(TestBed.inject(AdminApiService), 'createUser').mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'That email is already registered.' } })));
      component.userForm = { email: 'lead@example.com', password: 'Valid-Password1!', firstName: 'Team', lastName: 'Lead', departmentId: 'department-one', role: 'user' };
      component.createUser();
      expect(component.error).toContain('already registered');
      expect(component.userForm.email).toBe('lead@example.com');
      expect(component.busy).toBe(false);
    });

    it('waits for confirmation before disabling an active account', () => {
      const toggle = jest.spyOn(component, 'toggleUserEnabled').mockImplementation(() => undefined);
      const user = { id: 'user-one', email: 'lead@example.com', active: true, role: 'user' } as AdminUser;
      component.requestUserEnabled(user);
      expect(toggle).not.toHaveBeenCalled();
      expect(component.userToDisable).toBe(user);
      component.userToDisable = null;
      expect(toggle).not.toHaveBeenCalled();
      component.requestUserEnabled(user);
      component.confirmDisableUser();
      expect(toggle).toHaveBeenCalledWith(user);
      expect(component.userToDisable).toBeNull();
    });
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
      component.partSummariesList.set([
        row('a-1', '1.955FC', '1'),
        row('a-2', '1.955FC', '2'),
        row('a-3', '1.955FC', '3', false),
        row('b-1', '1.500FC', 'A'),
        row('c-1', '2.000FC', 'A', true, false),
      ]);
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

  describe('confirmations, feedback and loading', () => {
    it('holds a weak temporary password to the same policy as password reset', () => {
      const create = jest.spyOn(TestBed.inject(AdminApiService), 'createUser');
      component.userForm = { email: 'lead@example.com', password: 'longenough', firstName: '', lastName: '', departmentId: 'department-one', role: 'user' };
      component.createUser();
      expect(create).not.toHaveBeenCalled();
      expect(component.error).toContain('uppercase and lowercase letters, a number, and a symbol');
    });

    it('asks before creating an administrator and only then sends the request', () => {
      const create = jest.spyOn(TestBed.inject(AdminApiService), 'createUser').mockReturnValue(of({} as AdminUser));
      component.userForm = { email: 'boss@example.com', password: 'Valid-Password1!', firstName: '', lastName: '', departmentId: 'department-one', role: 'admin' };
      component.createUser();
      expect(create).not.toHaveBeenCalled();
      expect(component.confirmation.request?.title).toBe('Create an administrator?');
      component.confirmation.dismiss();
      expect(create).not.toHaveBeenCalled();
      component.createUser();
      component.confirmation.accept();
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ email: 'boss@example.com', role: 'admin' }));
      expect(component.message).toBe('User created.');
    });

    it('asks before promoting an existing user, but not when saving an administrator again', () => {
      const update = jest.spyOn(TestBed.inject(AdminApiService), 'updateUser').mockReturnValue(of({} as AdminUser));
      component.usersList.set([
        { id: 'user-one', email: 'lead@example.com', role: 'user', active: true, departmentId: 'd' } as AdminUser,
        { id: 'admin-one', email: 'boss@example.com', role: 'ADMIN', active: true, departmentId: 'd' } as AdminUser,
      ]);
      component.beginEditUser(component.users[0]);
      component.userForm.role = 'admin';
      component.createUser();
      expect(update).not.toHaveBeenCalled();
      expect(component.confirmation.request?.title).toBe('Make this user an administrator?');
      component.confirmation.dismiss();
      component.beginEditUser(component.users[1]);
      component.createUser();
      expect(component.confirmation.request).toBeNull();
      expect(update).toHaveBeenCalledWith('admin-one', expect.objectContaining({ role: 'admin' }));
    });

    it.each([
      ['togglePartSummaryEnabled', 'updatePartSummary', { id: 's', number: '1.955FC', enabled: true, active: true }],
      ['togglePartEnabled', 'updatePart', { id: 'p', part_number: 'P-1', enabled: true, active: true }],
      ['toggleMachineEnabled', 'updateMachine', { id: 'm', machine_number: '520G', enabled: true, active: true }],
      ['toggleLocationEnabled', 'updateLocation', { id: 'l', serial_number: 'CGRR-A1A', enabled: true }],
      ['toggleTrayEnabled', 'updateTray', { id: 't', serial_number: 'T0001', enabled: true }],
      ['toggleContainerEnabled', 'updateContainer', { id: 'c', serial_number: 'C0001', enabled: true }],
      ['toggleCutterBodyEnabled', 'updateCutterBody', { id: 'b', mf_serial_number: 'MF-1', enabled: true }],
    ] as const)('%s confirms before disabling, and enables without asking', (method, apiMethod, row) => {
      const api = TestBed.inject(AdminApiService) as unknown as Record<string, (...args: unknown[]) => unknown>;
      const send = jest.spyOn(api, apiMethod).mockReturnValue(of({}));
      const toggle = (component as unknown as Record<string, (record: unknown) => void>)[method].bind(component);
      toggle(row);
      expect(send).not.toHaveBeenCalled();
      expect(component.confirmation.request?.confirmLabel).toBe('Disable');
      expect(component.confirmation.request?.danger).toBe(true);
      component.confirmation.accept();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][1]).toMatchObject({ enabled: false });
      toggle({ ...row, enabled: false });
      expect(component.confirmation.request).toBeNull();
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('shows a failed save once, in the page banner, not also as a toast', () => {
      const toast = TestBed.inject(GearToastService);
      const error = jest.spyOn(toast, 'error');
      jest.spyOn(TestBed.inject(AdminApiService), 'createModel').mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Model exists.' } })));
      component.setTab('models');
      component.modelForm = { model_number: '174', model_type: '' };
      component.createModel();
      fixture.detectChanges();
      expect(error).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelectorAll('[role="alert"]').length).toBe(1);
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Model exists.');
    });

    it('loads only the open tab, keeps a newer reload over an older one, and says when it is loading', () => {
      const api = TestBed.inject(AdminApiService);
      const older = new Subject<AdminTrayRow[]>();
      const pages: Subject<{ data: AdminTrayRow[]; meta: { hasNextPage: boolean } }>[] = [];
      const listTrays = jest.spyOn(api, 'listTrays').mockImplementation(() => { const page = new Subject<{ data: AdminTrayRow[]; meta: { hasNextPage: boolean } }>(); pages.push(page); return page; });
      const listUsers = jest.spyOn(api, 'listUsers');
      component.setTab('trays');
      fixture.detectChanges();
      expect(listUsers).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain('Loading trays…');
      expect(fixture.nativeElement.textContent).not.toContain('No trays');
      component.loadTrays();
      expect(listTrays).toHaveBeenCalledTimes(2);
      pages[1].next({ data: [{ id: 'new', serial_number: 'T0002', blade_count: 0, enabled: true }], meta: { hasNextPage: false } });
      pages[1].complete();
      pages[0].next({ data: [{ id: 'old', serial_number: 'T0001', blade_count: 0, enabled: true }], meta: { hasNextPage: false } });
      pages[0].complete();
      older.complete();
      expect(component.trays.map((tray) => tray.id)).toEqual(['new']);
    });

    it('reads every page of a paged list before showing it', () => {
      const api = TestBed.inject(AdminApiService);
      jest.spyOn(api, 'listContainers').mockImplementation((page: number) => of({
        data: [{ id: `c${page}`, serial_number: `C000${page}`, tray_count: 0, blade_count: 0, enabled: true }],
        meta: { hasNextPage: page < 3 },
      }));
      component.setTab('containers');
      expect(component.containers.map((row) => row.id)).toEqual(['c1', 'c2', 'c3']);
    });

    it('fills Roll Master quantities when the lists load, not while rendering', () => {
      const api = TestBed.inject(AdminApiService);
      const part = { id: 'p1', part_number: 'P-1', summary_id: 's', part_type_id: 't', teeth: null, active: true, enabled: true };
      jest.spyOn(api, 'listParts').mockReturnValue(of([part]));
      jest.spyOn(api, 'listRollMasters').mockReturnValue(of([{ id: 'r1', part_id: 'p1', required_count: 0, current_quantity: 4, minimum_quantity: 2, active: true, enabled: true, notes: null }]));
      component.setTab('roll-masters');
      expect(component.rollMasterEdits['p1']).toEqual({ current_quantity: 4, minimum_quantity: 2 });
      const before = { ...component.rollMasterEdits };
      component.rollMasterEdit({ ...part, id: 'unknown' });
      expect(component.rollMasterEdits).toEqual(before);
    });
  });
});
