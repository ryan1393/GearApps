import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaConfirmDialogComponent, DanaHelpComponent, DanaTableDirective, DanaTableShellDirective } from '@dana/ui';
import { firstValueFrom } from 'rxjs';
import { AdminUser, adminApiErrorText } from './admin-api.service';
interface Action { key: string; screen: string; action: string; method: string; path: string }
interface Role { id: string; name: string; enabled: boolean; permissions: string[]; assigned_users: number }
@Component({
  selector: 'gear-access-management', standalone: true,
  imports: [CommonModule, FormsModule, DanaConfirmDialogComponent, DanaHelpComponent, DanaTableDirective, DanaTableShellDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="gear-panel access-panel" aria-labelledby="roles-title">
    <h2 id="roles-title">Roles and permissions</h2>
    <p>Create a named role and select its permitted screen actions.
      <dana-help label="How custom roles work">Custom roles restrict non-admin accounts. Existing department rules still apply and administrator-only actions remain protected. Unassigned accounts retain existing access. Saving role changes or assignments signs affected users out. A disabled role denies access until reassigned.</dana-help>
    </p>
    <p *ngIf="error" class="gear-alert gear-alert-danger" role="alert">{{ error }}</p><p *ngIf="message" role="status">{{ message }}</p>
    <div class="gear-form-grid">
      <label class="gear-field">Role <select class="gear-select" [ngModel]="editingId" (ngModelChange)="edit($event)" [disabled]="busy"><option value="">Create a role…</option><option *ngFor="let role of roles" [value]="role.id">{{ role.name }}{{ role.enabled ? '' : ' (disabled)' }} · {{ role.assigned_users }} users</option></select></label>
      <label class="gear-field">Name <input class="gear-input" [(ngModel)]="name" maxlength="80" list="suggested-role-names" [disabled]="busy" /></label>
      <datalist id="suggested-role-names"><option *ngFor="let name of suggestedNames" [value]="name"></option></datalist>
      <label><input type="checkbox" [(ngModel)]="enabled" [disabled]="busy" /> Role enabled</label>
      <label class="gear-field">Filter screens / actions <input class="gear-input" [(ngModel)]="filter" /></label>
    </div>
    <div danaTableShell class="permission-table"><table danaTable class="gear-table"><thead><tr><th data-dana-table-static>Allow</th><th data-dana-table-static>Screen / resource</th><th data-dana-table-static>Action</th><th data-dana-table-static>Access</th></tr></thead>
      <tbody><tr *ngFor="let action of filtered"><td><input type="checkbox" [checked]="selected.has(action.key)" (change)="toggle(action.key)" [disabled]="busy" [attr.aria-label]="'Allow ' + action.screen + ' ' + action.action" /></td><td>{{ screenName(action.screen) }}</td><td>{{ actionName(action.action) }}</td><td>{{ action.method === 'GET' ? 'View' : action.method === 'DELETE' ? 'Remove' : 'Change' }}</td></tr></tbody>
    </table></div>
    <div class="gear-admin-form-actions"><button type="button" class="gear-btn gear-btn-primary" [disabled]="busy || !name.trim()" (click)="saveRole()">Save role ({{ selected.size }} actions)</button><button type="button" class="gear-btn gear-btn-secondary" [disabled]="busy" (click)="edit(editingId)">Cancel changes</button></div>
  </section>
  <section class="gear-panel access-panel"><h2>Assign roles</h2><p>Choose a non-admin account. Removing a custom role restores the account’s existing department access.</p>
    <div class="gear-form-grid"><label class="gear-field">Account<select class="gear-select" [(ngModel)]="userId" (ngModelChange)="chooseUser()" [disabled]="busy"><option value="">Choose…</option><option *ngFor="let user of nonAdmins" [value]="user.id">{{ user.email }}</option></select></label>
    <label class="gear-field">Assigned role<select class="gear-select" [(ngModel)]="roleId" [disabled]="busy"><option value="">Existing department access (no custom role)</option><option *ngFor="let role of roles" [value]="role.id" [disabled]="!role.enabled">{{ role.name }}{{ role.enabled ? '' : ' (disabled)' }}</option></select></label></div>
    <button type="button" class="gear-btn gear-btn-primary" [disabled]="busy || !userId" (click)="confirmation = 'assignment'">Save assignment</button>
  </section>
  <section class="gear-panel access-panel"><h2>Badge assignment</h2><p>Scan a UID into the field, then assign it to the account. Replacement revokes the previous badge and signs the user out. Card UIDs are not displayed or stored as plain text.</p>
    <form (ngSubmit)="confirmation = 'badge'"><div class="gear-form-grid"><label class="gear-field">Account<select class="gear-select" name="badgeUser" [(ngModel)]="badgeUserId" [disabled]="busy"><option value="">Choose…</option><option *ngFor="let user of users" [value]="user.id">{{ user.email }}{{ hasBadge(user.id) ? ' — badge assigned' : '' }}</option></select></label>
    <label class="gear-field">Scan card UID<input class="gear-input" name="badgeUid" type="password" autocomplete="off" maxlength="128" [(ngModel)]="uid" [disabled]="busy" /></label></div>
    <div class="gear-admin-form-actions"><button class="gear-btn gear-btn-primary" type="submit" [disabled]="busy || !badgeUserId || !uid">Assign / replace badge</button><button class="gear-btn gear-btn-danger" type="button" [disabled]="busy || !hasBadge(badgeUserId)" (click)="confirmation = 'revoke'">Revoke badge</button></div></form>
  </section>
  <dana-confirm-dialog [open]="confirmation === 'assignment'" title="Change role assignment?" message="This signs the account out. Removing a custom role restores existing department access." confirmLabel="Save assignment" (confirm)="confirmation = ''; assign()" (cancel)="confirmation = ''" />
  <dana-confirm-dialog [open]="confirmation === 'badge'" title="Assign this badge?" message="Any previous badge for this account will be revoked and its sessions ended." confirmLabel="Assign badge" (confirm)="confirmation = ''; changeBadge(false)" (cancel)="confirmation = ''" />
  <dana-confirm-dialog [open]="confirmation === 'revoke'" title="Revoke this badge?" message="The badge will stop working immediately and the account will be signed out. Password login stays available." confirmLabel="Revoke badge" [danger]="true" (confirm)="confirmation = ''; changeBadge(true)" (cancel)="confirmation = ''" />`,
  styles: [':host { display:grid; gap:1rem; } .access-panel { padding:1.25rem; } .permission-table { max-height:32rem; overflow:auto; } .gear-admin-form-actions { display:flex; flex-wrap:wrap; gap:.5rem; margin-top:1rem; }'],
})
export class AccessManagementComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  @Input() users: AdminUser[] = [];
  readonly suggestedNames = ['Operator', 'Team Leader', 'Gear Quality', 'Cutter Grind', 'Management', 'TV', 'Admin'];
  screenName(value: string): string { const text = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-/]/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1); }
  actionName(value: string): string { return value.replace(/^get /, 'View ').replace(/^list /, 'View ').replace(/^update /, 'Edit ').replace(/^delete /, 'Remove '); }
  actions: Action[] = []; roles: Role[] = []; assignments: Array<{ user_id: string; role_id: string }> = []; badges: Array<{ user_id: string }> = [];
  confirmation = '';
  editingId = ''; name = ''; enabled = true; filter = ''; selected = new Set<string>();
  userId = ''; roleId = ''; badgeUserId = ''; uid = ''; busy = false; error = ''; message = '';
  get nonAdmins(): AdminUser[] { return this.users.filter(user => user.role !== 'admin'); }
  get filtered(): Action[] { const filter = this.filter.toLowerCase(); return this.actions.filter(row => (row.screen + ' ' + row.action).toLowerCase().includes(filter)); }
  hasBadge(id: string): boolean { return this.badges.some(badge => badge.user_id === id); }
  ngOnInit(): void { void this.load(); }
  async load(): Promise<void> {
    try {
      [this.actions, this.roles, this.assignments, this.badges] = await Promise.all([
        firstValueFrom(this.http.get<Action[]>('/api/v1/admin/access/catalog')),
        firstValueFrom(this.http.get<Role[]>('/api/v1/admin/access/roles')),
        firstValueFrom(this.http.get<Array<{ user_id: string; role_id: string }>>('/api/v1/admin/access/assignments')),
        firstValueFrom(this.http.get<Array<{ user_id: string }>>('/api/v1/admin/access/badges')),
      ]);
    } catch (error) { this.error = this.errorText(error); }
    this.cdr.markForCheck();
  }
  edit(id: string): void { const role = this.roles.find(role => role.id === id); this.editingId = role?.id ?? ''; this.name = role?.name ?? ''; this.enabled = role?.enabled ?? true; this.selected = new Set(role?.permissions ?? []); }
  toggle(key: string): void { if (this.selected.has(key)) this.selected.delete(key); else this.selected.add(key); }
  chooseUser(): void { this.roleId = this.assignments.find(row => row.user_id === this.userId)?.role_id ?? ''; }
  async saveRole(): Promise<void> {
    await this.run(async () => {
      const payload = { name: this.name.trim(), enabled: this.enabled, permissions: [...this.selected] };
      const role = await firstValueFrom(this.editingId ? this.http.patch<Role>('/api/v1/admin/access/roles/' + this.editingId, payload) : this.http.post<Role>('/api/v1/admin/access/roles', payload));
      await this.load(); this.edit(role.id); this.message = 'Role saved. Affected accounts must sign in again.';
    });
  }
  async assign(): Promise<void> { if (!this.userId) return; await this.run(async () => { await firstValueFrom(this.http.put('/api/v1/admin/access/users/' + this.userId + '/role', { role_id: this.roleId || null })); await this.load(); this.message = 'Role assignment saved.'; }); }
  async changeBadge(revoke: boolean): Promise<void> {
    if (!this.badgeUserId || (!revoke && !/^[!-~]{1,128}$/.test(this.uid))) { this.error = 'Choose an account and scan a valid card UID.'; return; }
    const uid = this.uid; this.uid = '';
    await this.run(async () => { await firstValueFrom(this.http.post('/api/v1/admin/access/badges/' + this.badgeUserId + (revoke ? '/revoke' : '/assign'), revoke ? {} : { uid })); await this.load(); this.message = revoke ? 'Badge revoked.' : 'Badge assigned.'; });
  }
  private async run(work: () => Promise<void>): Promise<void> { if (this.busy) return; this.busy = true; this.error = ''; this.message = ''; try { await work(); } catch (error) { this.error = this.errorText(error); } finally { this.busy = false; this.cdr.markForCheck(); } }
  private errorText(error: unknown): string { return error instanceof HttpErrorResponse ? adminApiErrorText(error) : 'Request failed. Reload to check the current state before retrying.'; }
}
