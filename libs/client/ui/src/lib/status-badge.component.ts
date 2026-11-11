import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Dana status badge driven by an Active/Inactive-style status string (or an explicit tone). */
@Component({
  selector: 'gear-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="dana-status-badge" [attr.data-tone]="resolvedTone()">{{
    label()
  }}</span>`,
})
export class StatusBadgeComponent {
  readonly status = input<string | null | undefined>();
  readonly tone = input<Tone>();
  readonly text = input<string>();

  readonly label = computed(() => {
    const raw = this.text() ?? this.status() ?? 'Unknown';
    return this.text() ? raw : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  });
  readonly resolvedTone = computed<Tone>(() => {
    if (this.tone()) return this.tone() as Tone;
    const s = (this.status() ?? '').trim().toLowerCase();
    if (['active', 'running', 'ok', 'pass', 'on', 'true'].includes(s)) return 'success';
    if (['inactive', 'stopped', 'fail', 'error', 'off'].includes(s)) return 'danger';
    if (['idle', 'warning', 'pending'].includes(s)) return 'warning';
    return 'neutral';
  });
}
