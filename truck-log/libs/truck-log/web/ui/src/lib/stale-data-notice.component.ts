import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlantDatePipe } from './plant-date.pipe';

/** Visible "data may be out of date" banner for screens that refresh in the background. */
@Component({
  selector: 'tl-stale-data-notice',
  standalone: true,
  imports: [CommonModule, PlantDatePipe],
  template: `
    <p class="dana-alert dana-alert-warning tl-notice" role="alert" *ngIf="stale">
      {{subject}} could not refresh. Data may be out of date<span *ngIf="lastUpdated"> — last confirmed at {{lastUpdated | plantDate:'shortTime'}}</span>. Retrying automatically; select Refresh to try now.
    </p>`,
})
export class StaleDataNoticeComponent {
  @Input() stale = false;
  @Input() lastUpdated: Date | null = null;
  @Input() subject = 'This screen';
}
