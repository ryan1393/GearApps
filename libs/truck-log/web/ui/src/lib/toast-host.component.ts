import { AsyncPipe, CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ToastNotice, ToastService } from './toast.service';

@Component({
  selector: 'truck-log-toast-host',
  standalone: true,
  imports: [CommonModule, AsyncPipe],
  template: `
    <div class="dana-toast-stack" aria-live="polite" aria-relevant="additions removals">
      <article
        *ngFor="let notice of toast.notices$ | async; trackBy: trackById"
        class="dana-toast"
        [class.toast-success]="notice.tone === 'success'"
        [class.toast-warning]="notice.tone === 'warning'"
        [class.toast-error]="notice.tone === 'error'"
        [class.toast-info]="notice.tone === 'info'"
        [attr.role]="notice.tone === 'error' ? 'alert' : 'status'">
        <div class="dana-toast-icon" aria-hidden="true">
          {{notice.tone === 'success' ? '✓' : notice.tone === 'warning' ? '!' : notice.tone === 'error' ? '!' : 'i'}}
        </div>
        <div class="dana-toast-copy">
          <strong>{{notice.title}}</strong>
          <span>{{notice.message}}</span>
        </div>
        <button type="button" class="dana-toast-close" aria-label="Dismiss notification" (click)="toast.dismiss(notice.id)">×</button>
      </article>
    </div>
  `,
})
export class ToastHostComponent {
  constructor(public readonly toast: ToastService) {}

  trackById(_index: number, notice: ToastNotice) {
    return notice.id;
  }
}
