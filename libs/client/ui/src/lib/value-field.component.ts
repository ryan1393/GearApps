import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Read-only labelled value (Dana `.dana-detail`). Numbers are formatted,
 * Fanuc-style flags (-1 / 1 = ON) render as a status badge, missing values show "—".
 */
@Component({
  selector: 'gear-value-field',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dana-detail" [class.is-compact]="compact()">
      <span class="dana-detail-label">{{ label() }}</span>
      @switch (kind()) {
        @case ('flag') {
          <span class="dana-detail-value">
            <span class="dana-status-badge" [attr.data-tone]="flagOn() ? 'success' : 'neutral'">{{
              flagOn() ? 'ON' : 'OFF'
            }}</span>
          </span>
        }
        @case ('number') {
          <span class="dana-detail-value"
            >{{ numeric() | number: digits() }}
            @if (unit()) {
              <small class="dana-muted">{{ unit() }}</small>
            }
          </span>
        }
        @default {
          <span class="dana-detail-value" [class.dana-muted]="isEmpty()">{{ display() }}</span>
        }
      }
    </div>
  `,
  styles: `
    .dana-detail.is-compact {
      padding: 9px 10px;
    }
    .dana-detail.is-compact .dana-detail-value {
      font-size: 14px;
    }
    .dana-detail-value {
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .dana-detail-value small {
      margin-left: 3px;
      font-size: 11px;
      font-weight: 600;
    }
  `,
})
export class ValueFieldComponent {
  readonly label = input.required<string>();
  readonly value = input<number | string | boolean | null | undefined>();
  readonly type = input<'auto' | 'flag' | 'text'>('auto');
  readonly unit = input<string>();
  readonly digits = input('1.0-3');
  readonly compact = input(false);

  readonly numeric = computed(() =>
    typeof this.value() === 'number' ? (this.value() as number) : null,
  );
  readonly kind = computed(() => {
    if (this.type() === 'flag') return 'flag';
    if (this.type() === 'text') return 'text';
    return typeof this.value() === 'number' ? 'number' : 'text';
  });
  readonly flagOn = computed(() => {
    const v = this.value();
    return v === true || v === 1 || v === -1 || v === '1' || v === 'true';
  });
  readonly isEmpty = computed(() => this.value() == null || this.value() === '');
  readonly display = computed(() => (this.isEmpty() ? '—' : String(this.value())));
}
