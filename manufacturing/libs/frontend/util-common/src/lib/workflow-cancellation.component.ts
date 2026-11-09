import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

interface Operation {
  id: string; identifier: string; action: string; occurred_at: string; recorded_by: string;
  canceled_at: string | null; canceled_by: string | null; cancellation_reason: string | null;
  can_cancel: boolean; blocked_reason: string | null;
}
interface CancellationView { latest: Operation | null; history: Operation[]; message: string | null; }

@Component({
  selector: 'gear-workflow-cancellation', standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  styles: [`
    :host{display:block}.cancel-content{max-width:64rem;margin:auto}
    .cancel-actions{display:flex;gap:1rem;flex-wrap:wrap;align-items:center;margin-top:1rem}
    .cancel-entry{padding:1rem 0;border-bottom:1px solid #cbd5e1;overflow-wrap:anywhere}
    .cancel-entry p{margin:.35rem 0}.cancel-entry:last-child{border:0}
  `],
  template: `
    <section class="gear-page gear-workflow-page cancel-content">
      <header class="gear-page-header"><div><span class="gear-workflow-kicker">{{ appName }}</span><h1>{{ title }}</h1><p>Review the last saved transaction before canceling it.</p></div></header>
      <a [routerLink]="backRoute" class="gear-btn gear-btn-secondary">Back to {{ appName }}</a>
      <div *ngIf="error" class="gear-feedback" role="alert">{{ error }}</div>
      <div *ngIf="message" class="gear-feedback" role="status">{{ message }}</div>
      <form (ngSubmit)="load()" class="gear-workflow-section">
        <div class="gear-workflow-section-body">
          <label class="gear-field">{{ identifierLabel }}<input [(ngModel)]="identifier" name="identifier" required class="gear-input font-mono" [disabled]="busy" /></label>
          <div class="cancel-actions"><button type="submit" class="gear-btn gear-btn-primary" [disabled]="busy || !identifier.trim()">{{ busy ? 'Loading…' : 'Find Last Transaction' }}</button></div>
        </div>
      </form>
      <section *ngIf="view?.latest as last" class="gear-workflow-section">
        <div class="gear-workflow-section-header"><div><h2>{{ last.identifier }}</h2><p>{{ last.action }}</p></div></div>
        <div class="gear-workflow-section-body">
          <p>Recorded by {{ last.recorded_by }} · {{ last.occurred_at | date:'MMM d, y, h:mm:ss a' }}</p>
          <p *ngIf="last.blocked_reason" role="status">{{ last.blocked_reason }}</p>
          <form *ngIf="last.can_cancel" #cancelForm="ngForm" (ngSubmit)="cancel()">
            <p>{{ effect }}</p>
            <label class="gear-field">Reason for cancellation<textarea [(ngModel)]="reason" name="reason" required maxlength="1000" rows="3" class="gear-textarea" [disabled]="busy"></textarea></label>
            <div class="cancel-actions"><button type="submit" class="gear-btn gear-btn-danger" [disabled]="busy || cancelForm.invalid || !reason.trim()">{{ busy ? 'Canceling…' : title }}</button></div>
          </form>
        </div>
      </section>
      <section *ngIf="view?.history?.length" class="gear-workflow-section">
        <div class="gear-workflow-section-header"><div><h2>Transaction History</h2><p>Original entries and cancellation details are retained.</p></div></div>
        <div class="gear-workflow-section-body">
          <article *ngFor="let row of view?.history" class="cancel-entry">
            <strong>{{ row.action }} · {{ row.canceled_at ? 'Canceled' : 'Recorded' }}</strong>
            <p>{{ row.recorded_by }} · {{ row.occurred_at | date:'MMM d, y, h:mm:ss a' }}</p>
            <p *ngIf="row.canceled_at">Canceled by {{ row.canceled_by }} · {{ row.canceled_at | date:'MMM d, y, h:mm:ss a' }}</p>
            <p *ngIf="row.cancellation_reason">Reason: {{ row.cancellation_reason }}</p>
          </article>
        </div>
      </section>
    </section>
  `,
})
export class WorkflowCancellationComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private endpoint = '';
  appName = ''; title = ''; backRoute = ''; identifierLabel = ''; effect = '';
  identifier = ''; reason = ''; error = ''; message = ''; busy = false;
  view: CancellationView | null = null;

  ngOnInit(): void {
    const app = this.route.snapshot.data['cancellationApp'] as string;
    if (!['greenshed', 'cutter-builder', 'blade-tracking'].includes(app)) throw new Error('Cancellation page is not configured');
    this.endpoint = '/api/v1/workflow-cancellation/' + app;
    this.appName = app === 'greenshed' ? 'Greenshed' : app === 'cutter-builder' ? 'Cutter Builder' : 'Blade Tracking';
    this.title = app === 'greenshed' ? 'Cancel Last Check' : app === 'cutter-builder' ? 'Cancel Last Build' : 'Cancel Last Tray Transaction';
    this.identifierLabel = app === 'blade-tracking' ? 'Tray serial number' : 'Build ID';
    this.backRoute = app === 'blade-tracking' ? '/blades' : '/' + app;
    this.effect = app === 'greenshed' ? 'Cancel this inspection and return the cutter piece count to the previous check count (or the setup starting count for the first check). The next check due count is recalculated. Recorded shift production is retained.' :
      app === 'cutter-builder' ? 'Cancel this build and return its blades and source tray to their recorded state before the build. Move the physical blades back to that tray.' :
        'Restore the tray, blades, and assignments to their recorded state before this transaction. Match the physical inventory to that state.';
    this.identifier = this.route.snapshot.queryParamMap.get('identifier') || '';
    if (this.identifier) this.load();
  }

  load(): void {
    if (this.busy || !this.identifier.trim()) return;
    this.busy = true; this.error = ''; this.message = ''; this.view = null; this.reason = '';
    this.http.get<CancellationView>(this.endpoint, { params: { identifier: this.identifier.trim() } }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: view => { this.view = view; this.message = view.message || ''; this.busy = false; },
      error: (error: HttpErrorResponse) => { this.busy = false; this.error = this.errorText(error); },
    });
  }

  cancel(): void {
    const last = this.view?.latest;
    if (this.busy || !last?.can_cancel || !this.reason.trim()) return;
    if (!globalThis.confirm(this.title + ': ' + last.identifier + '?\n\n' + last.action + '\n\n' + this.effect)) return;
    this.busy = true; this.error = ''; this.message = '';
    this.http.post<Operation>(this.endpoint, { identifier: last.identifier, operation_id: last.id, reason: this.reason.trim() }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        this.busy = false; this.reason = ''; this.message = 'Canceled. The original entry and cancellation details are retained.';
        if (this.view) { this.view.latest = result; this.view.history = this.view.history.map(row => row.id === result.id ? result : row); }
      },
      error: (error: HttpErrorResponse) => {
        this.busy = false; this.error = this.errorText(error);
        if (this.view?.latest) this.view.latest.can_cancel = false;
      },
    });
  }

  private errorText(error: HttpErrorResponse): string {
    const message = error.error?.message;
    return Array.isArray(message) ? message.join(', ') : message || 'Could not complete this request. Refresh the transaction and try again.';
  }
}
