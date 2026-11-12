import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ValueFieldComponent } from '@meshforge/client/ui';
import { LappingSummaryRow } from '@meshforge/shared/domain';
import { fieldValue, GroupDef, RETRACT_MODES } from './macro-map';

/** One titled group of macro-backed fields inside a Dana card section. */
@Component({
  selector: 'gear-summary-group',
  imports: [ValueFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="dana-card-section gear-group">
      <div class="dana-section-title">{{ group().title }}</div>
      <div class="gear-group-fields" [style.--cols]="columns()">
        @for (f of group().fields; track f.label) {
          @let v = value(f);
          @if (f.kind === 'retract') {
            <gear-value-field
              [label]="f.label"
              [value]="v === null || v === undefined ? null : retractLabel(v)"
              type="text"
              [compact]="true"
            />
          } @else {
            <gear-value-field
              [label]="f.label"
              [value]="v"
              [type]="f.kind === 'flag' ? 'flag' : 'auto'"
              [unit]="f.unit"
              [compact]="true"
            />
          }
        }
      </div>
    </section>
  `,
  styles: `
    .gear-group {
      display: grid;
      gap: 0;
      align-content: start;
    }
    .gear-group-fields {
      display: grid;
      grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr));
      gap: var(--dana-field-gap);
    }
    @media (max-width: 520px) {
      .gear-group-fields {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class SummaryGroupComponent {
  readonly group = input.required<GroupDef>();
  readonly rows = input.required<LappingSummaryRow[]>();
  readonly columns = input(2);
  protected readonly retract = RETRACT_MODES;

  protected retractLabel(v: number): string | number {
    return this.retract[v] ?? v;
  }

  protected value(f: GroupDef['fields'][number]) {
    return fieldValue(this.rows(), f);
  }
}
