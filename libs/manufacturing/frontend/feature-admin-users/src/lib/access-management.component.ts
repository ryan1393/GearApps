import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Input, OnInit, inject } from '@angular/core';
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
  template: `<p *ngIf="loading" role="status">Loading roles, permissions and badge assignments…</p>
  <div *ngIf="error" class="gear-alert gear-alert-danger" role="alert">{{ error }} <button *ngIf="!loaded && !loading" type="button" class="gear-btn gear-btn-secondary" (click)="load()">Retry loading access settings</button></div>
  <p *ngIf="message" role="status">{{ message }}</p>
  <section class="gear-panel access-panel" aria-labelledby="roles-title" [attr.aria-busy]="loading || busy">
    <h2 id="roles-title">Roles and permissions</h2>
    <p>Create a named role and select its permitted screen actions.
      <dana-help label="How custom roles work">Custom roles restrict non-admin accounts. Existing department rules still apply and administrator-only actions remain protected. Unassigned accounts retain existing access. Saving role changes or assignments signs affected users out. A disabled role denies access until reassigned.</dana-help>
    </p>
    <div class="gear-form-grid">
      <label class="gear-field">Role <select class="gear-select" [ngModel]="editingId" (ngModelChange)="edit($event)" [disabled]="unavailable"><option value="">Create a role…</option><option *ngFor="let role of roles" [value]="role.id">{{ role.name }}{{ role.enabled ? '' : ' (disabled)' }} · {{ role.assigned_users }} users</option></select></label>
      <label class="gear-field">Name <input class="gear-input" [(ngModel)]="name" maxlength="80" list="suggested-role-names" [disabled]="unavailable" /></label>
      <datalist id="suggested-role-names"><option *ngFor="let name of suggestedNames" [value]="name"></option></datalist>
      <label><input type="checkbox" [(ngModel)]="enabled" [disabled]="unavailable" /> Role enabled</label>
      <label class="gear-field">Filter screens / actions <input class="gear-input" [(ngModel)]="filter" /></label>
    </div>
    <p *ngIf="loaded" role="status">{{ filtered.length }} of {{ actions.length }} actions shown · {{ selected.size }} selected across all screens.</p>
    <p *ngIf="loaded && (!enabled || !selected.size)" class="gear-alert gear-alert-warning">{{ !enabled ? 'This role is disabled. Assigned users cannot use protected actions.' : 'No actions selected. Assigned users will have no access to protected actions.' }}</p>
    <div danaTableShell class="permission-table"><table danaTable class="gear-table" aria-label="Role screen and action permissions"><thead><tr><th data-dana-table-static>Allow</th><th data-dana-table-static>Screen / resource</th><th data-dana-table-static>Action</th><th data-dana-table-static>Access</th></tr></thead>
      <tbody><tr *ngFor="let action of filtered"><td><input type="checkbox" [checked]="selected.has(action.key)" (change)="toggle(action.key)" [disabled]="unavailable" [attr.aria-label]="'Allow ' + screenName(action.screen) + ' ' + actionName(action.action)" /></td><td>{{ screenName(action.screen) }}</td><td>{{ actionName(action.action) }}</td><td>{{ action.method === 'GET' ? 'View' : action.method === 'DELETE' ? 'Remove' : 'Change' }}</td></tr><tr *ngIf="loaded && !filtered.length"><td colspan="4">No actions match this filter. Clear the filter to see all permissions.</td></tr></tbody>
    </table></div>
    <div class="gear-admin-form-actions"><button type="button" class="gear-btn gear-btn-primary" [disabled]="unavailable || !name.trim()" (click)="requestRoleSave()">{{ busy ? 'Saving…' : 'Save role (' + selected.size + ' actions)' }}</button><button type="button" class="gear-btn gear-btn-secondary" [disabled]="unavailable" (click)="edit(editingId)">Cancel changes</button></div>
  </section>
  <section class="gear-panel access-panel"><h2>Assign roles</h2><p>Choose a non-admin account. Removing a custom role restores the account’s existing department access.</p>
    <div class="gear-form-grid"><label class="gear-field">Account<select class="gear-select" [(ngModel)]="userId" (ngModelChange)="chooseUser()" [disabled]="unavailable"><option value="">Choose…</option><option *ngFor="let user of nonAdmins" [value]="user.id">{{ user.email || user.fullName || 'Account without email' }}</option></select></label>
    <label class="gear-field">Assigned role<select class="gear-select" [(ngModel)]="roleId" [disabled]="unavailable || !userId"><option value="">Existing department access (no custom role)</option><option *ngFor="let role of roles" [value]="role.id" [disabled]="!role.enabled">{{ role.name }}{{ role.enabled ? '' : ' (disabled)' }}</option></select></label></div>
    <button type="button" class="gear-btn gear-btn-primary" [disabled]="unavailable || !userId" (click)="confirmation = 'assignment'">Save assignment</button>
  </section>
  <section class="gear-panel access-panel"><h2>Badge assignment</h2><p>Scan a UID into the field, then assign it to the account. Replacement revokes the previous badge and signs the user out. Card UIDs are not displayed or stored as plain text.</p>
    <form (ngSubmit)="requestBadge()"><div class="gear-form-grid"><label class="gear-field">Account<select class="gear-select" name="badgeUser" [(ngModel)]="badgeUserId" [disabled]="unavailable"><option value="">Choose…</option><option *ngFor="let user of users" [value]="user.id">{{ user.email || user.fullName || 'Account without email' }}{{ hasBadge(user.id) ? ' — badge assigned' : '' }}</option></select></label>
    <label class="gear-field">Scan card UID<input class="gear-input" id="assignment-badge-uid" name="badgeUid" type="password" autocomplete="off" maxlength="128" [(ngModel)]="uid" [disabled]="unavailable" [attr.aria-invalid]="!!badgeError" aria-describedby="assignment-badge-help assignment-badge-error" /></label></div>
    <small id="assignment-badge-help">Choose the account, focus the UID field, then scan. Enter reviews the assignment before saving.</small>
    <p id="assignment-badge-error" *ngIf="badgeError" class="gear-alert gear-alert-danger" role="alert">{{ badgeError }}</p>
    <div class="gear-admin-form-actions"><button class="gear-btn gear-btn-primary" type="submit" [disabled]="unavailable || !badgeUserId || !uid">Assign / replace badge</button><button class="gear-btn gear-btn-danger" type="button" [disabled]="unavailable || !hasBadge(badgeUserId)" (click)="confirmation = 'revoke'">Revoke badge</button></div></form>
  </section>
  <dana-confirm-dialog [open]="confirmation === 'role'" title="Change access for assigned users?" [message]="roleSaveMessage" confirmLabel="Save role" [danger]="!enabled || !selected.size" (confirm)="confirmation = ''; saveRole()" (cancel)="confirmation = ''" />
  <dana-confirm-dialog [open]="confirmation === 'assignment'" title="Change role assignment?" [message]="'This signs ' + accountName(userId) + ' out. Removing a custom role restores existing department access.'" confirmLabel="Save assignment" (confirm)="confirmation = ''; assign()" (cancel)="confirmation = ''" />
  <dana-confirm-dialog [open]="confirmation === 'badge'" title="Assign this badge?" [message]="'Assign the scanned badge to ' + accountName(badgeUserId) + '? Any previous badge for this account will be revoked and its sessions ended.'" confirmLabel="Assign badge" (confirm)="confirmation = ''; changeBadge(false)" (cancel)="confirmation = ''" />
  <dana-confirm-dialog [open]="confirmation === 'revoke'" title="Revoke this badge?" message="The badge will stop working immediately and the account will be signed out. Password login stays available." confirmLabel="Revoke badge" [danger]="true" (confirm)="confirmation = ''; changeBadge(true)" (cancel)="confirmation = ''" />`,
  styles: [':host { display:grid; gap:1rem; } .access-panel { padding:1.25rem; } .permission-table { max-height:32rem; overflow:auto; } .gear-admin-form-actions { display:flex; flex-wrap:wrap; gap:.5rem; margin-top:1rem; }'],
})
export class AccessManagementComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  @Input() users: AdminUser[] = [];
  readonly suggestedNames = ['Operator', 'Team Leader', 'Gear Quality', 'Cutter Grind', 'Management', 'TV', 'Admin'];
  screenName(value: string): string { const text = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-/]/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1); }
  actionName(value: string): string { return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^get /, 'View ').replace(/^list /, 'View ').replace(/^update /, 'Edit ').replace(/^delete /, 'Remove '); }
  actions: Action[] = []; roles: Role[] = []; assignments: Array<{ user_id: string; role_id: string }> = []; badges: Array<{ user_id: string }> = [];
  confirmation = '';
  editingId = ''; name = ''; enabled = true; filter = ''; selected = new Set<string>();
  userId = ''; roleId = ''; badgeUserId = ''; uid = ''; busy = false; loading = false; loaded = false; error = ''; message = ''; badgeError = '';
  get unavailable(): boolean { return this.busy || this.loading || !this.loaded; }
  get roleSaveMessage(): string {
    const count = this.roles.find(role => role.id === this.editingId)?.assigned_users ?? 0;
    return `Saving “${this.name.trim()}” changes access for ${count} assigned account${count === 1 ? '' : 's'} and signs them out.`
      + (!this.enabled || !this.selected.size ? ' Assigned users will have no access to protected actions.' : '');
  }
  accountName(id: string): string { const user = this.users.find(row => row.id === id); return user?.email || user?.fullName || 'the selected account'; }
  get nonAdmins(): AdminUser[] { return this.users.filter(user => user.role !== 'admin'); }
  get filtered(): Action[] { const filter = this.filter.trim().toLowerCase(); return this.actions.filter(row => `${this.screenName(row.screen)} ${this.actionName(row.action)} ${row.screen} ${row.action}`.toLowerCase().includes(filter)); }
  hasBadge(id: string): boolean { return this.badges.some(badge => badge.user_id === id); }
  ngOnInit(): void { void this.load(); }
  async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.loaded = false; this.error = ''; this.cdr.markForCheck();
    try {
      [this.actions, this.roles, this.assignments, this.badges] = await Promise.all([
        firstValueFrom(this.http.get<Action[]>('/api/v1/admin/access/catalog')),
        firstValueFrom(this.http.get<Role[]>('/api/v1/admin/access/roles')),
        firstValueFrom(this.http.get<Array<{ user_id: string; role_id: string }>>('/api/v1/admin/access/assignments')),
        firstValueFrom(this.http.get<Array<{ user_id: string }>>('/api/v1/admin/access/badges')),
      ]);
      this.loaded = true;
    } catch (error) { this.error = this.errorText(error); }
    this.loading = false;
    this.cdr.markForCheck();
  }
  edit(id: string): void { const role = this.roles.find(role => role.id === id); this.editingId = role?.id ?? ''; this.name = role?.name ?? ''; this.enabled = role?.enabled ?? true; this.selected = new Set(role?.permissions ?? []); }
  toggle(key: string): void { if (this.selected.has(key)) this.selected.delete(key); else this.selected.add(key); }
  chooseUser(): void { this.roleId = this.assignments.find(row => row.user_id === this.userId)?.role_id ?? ''; }
  requestRoleSave(): void {
    if (this.unavailable || !this.name.trim()) return;
    if ((this.roles.find(role => role.id === this.editingId)?.assigned_users ?? 0) > 0) this.confirmation = 'role';
    else void this.saveRole();
    this.cdr.markForCheck();
  }
  requestBadge(): void {
    if (this.unavailable) return;
    this.badgeError = '';
    if (!this.badgeUserId || !/^[!-~]{1,128}$/.test(this.uid)) {
      this.badgeError = 'Choose an account and scan a printable card UID without spaces (up to 128 characters).';
      this.cdr.markForCheck();
      this.element.nativeElement.querySelector<HTMLInputElement>('#assignment-badge-uid')?.focus();
      return;
    }
    this.confirmation = 'badge';
    this.cdr.markForCheck();
  }
  async saveRole(): Promise<void> {
    if (this.unavailable || !this.name.trim()) return;
    await this.run(async () => {
      const payload = { name: this.name.trim(), enabled: this.enabled, permissions: [...this.selected] };
      const role = await firstValueFrom(this.editingId ? this.http.patch<Role>('/api/v1/admin/access/roles/' + this.editingId, payload) : this.http.post<Role>('/api/v1/admin/access/roles', payload));
      await this.load(); this.edit(role.id); this.message = 'Role saved. Affected accounts must sign in again.';
    });
  }
  async assign(): Promise<void> { if (this.unavailable || !this.userId) return; await this.run(async () => { await firstValueFrom(this.http.put('/api/v1/admin/access/users/' + this.userId + '/role', { role_id: this.roleId || null })); await this.load(); this.message = 'Role assignment saved.'; }); }
  async changeBadge(revoke: boolean): Promise<void> {
    if (this.unavailable) return;
    if (!this.badgeUserId || (!revoke && !/^[!-~]{1,128}$/.test(this.uid))) { this.error = 'Choose an account and scan a valid card UID.'; return; }
    const uid = this.uid; this.uid = '';
    await this.run(async () => { await firstValueFrom(this.http.post('/api/v1/admin/access/badges/' + this.badgeUserId + (revoke ? '/revoke' : '/assign'), revoke ? {} : { uid })); await this.load(); this.message = revoke ? 'Badge revoked.' : 'Badge assigned.'; });
  }
  private async run(work: () => Promise<void>): Promise<void> { if (this.busy) return; this.busy = true; this.error = ''; this.message = ''; try { await work(); } catch (error) { this.error = this.errorText(error); } finally { this.busy = false; this.cdr.markForCheck(); } }
  private errorText(error: unknown): string { return error instanceof HttpErrorResponse ? adminApiErrorText(error) : 'Request failed. Reload to check the current state before retrying.'; }
}
