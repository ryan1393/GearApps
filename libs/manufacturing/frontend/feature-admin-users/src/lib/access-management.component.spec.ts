import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DanaConfirmDialogComponent } from '@dana/ui';
import { AccessManagementComponent } from './access-management.component';
import { AdminUser } from './admin-api.service';

const API = '/api/v1/admin/access';
const action = { key: 'cutter-builder:listCutterRequests', screen: 'cutter-builder', action: 'listCutterRequests', method: 'GET', path: '/api/v1/cutter-builder/requests' };
const role = { id: 'role-one', name: 'Cutter Grind', enabled: true, permissions: [action.key], assigned_users: 2 };

describe('AccessManagementComponent', () => {
  let fixture: ComponentFixture<AccessManagementComponent>;
  let component: AccessManagementComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    fixture = TestBed.createComponent(AccessManagementComponent);
    component = fixture.componentInstance;
    component.users = [{ id: 'user-one', email: 'lead@example.com', role: 'user' } as AdminUser];
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function finishLoad(fail = false) {
    const catalog = http.expectOne(API + '/catalog');
    if (fail) catalog.flush({ message: 'Access settings are unavailable.' }, { status: 503, statusText: 'Unavailable' });
    else catalog.flush([action]);
    http.expectOne(API + '/roles').flush([role]);
    http.expectOne(API + '/assignments').flush([]);
    http.expectOne(API + '/badges').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('blocks mutations until the full access catalog loads and offers retry after failure', async () => {
    component.name = 'New role';
    component.requestRoleSave();
    expect(component.loading).toBe(true);
    expect(component.unavailable).toBe(true);
    http.expectNone(request => request.method !== 'GET');
    await finishLoad(true);
    expect(component.unavailable).toBe(true);
    const retry = fixture.nativeElement.querySelector('[role="alert"] button') as HTMLButtonElement;
    expect(retry.textContent).toContain('Retry loading');
    retry.click();
    await finishLoad();
    expect(component.unavailable).toBe(false);
    expect(component.error).toBe('');
  });

  it('requires confirmation before a role change signs assigned accounts out', async () => {
    await finishLoad();
    component.edit(role.id);
    component.enabled = false;
    const save = jest.spyOn(component, 'saveRole').mockResolvedValue();
    component.requestRoleSave();
    fixture.detectChanges();
    expect(save).not.toHaveBeenCalled();
    expect(component.confirmation).toBe('role');
    const dialog = fixture.debugElement.queryAll(By.directive(DanaConfirmDialogComponent))[0].componentInstance as DanaConfirmDialogComponent;
    expect(dialog.message).toContain('2 assigned accounts');
    expect(dialog.message).toContain('no access');
    dialog.cancel.emit();
    expect(save).not.toHaveBeenCalled();
    component.requestRoleSave();
    dialog.confirm.emit();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('filters human-readable action names while preserving selections on other screens', async () => {
    await finishLoad();
    component.edit(role.id);
    component.filter = ' cutter requests ';
    expect(component.filtered.map(row => row.key)).toEqual([action.key]);
    component.filter = 'no matching screen';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No actions match this filter');
    expect(component.selected.has(action.key)).toBe(true);
  });

  it('validates the badge before confirmation and identifies its destination without exposing the UID', async () => {
    await finishLoad();
    component.badgeUserId = 'user-one';
    component.uid = 'invalid uid';
    component.requestBadge();
    fixture.detectChanges();
    expect(component.confirmation).toBe('');
    expect(component.badgeError).toContain('without spaces');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#assignment-badge-uid'));
    component.uid = 'CARD-123';
    component.requestBadge();
    fixture.detectChanges();
    expect(component.badgeError).toBe('');
    const dialog = fixture.debugElement.queryAll(By.directive(DanaConfirmDialogComponent))[2].componentInstance as DanaConfirmDialogComponent;
    expect(dialog.open).toBe(true);
    expect(dialog.message).toContain('lead@example.com');
    expect(dialog.message).not.toContain('CARD-123');
    http.expectNone(request => request.method !== 'GET');
  });

  it('notes that an administrator account signs in with email and password, not a badge', async () => {
    component.users = [...component.users, { id: 'admin-one', email: 'admin@example.com', role: 'ADMIN' } as AdminUser];
    await finishLoad();
    component.badgeUserId = 'user-one';
    fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#assignment-badge-admin-note')).toBeNull();
    component.badgeUserId = 'admin-one';
    fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#assignment-badge-admin-note').textContent).toContain('Administrators sign in with email and password.');
    expect(component.nonAdmins.map(user => user.id)).toEqual(['user-one']);
  });
});
