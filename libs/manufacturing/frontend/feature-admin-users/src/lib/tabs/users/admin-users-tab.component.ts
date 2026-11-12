import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { FormControl, FormsModule, Validators } from '@angular/forms';
import { DanaConfirmDialogComponent } from '@dana/ui';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { isStrongPassword, PASSWORD_MIN_LENGTH } from '@meshforge/manufacturing/shared/util-constants';

import { AdminUser, DepartmentRow } from '../../admin-api.service';
import { allPages } from '../../shared/admin-data';
import { AdminFeedbackComponent } from '../../shared/admin-feedback.component';
import { AdminListStateComponent } from '../../shared/admin-list-state.component';
import { AdminTabBase } from '../../shared/admin-tab-base';
import { isAdminRole } from '../../shared/admin-tabs';

/** Admin > Users: create, edit, enable and disable MeshForge accounts. */
@Component({
  selector: 'gear-admin-users-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaConfirmDialogComponent, AdminFeedbackComponent, AdminListStateComponent],
  templateUrl: './admin-users-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
})
export class AdminUsersTabComponent extends AdminTabBase implements OnInit {
  readonly session = inject(AuthSessionService);
  readonly minPasswordLength = PASSWORD_MIN_LENGTH;
  userToDisable: AdminUser | null = null;

  readonly usersList = this.list<AdminUser[]>([]);
  readonly departmentsList = this.list<DepartmentRow[]>([]);
  get users(): AdminUser[] { return this.usersList.value(); }
  get departments(): DepartmentRow[] { return this.departmentsList.value(); }

  userSearch = '';
  editingUserId: string | null = null;
  userForm = { email: '', password: '', firstName: '', lastName: '', role: 'user', departmentId: '' };

  ngOnInit(): void {
    this.choiceLists = { departments: this.departmentsList };
    this.loadUsers();
    this.loadDepartments();
  }

  retryChoices(): void { this.loadDepartments(); }

  loadUsers(): void {
    this.usersList.load(allPages((page) => this.api.listUsers(page, 50)));
  }

  loadDepartments(): void {
    this.departmentsList.load(this.api.listDepartments());
  }

  /** `confirmed`: the administrator already agreed to grant administrator access. */
  createUser(confirmed = false): void {
    if (this.busy) return;
    const email = this.userForm.email.trim();
    if (this.editingUserId ? !this.userForm.departmentId : (!email || !this.userForm.departmentId || !this.userForm.password)) {
      this.error = this.editingUserId
        ? 'Department is required.'
        : 'Email, password, and department are required.';
      this.focusField(!email && !this.editingUserId ? '#admin-user-email'
        : !this.userForm.password && !this.editingUserId ? '#admin-user-password' : '#admin-user-department');
      return;
    }
    if (email && Validators.email(new FormControl(email))) {
      this.error = 'Enter a valid email address.';
      this.focusField('#admin-user-email');
      return;
    }
    if (!this.editingUserId && !isStrongPassword(this.userForm.password)) {
      this.error = `Temporary password must have at least ${PASSWORD_MIN_LENGTH} characters, uppercase and lowercase letters, a number, and a symbol.`;
      this.focusField('#admin-user-password');
      return;
    }
    if (this.editingUserId && this.isSelf(this.editingUserId) && this.userForm.role !== 'admin') {
      this.error = 'You cannot remove your own administrator role. Ask another administrator.';
      return;
    }
    const grantsAdmin = isAdminRole(this.userForm.role) &&
      (!this.editingUserId || !isAdminRole(this.users.find((user) => user.id === this.editingUserId)?.role));
    if (grantsAdmin && !confirmed) {
      const who = email || 'This account';
      this.confirmation.ask({
        title: this.editingUserId ? 'Make this user an administrator?' : 'Create an administrator?',
        message: `${who} will be able to change every MeshForge setting, account and record. Administrators sign in with email and password, not a badge.`,
        confirmLabel: this.editingUserId ? 'Make administrator' : 'Create administrator',
        danger: true,
        run: () => this.createUser(true),
      });
      this.cdr.markForCheck();
      return;
    }

    const request = this.editingUserId
      ? this.api.updateUser(this.editingUserId, {
          // Accounts imported without an email keep none unless one is typed in.
          ...(email ? { email } : {}),
          firstName: this.userForm.firstName.trim() || null,
          lastName: this.userForm.lastName.trim() || null,
          role: this.userForm.role,
          departmentId: this.userForm.departmentId,
        })
      : this.api.createUser({
          email: this.userForm.email.trim(),
          password: this.userForm.password,
          firstName: this.userForm.firstName.trim() || null,
          lastName: this.userForm.lastName.trim() || null,
          role: this.userForm.role,
          departmentId: this.userForm.departmentId,
        });

    this.runSave(request, this.editingUserId ? 'User updated.' : 'User created.', () => {
      this.resetUserForm();
      this.loadUsers();
    });
  }

  beginEditUser(user: AdminUser): void {
    this.editingUserId = user.id;
    this.userForm = {
      email: user.email || '', password: '', firstName: user.firstName || '', lastName: user.lastName || '',
      role: isAdminRole(user.role) ? 'admin' : 'user', departmentId: user.departmentId || '',
    };
    this.clearNotice(); this.focusEditor();
  }

  cancelUserEdit(): void { this.resetUserForm(); this.clearNotice(); this.cdr.markForCheck(); }

  /** The signed-in administrator's own account: it cannot be disabled or demoted from here. */
  isSelf(userId: string): boolean { return this.session.currentUser?.sub === userId; }

  requestUserEnabled(user: AdminUser): void {
    if (this.busy) return;
    if (user.active && !this.isSelf(user.id)) this.userToDisable = user;
    else this.toggleUserEnabled(user);
  }

  confirmDisableUser(): void {
    const user = this.userToDisable;
    this.userToDisable = null;
    if (user) this.toggleUserEnabled(user);
  }

  toggleUserEnabled(user: AdminUser): void {
    if (this.busy) return;
    const active = !user.active;
    if (!active && this.isSelf(user.id)) { this.error = 'You cannot disable your own account. Ask another administrator.'; return; }
    this.runSave(this.api.updateUser(user.id, { active }), `User ${active ? 'enabled' : 'disabled'}.`, () => this.loadUsers());
  }

  get filteredUsers(): AdminUser[] {
    return this.users.filter((user) =>
      this.matches(this.userSearch, [
        user.fullName,
        user.firstName,
        user.lastName,
        user.email,
        user.role,
        this.departmentName(user.departmentId),
        user.active ? 'active' : 'inactive',
      ]),
    );
  }

  departmentName(departmentId?: string | null): string {
    if (!departmentId) return 'No department';
    return this.departments.find((department) => department.id === departmentId)?.description || 'Unknown department';
  }

  private resetUserForm(): void {
    this.editingUserId = null;
    this.userForm = { email: '', password: '', firstName: '', lastName: '', role: 'user', departmentId: '' };
  }
}
