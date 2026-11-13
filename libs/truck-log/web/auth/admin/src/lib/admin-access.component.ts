import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TruckLogAdminAuth } from './admin-auth.service';
@Component({
  selector: 'tl-admin-access', standalone: true, imports: [CommonModule, RouterLink],
  template: `<section class="dana-alert tl-admin-access" aria-label="Truck Log administrative access">
    <div *ngIf="auth.user() as user; else guest"><b>{{user.displayName}}</b> · Truck Log administrator ({{user.username}})</div>
    <ng-template #guest><div><b>Viewing as operator.</b> Sign in as administrator to change settings.</div></ng-template>
    <nav class="dana-actions"><a *ngIf="!auth.user()" class="dana-btn dana-btn-sm" routerLink="/admin/login" [queryParams]="{returnTo: router.url}">Sign in</a>
      <a *ngIf="auth.canWrite()" class="dana-btn dana-btn-sm" routerLink="/admin/users">Manage users</a>
      <a *ngIf="auth.canWrite()" class="dana-btn dana-btn-sm" routerLink="/admin/stations">Stations</a>
      <a *ngIf="auth.user()" class="dana-btn dana-btn-sm" routerLink="/admin/password">Change my password</a>
      <button *ngIf="auth.user()" type="button" class="dana-btn dana-btn-sm" [disabled]="busy" (click)="signOut()">{{busy ? 'Signing out…' : 'Sign out'}}</button></nav>
    <p class="dana-field-error" role="alert" *ngIf="error">{{error}}</p>
  </section>`
})
export class TruckLogAdminAccessComponent implements OnInit {
  readonly auth = inject(TruckLogAdminAuth); readonly router = inject(Router); busy = false; error = '';
  ngOnInit() { this.auth.refresh().subscribe(); }
  signOut() {
    if (this.busy) return; this.busy = true; this.error = '';
    this.auth.logout().subscribe({ next: () => { this.busy = false; void this.router.navigateByUrl('/'); }, error: () => { this.busy = false; this.error = 'Sign-out could not be confirmed. Check the connection and try again.'; } });
  }
}
