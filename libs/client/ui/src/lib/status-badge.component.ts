import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DanaTone, danaToneFor } from '@dana/ui';

export type Tone = DanaTone;

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
  /** The shared Dana vocabulary decides the colour unless a tone is given. */
  readonly resolvedTone = computed<Tone>(() => this.tone() ?? danaToneFor(this.status()));
}
