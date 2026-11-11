import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { ScanMessage } from '../../models/scan-message';
import { focusExpectedScan } from '../focus-expected-scan';

/**
 * The one feedback line of an operation: the result of the last scan or action, or, when there is
 * none, what the operator should do next. It keeps its height, so scan boxes below it never move,
 * and an error stays until the operator taps OK or the next action replaces it.
 */
@Component({
  selector: 'gear-station-status',
  standalone: true,
  template: `
    @for (key of [revision]; track key) {
      <div class="station-status" [attr.data-tone]="message?.tone ?? 'prompt'" [class.flash]="message?.tone === 'error'"
        [attr.role]="message?.tone === 'error' ? 'alert' : 'status'" [attr.aria-live]="message?.tone === 'error' ? 'assertive' : 'polite'">
        <span class="station-status-icon" aria-hidden="true">{{ icon }}</span>
        <span class="station-status-text">{{ message?.text || prompt }}</span>
        @if (message?.tone === 'error') {
          <button type="button" class="gear-btn gear-btn-secondary" (click)="acknowledge()">OK</button>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .station-status { display: flex; align-items: center; gap: 12px; min-height: 64px; box-sizing: border-box; padding: 10px 16px;
      border: 2px solid var(--dana-border); border-radius: 12px; background: var(--dana-neutral-soft); font-size: 1.05rem; font-weight: 700; }
    .station-status-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .station-status-icon { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 50%;
      background: var(--dana-surface); font-weight: 900; }
    [data-tone='prompt'] { border-style: dashed; color: var(--dana-text); }
    [data-tone='prompt'] .station-status-icon { color: var(--dana-primary); }
    [data-tone='success'] { border-color: var(--dana-success); background: var(--dana-success-soft); color: var(--dana-success); }
    [data-tone='info'] { border-color: var(--dana-info); background: var(--dana-info-soft); color: var(--dana-info); }
    [data-tone='error'] { border-color: var(--dana-danger); background: var(--dana-danger-soft); color: var(--dana-danger); }
    .flash { animation: station-status-flash .8s ease-out 3; }
    @keyframes station-status-flash { 0% { box-shadow: 0 0 0 8px var(--dana-danger); } 100% { box-shadow: 0 0 0 0 transparent; } }
    @media (prefers-reduced-motion: reduce) { .flash { animation: none; } }
  `],
})
export class StationStatusComponent implements OnChanges {
  @Input() message: ScanMessage | null = null;
  /** The next action, shown when there is no message. */
  @Input() prompt = '';
  @Output() dismiss = new EventEmitter<void>();

  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  /**
   * OK removes the button that has the cursor, which would leave the next scan with nowhere to go,
   * so the cursor goes back to the scan box the operation is waiting on.
   */
  acknowledge(): void {
    this.dismiss.emit();
    const area = this.host.nativeElement.closest<HTMLElement>('.op-page');
    setTimeout(() => focusExpectedScan(area));
  }

  /** Re-creates the line for each new message so an error flashes again even if its text repeats. */
  revision = 0;

  get icon(): string {
    switch (this.message?.tone) {
      case 'success': return '✓';
      case 'error': return '!';
      case 'info': return 'i';
      default: return '→';
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['message'] && changes['message'].currentValue) this.revision++;
  }
}
