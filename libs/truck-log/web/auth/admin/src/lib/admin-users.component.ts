import { Observable } from 'rxjs';
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TruckLogAdminAuth, TruckLogAdminUser } from './admin-auth.service';
import { TruckLogAdminAccessComponent } from './admin-access.component';
@Component({ standalone: true, imports: [CommonModule, FormsModule, RouterLink, TruckLogAdminAccessComponent],
 template: `<tl-admin-access></tl-admin-access>
 <div class="tl-admin">
 <header class="dana-page-header"><div><h1>Truck Log users</h1><p>Truck Log's own administrator accounts. Dana Apps accounts and passwords are not shared.</p></div>
  <div class="dana-actions"><a class="dana-btn" routerLink="/admin">Back to Administration</a></div></header>
 <p class="dana-note">Every account here can change Truck Log settings. Email is an optional sign-in alias; Truck Log does not send password-reset emails.</p>
 <p *ngIf="error" class="dana-alert dana-alert-danger" role="alert">{{error}}</p>
 <p *ngIf="message" class="dana-alert dana-alert-success" role="status">{{message}}</p>

 <section *ngIf="mode" class="dana-panel">
  <div class="dana-panel-header"><div><h2>{{mode==='create' ? 'Add administrator' : mode==='reset' ? 'Reset password' : 'Edit administrator'}}</h2><small *ngIf="selected">{{selected.displayName}} · {{selected.username}}</small></div></div>
  <form class="dana-panel-body" (ngSubmit)="save()"><fieldset class="tl-stack tl-fieldset" [disabled]="busy">
   <div class="dana-form-grid">
   <ng-container *ngIf="mode!=='reset'">
    <label class="dana-field">Display name<input class="dana-input" name="displayName" [(ngModel)]="name" required maxlength="120" autocomplete="name"></label>
    <label class="dana-field" *ngIf="mode==='create'">Username<input class="dana-input" name="username" [(ngModel)]="username" required minlength="3" maxlength="40" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
    <label class="dana-field"><span class="dana-field-head"><span>Email</span><span class="dana-field-tag">Optional</span></span><input class="dana-input" name="email" [(ngModel)]="email" type="email" maxlength="254" autocomplete="off"></label>
   </ng-container>
   <ng-container *ngIf="mode!=='edit'">
    <label class="dana-field">Temporary password<input class="dana-input" name="temporaryPassword" [(ngModel)]="temporaryPassword" type="password" required minlength="15" maxlength="256" autocomplete="new-password"></label>
    <label class="dana-field">Confirm temporary password<input class="dana-input" name="confirmTemporaryPassword" [(ngModel)]="confirmPassword" type="password" required maxlength="256" autocomplete="new-password"></label>
   </ng-container>
   </div>
   <p class="dana-field-hint" *ngIf="mode!=='edit'">15–128 characters. The user must change it at their next sign-in, and their current sessions end.</p>
   <div class="dana-actions"><button class="dana-btn dana-btn-primary" type="submit">{{busy ? 'Saving…' : 'Save'}}</button><button class="dana-btn" type="button" (click)="cancel()">Cancel</button></div>
  </fieldset></form>
 </section>

 <section class="dana-panel">
  <div class="dana-panel-header">
   <div><h2>Administrators</h2><small>{{users.length}} account{{users.length === 1 ? '' : 's'}}</small></div>
   <button class="dana-btn dana-btn-primary" type="button" [disabled]="busy || !auth.canWrite()" (click)="beginCreate()">Add administrator</button>
  </div>
  <div class="dana-panel-body">
   <div class="dana-filter-row">
    <label class="tl-admin-grow">Filter users<input type="search" [(ngModel)]="filter" placeholder="Name, username or email"></label>
    <div class="dana-actions tl-filter-actions"><button class="dana-btn" type="button" [disabled]="busy" (click)="load()">Refresh</button></div>
   </div>
  </div>
  <div class="dana-table-shell" *ngIf="users.length">
   <table class="dana-table"><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Status</th><th scope="col"><span class="dana-muted">Actions</span></th></tr></thead><tbody>
   <tr *ngFor="let user of filtered"><td><b>{{user.displayName}}</b><span class="dana-cell-sub">{{user.username}}</span></td><td>{{user.email || '—'}}</td>
    <td><span class="dana-status-badge" [attr.data-tone]="user.enabled ? 'success' : 'neutral'">{{user.enabled ? 'Enabled' : 'Disabled'}}</span><span class="dana-cell-sub" *ngIf="user.mustChangePassword">Password change required</span></td>
    <td><div class="dana-table-actions"><button class="dana-btn dana-btn-sm" type="button" [disabled]="busy || !auth.canWrite()" (click)="beginEdit(user)">Edit</button>
     <button class="dana-btn dana-btn-sm" type="button" [disabled]="busy || !auth.canWrite() || user.id===auth.user()?.id" (click)="beginReset(user)">Reset password</button>
     <button class="dana-btn dana-btn-sm" type="button" [disabled]="busy || !auth.canWrite() || user.id===auth.user()?.id" (click)="toggle(user)">{{user.enabled ? 'Disable' : 'Enable'}}</button></div></td></tr>
   </tbody></table>
  </div>
  <p *ngIf="!loading && users.length && !filtered.length" class="dana-empty-state" role="status">No administrators match this filter.</p>
  <p *ngIf="loading" class="dana-loading-state" role="status">Loading administrator accounts…</p>
 </section>
 </div>`
})
export class TruckLogAdminUsersComponent implements OnInit {
  readonly auth = inject(TruckLogAdminAuth); users: TruckLogAdminUser[] = []; filter = ''; error = ''; message = ''; busy = false; loading = false;
  mode: '' | 'create' | 'edit' | 'reset' = ''; selected: TruckLogAdminUser | null = null;
  name = ''; username = ''; email = ''; temporaryPassword = ''; confirmPassword = '';
  ngOnInit() { this.load(); }
  get filtered() { const q = this.filter.trim().toLowerCase(); return this.users.filter(u => !q || [u.displayName,u.username,u.email || ''].some(x => x.toLowerCase().includes(q))); }
  load() { if (this.loading) return; this.loading = true; this.auth.users().subscribe({ next: rows => { this.users = rows; this.loading = false; }, error: e => { this.loading = false; this.error = e?.error?.message || 'Could not load administrator accounts.'; } }); }
  cancel() { this.mode = ''; this.selected = null; this.name = ''; this.username = ''; this.email = ''; this.temporaryPassword = ''; this.confirmPassword = ''; }
  beginCreate() { this.cancel(); this.error = ''; this.message = ''; this.mode = 'create'; }
  beginEdit(user: TruckLogAdminUser) { this.cancel(); this.selected = user; this.name = user.displayName; this.email = user.email || ''; this.mode = 'edit'; this.error = ''; this.message = ''; }
  beginReset(user: TruckLogAdminUser) { this.cancel(); this.selected = user; this.mode = 'reset'; this.error = ''; this.message = ''; }
  save() {
    if (this.busy || !this.mode || !this.auth.canWrite()) return; this.error = '';
    // Same rules as the server (server/auth/admin admin-security.ts): Angular forms do not block
    // submit on required/minlength, so check here and say exactly what to fix.
    const problem = this.formProblem();
    if (problem) { this.error = problem; return; }
    if (this.mode !== 'edit' && (this.temporaryPassword !== this.confirmPassword || [...this.temporaryPassword].length < 15 || [...this.temporaryPassword].length > 128)) { this.error = 'Enter matching temporary passwords containing 15–128 characters.'; return; }
    this.busy = true;
    const request: Observable<unknown> = this.mode === 'create' ? this.auth.create({ displayName:this.name,username:this.username,email:this.email,password:this.temporaryPassword })
      : this.mode === 'reset' ? this.auth.reset(this.selected!.id,this.temporaryPassword) : this.auth.update(this.selected!.id,{displayName:this.name,email:this.email});
    request.subscribe({ next: () => { const mode = this.mode; this.busy = false; this.cancel(); this.message = mode === 'edit' ? 'Account saved.' : 'Account saved. Give the temporary password to the user through an approved private channel.'; this.load(); },
      error: e => { this.busy = false; this.temporaryPassword = ''; this.confirmPassword = ''; this.error = e?.error?.message || 'Account change was not confirmed.'; } });
  }
  private formProblem(): string {
    if (this.mode !== 'reset') {
      const name = this.name.trim();
      if (!name || name.length > 120) return 'Enter a display name (1–120 characters).';
      if (this.mode === 'create' && !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(this.username.trim().toLowerCase())) {
        return 'Username must be 3–40 letters, digits, dots, underscores or hyphens, starting with a letter or digit.';
      }
      const email = this.email.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address, or leave it blank.';
    }
    return '';
  }
  toggle(user: TruckLogAdminUser) {
    if (this.busy || !this.auth.canWrite() || user.id === this.auth.user()?.id) return;
    if (!window.confirm(`${user.enabled ? 'Disable' : 'Enable'} ${user.username}? ${user.enabled ? 'Their current Truck Log sessions will end.' : ''}`)) return;
    this.busy = true; this.error = ''; this.auth.update(user.id,{enabled:!user.enabled}).subscribe({ next: () => { this.busy = false; this.message = 'Account access updated.'; this.load(); }, error: e => { this.busy = false; this.error = e?.error?.message || 'Account access was not updated.'; } });
  }
}
