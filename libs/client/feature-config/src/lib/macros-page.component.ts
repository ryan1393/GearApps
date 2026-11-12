import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DanaConfirmDialogComponent,
  DanaCountBadgeDirective,
  DanaPageHeaderComponent,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';
import { LapperAccess, loadable, MacrosApi, ToastService } from '@meshforge/client/core';
import { summaryPlacement } from '@meshforge/client/feature-lapping-summary';
import { StatusBadgeComponent } from '@meshforge/client/ui';
import { Macro, macroLimitText, PER_CYCLE_MACROS } from '@meshforge/shared/domain';
import { MacroFormDialogComponent } from './macro-form-dialog.component';
import { MACRO_FORM_OPTIONS } from './options';

const ALL = '__all';
const NONE = '__none';

interface MacroRow extends Macro {
  placement: string | null;
}

@Component({
  selector: 'gear-macros-page',
  imports: [
    FormsModule,
    DanaConfirmDialogComponent,
    DanaCountBadgeDirective,
    DanaPageHeaderComponent,
    DanaTableDirective,
    DanaTableEmptyDirective,
    DanaTableShellDirective,
    StatusBadgeComponent,
    MacroFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-page gear-workflow-page">
      <section
        danaPageHeader
        eyebrow="LAPPER / CONFIGURATION"
        heading="Macros"
        description="Every Fanuc macro variable the lappers report, the summary form it belongs to and the limits its values are checked against."
      >
        <div danaPageHeaderAction class="dana-toolbar">
          <button
            type="button"
            class="gear-btn gear-btn-secondary"
            (click)="reload()"
            [disabled]="macros.loading()"
           data-icon="refresh" title="Refresh">
            ↻ {{ macros.loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
          @if (access.canEditSetup()) {
            <button type="button" class="gear-btn gear-btn-primary" (click)="openDialog(null)">
              + Add macro
            </button>
          }
        </div>
      </section>

      <section class="gear-workflow-table-panel">
        <div class="gear-workflow-table-heading gear-workflow-status-row">
          <div>
            <h2>All Macros</h2>
            <p>
              {{ visible().length }} of {{ macros.value().length }} shown ·
              {{ unplacedCount() }} not on the lapping summary.
            </p>
          </div>
          <span danaCountBadge class="gear-count-badge count-chip">{{ visible().length }}</span>
        </div>
        <div class="gear-workflow-section-body gear-form-grid">
          <label class="gear-field">
            Search
            <input
              class="gear-input"
              type="search"
              placeholder="Macro number or name…"
              [ngModel]="query()"
              (ngModelChange)="query.set($event)"
            />
          </label>
          <label class="gear-field">
            Summary form
            <select class="gear-select" [ngModel]="filter()" (ngModelChange)="filter.set($event)">
              @for (t of tabs(); track t.value) {
                <option [ngValue]="t.value">{{ t.label }} ({{ t.count }})</option>
              }
            </select>
          </label>
        </div>
        <div danaTableShell class="table-wrap">
          <table danaTable class="gear-table">
            <thead>
              <tr>
                <th>Macro</th>
                <th>Name</th>
                <th>Summary field</th>
                <th>Type</th>
                <th>Limits</th>
                <th title="A change in this value is flagged on the Lapper Dashboard">Flag changes</th>
                <th>Tab</th>
                <th>Status</th>
                <th data-dana-table-static aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              @for (m of visible(); track m.id) {
                <tr>
                  <td class="mono strong nowrap">#{{ m.number }}</td>
                  <td
                    class="mono nowrap"
                    [title]="
                      'L60 table: ' + (m.l60_table || '—') + (m.extra ? ' · ' + m.extra : '')
                    "
                  >
                    {{ m.name }}
                  </td>
                  <td>
                    @if (m.placement) {
                      {{ m.placement }}
                    } @else {
                      <span class="gear-muted">Not on summary</span>
                    }
                  </td>
                  <td>{{ m.type }}</td>
                  <td>
                    @if (limitText(m); as limits) {
                      {{ limits }}
                    } @else {
                      <span class="gear-muted">No limits</span>
                    }
                  </td>
                  <td>
                    @if (isCounter(m.number)) {
                      <span class="gear-muted" title="The consec counter goes up every cycle">Never</span>
                    } @else if (m.flag_changes === false) {
                      <span class="gear-muted">Off</span>
                    } @else {
                      <gear-status-badge tone="success" text="On" />
                    }
                  </td>
                  <td>{{ m.tab_index ?? '—' }}</td>
                  <td>
                    <gear-status-badge [status]="m.status === 1 ? 'Active' : 'Inactive'" />
                  </td>
                  <td class="right">
                    @if (access.canEditSetup()) {
                      <div class="gear-actions">
                        <button
                          type="button"
                          class="gear-btn gear-btn-secondary gear-btn-sm"
                          (click)="openDialog(m)"
                          [attr.aria-label]="'Edit macro ' + m.number"
                         data-icon="edit" title="Edit">
                          Edit
                        </button>
                        <button
                          type="button"
                          class="gear-btn gear-btn-danger gear-btn-sm"
                          (click)="pendingDelete.set(m)"
                          [attr.aria-label]="'Delete macro ' + m.number"
                         data-icon="delete" title="Delete">
                          Delete
                        </button>
                      </div>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td danaTableEmpty colspan="9" class="empty-row">
                    {{ macros.loading() ? 'Loading macros…' : 'No macros match.' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <gear-macro-form-dialog
      [(open)]="dialogOpen"
      [macro]="editing()"
      [defaultForm]="defaultForm()"
      (saved)="onSaved($event)"
    />
    <dana-confirm-dialog
      [open]="!!pendingDelete()"
      title="Delete macro"
      [message]="
        'Delete macro #' +
        (pendingDelete()?.number ?? '') +
        '? Logged values for it will no longer appear on lapping summaries.'
      "
      confirmLabel="Delete"
      [danger]="true"
      (confirm)="deleteConfirmed()"
      (cancel)="pendingDelete.set(null)"
    />
  `,
})
export class MacrosPageComponent implements OnInit {
  private readonly api = inject(MacrosApi);
  protected readonly limitText = macroLimitText;
  protected readonly isCounter = (number: number) => PER_CYCLE_MACROS.includes(number);
  private readonly toast = inject(ToastService);
  protected readonly access = inject(LapperAccess);

  protected readonly macros = loadable<Macro[]>([]);
  protected readonly filter = signal<string>(ALL);
  protected readonly query = signal('');

  private readonly rows = computed<MacroRow[]>(() =>
    [...this.macros.value()]
      .sort((a, b) => a.number - b.number)
      .map((m) => ({
        ...m,
        placement: summaryPlacement(m),
      })),
  );

  protected readonly tabs = computed(() => {
    const rows = this.rows();
    const count = (form: string | null) =>
      rows.filter((m) => (m.used_form ?? null) === form).length;
    const tabs = [{ value: ALL, label: 'All forms', count: rows.length }];
    for (const f of MACRO_FORM_OPTIONS) {
      const n = count(f.value);
      if (n) tabs.push({ value: f.value, label: f.label, count: n });
    }
    const known = new Set(MACRO_FORM_OPTIONS.map((f) => f.value));
    const other = rows.filter((m) => !m.used_form || !known.has(m.used_form)).length;
    if (other) tabs.push({ value: NONE, label: 'Not on a summary form', count: other });
    return tabs;
  });

  protected readonly visible = computed(() => {
    const f = this.filter();
    const q = this.query().trim().toLowerCase();
    const known = new Set(MACRO_FORM_OPTIONS.map((o) => o.value));
    return this.rows().filter((m) => {
      if (f === NONE && m.used_form && known.has(m.used_form)) return false;
      if (f !== ALL && f !== NONE && m.used_form !== f) return false;
      if (!q) return true;
      return String(m.number).includes(q) || m.name.toLowerCase().includes(q);
    });
  });

  protected readonly unplacedCount = computed(
    () => this.visible().filter((m) => !m.placement).length,
  );
  protected readonly defaultForm = computed(() =>
    this.filter() === ALL || this.filter() === NONE ? null : this.filter(),
  );

  protected dialogOpen = false;
  protected readonly editing = signal<Macro | null>(null);
  protected readonly pendingDelete = signal<Macro | null>(null);

  ngOnInit() {
    this.reload();
  }

  protected reload() {
    this.macros.load(this.api.list());
  }

  protected openDialog(m: Macro | null) {
    this.editing.set(m);
    this.dialogOpen = true;
  }

  protected onSaved(m: Macro) {
    this.toast.success(this.editing() ? 'Macro updated' : 'Macro added', `#${m.number} ${m.name}`);
    this.reload();
  }

  protected deleteConfirmed() {
    const m = this.pendingDelete();
    if (!m) return;
    this.pendingDelete.set(null);
    this.api.delete(m.id).subscribe({
      next: () => {
        this.toast.success('Macro deleted', `#${m.number} ${m.name}`);
        this.reload();
      },
      error: (err) => this.toast.error(err, 'Could not delete macro'),
    });
  }
}
