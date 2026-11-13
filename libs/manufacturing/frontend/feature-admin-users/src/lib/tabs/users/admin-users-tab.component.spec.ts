import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { of, throwError } from 'rxjs';

import { AdminApiService, AdminUser } from '../../admin-api.service';
import { AdminUsersTabComponent } from './admin-users-tab.component';

describe('Admin > Users', () => {
  let component: AdminUsersTabComponent;
  let fixture: ComponentFixture<AdminUsersTabComponent>;
  let api: AdminApiService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminUsersTabComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthSessionService, useValue: { currentUser: { sub: 'me' } } }],
    }).compileComponents();
    api = TestBed.inject(AdminApiService);
    jest.spyOn(api, 'listUsers').mockReturnValue(of({ data: [], meta: { hasNextPage: false } }));
    jest.spyOn(api, 'listDepartments').mockReturnValue(of([]));
    fixture = TestBed.createComponent(AdminUsersTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads its own users and departments', () => {
    expect(api.listUsers).toHaveBeenCalledWith(1, 50);
    expect(api.listDepartments).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('No users yet.');
  });

  it('focuses invalid account details and prevents a malformed email from reaching the API', () => {
    const create = jest.spyOn(api, 'createUser');
    component.userForm = { email: 'not-an-email', password: 'Valid-Password1!', firstName: '', lastName: '', departmentId: 'department-one', role: 'user' };
    component.createUser();
    expect(create).not.toHaveBeenCalled();
    expect(component.error).toContain('valid email address');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#admin-user-email'));
  });

  it('keeps a failed save visible once, with the typed account draft, and no toast', () => {
    const toastError = jest.spyOn(TestBed.inject(GearToastService), 'error');
    jest.spyOn(api, 'createUser').mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'That email is already registered.' } })));
    component.userForm = { email: 'lead@example.com', password: 'Valid-Password1!', firstName: 'Team', lastName: 'Lead', departmentId: 'department-one', role: 'user' };
    component.createUser();
    fixture.detectChanges();
    expect(component.error).toContain('already registered');
    expect(component.userForm.email).toBe('lead@example.com');
    expect(component.busy).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('[role="alert"]').length).toBe(1);
  });

  it('reports a created user in the Saved banner', () => {
    jest.spyOn(api, 'createUser').mockReturnValue(of({} as AdminUser));
    component.userForm = { email: 'lead@example.com', password: 'Valid-Password1!', firstName: '', lastName: '', departmentId: 'd', role: 'user' };
    component.createUser();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('User created.');
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

  it('holds a weak temporary password to the same policy as password reset', () => {
    const create = jest.spyOn(api, 'createUser');
    component.userForm = { email: 'lead@example.com', password: 'longenough', firstName: '', lastName: '', departmentId: 'department-one', role: 'user' };
    component.createUser();
    expect(create).not.toHaveBeenCalled();
    expect(component.error).toContain('uppercase and lowercase letters, a number, and a symbol');
  });

  it('asks before creating an administrator and only then sends the request', () => {
    const create = jest.spyOn(api, 'createUser').mockReturnValue(of({} as AdminUser));
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
    const update = jest.spyOn(api, 'updateUser').mockReturnValue(of({} as AdminUser));
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

  it('moves to the form and focuses it when Edit is clicked', () => {
    component.usersList.set([{ id: 'user-one', email: 'lead@example.com', role: 'user', active: true, departmentId: 'd' } as AdminUser]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-icon="edit"]') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#admin-user-email'));
    expect(component.editingUserId).toBe('user-one');
  });

  it('shows the server\'s reason when the last administrator cannot be disabled or demoted', () => {
    jest.spyOn(api, 'updateUser').mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'This is the last active administrator. Make another account an administrator first.' } })));
    component.toggleUserEnabled({ id: 'admin-two', email: 'boss@example.com', active: true, role: 'admin' } as AdminUser);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('This is the last active administrator.');
    expect(component.busy).toBe(false);
  });
});
