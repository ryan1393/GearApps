import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { apiErrorMessage, GearsetsApi, MachinesApi, MacrosApi, loadable } from '@meshforge/client/core';
import {
  CycleTestRun,
  Gearset,
  Machine,
  Macro,
  macroLimitState,
  macroLimitText,
} from '@meshforge/shared/domain';
import { DanaPageHeaderComponent, DanaToneDirective } from '@dana/ui';

@Component({
  selector: 'gear-cycle-tests-page',
  imports: [CommonModule, FormsModule, DanaPageHeaderComponent, DanaToneDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      danaPageHeader
      heading="Cycle Test Lab"
      description="Try a cycle with a serial number before it runs for real. Values are checked against each macro's type and the limits set in Admin > Macros. Test runs are saved separately from production and never command a machine."
    ></section>
    @if (error()) {
      <p class="gear-alert gear-alert-danger" role="alert">{{ error() }}</p>
    }
    @if (machines.error() || gearsets.error() || macros.error()) {
      <p class="gear-alert gear-alert-danger" role="alert">
        Could not load the configuration.
        <button type="button" class="gear-btn gear-btn-secondary" (click)="reload()">Retry</button>
      </p>
    }
    <form class="gear-panel cycle-test-panel" (ngSubmit)="run()">
      <div class="gear-form-grid">
        <label class="gear-field"
          >Machine<select class="gear-select" name="machine" [(ngModel)]="machineId" required>
            <option value="">Choose a machine</option>
            @for (m of machines.value(); track m.id) {
              <option [value]="m.id">{{ m.number || m.ip }}</option>
            }
          </select></label
        >
        <label class="gear-field"
          >Gearset<select class="gear-select" name="gearset" [(ngModel)]="gearsetId" required>
            <option value="">Choose a gearset</option>
            @for (g of gearsets.value(); track g.id) {
              <option [value]="g.id">{{ g.number }}</option>
            }
          </select></label
        >
        <label class="gear-field"
          >Test serial number<input
            class="gear-input"
            name="serial"
            [(ngModel)]="serial"
            maxlength="160"
            required
        /></label>
      </div>
      <h3 class="cycle-test-heading">Active macro values</h3>
      @if (!macros.loading() && !activeMacros().length) {
        <p class="gear-muted">No active macros yet. Add them in Admin > Macros.</p>
      }
      <div class="gear-form-grid">
        @for (m of activeMacros(); track m.id) {
          <label class="gear-field"
            >#{{ m.number }} · {{ m.name }}
            <input
              class="gear-input"
              type="number"
              [step]="m.type === 'real' ? 'any' : '1'"
              [name]="'macro-' + m.id"
              [(ngModel)]="values[m.number]"
            />
            <small class="gear-field-help"
              >{{ m.type }} · {{ limitText(m) ? 'Limit: ' + limitText(m) : 'No limits set' }}</small
            >
          </label>
        }
      </div>
      <div class="gear-admin-form-actions">
        <button
          class="gear-btn gear-btn-primary"
          type="submit"
          [disabled]="busy() || !machineId || !gearsetId || !serial.trim() || macros.loading()"
        >
          {{ busy() ? 'Testing…' : 'Run and save test' }}
        </button>
      </div>
    </form>
    <section class="gear-panel cycle-test-panel">
      <div class="cycle-test-history-heading">
        <div>
          <h2>Test history</h2>
          <p class="gear-muted">The latest 100 saved test runs. Failed runs are kept for diagnosis.</p>
        </div>
        <button type="button" class="gear-btn gear-btn-secondary" (click)="refreshHistory()">
          Refresh history
        </button>
      </div>
      @if (history.error()) {
        <p class="gear-alert gear-alert-danger" role="alert">Could not load test history.</p>
      }
      @for (test of history.value(); track test.id) {
        <details class="cycle-test-result">
          <summary>
            <span class="dana-status-badge" [danaTone]="test.result.passed ? 'pass' : 'fail'"
              >Test · {{ test.result.passed ? 'Pass' : 'Fail' }}</span
            >
            <strong>{{ test.serial_number }}</strong>
            <span class="gear-muted"
              >{{ machineLabel(test.machine_id) }} · {{ gearsetLabel(test.gearset_id) }} ·
              {{ test.created_at | date: 'medium' }}</span
            >
          </summary>
          @if (test.result.issues.length) {
            <ul class="cycle-test-issues">
              @for (issue of test.result.issues; track $index) {
                <li>{{ issue }}</li>
              }
            </ul>
          }
          <div class="cycle-test-values">
            @for (macro of test.result.macros; track macro.number) {
              <div class="cycle-test-value" [attr.data-state]="valueState(macro)">
                <span class="cycle-test-value-label">#{{ macro.number }} · {{ macro.name }}</span>
                <strong>{{ macro.value ?? 'Missing' }}{{ macro.unit ? ' ' + macro.unit : '' }}</strong>
                @if (limitText(macro); as limits) {
                  <small class="gear-muted">Limit: {{ limits }}</small>
                }
              </div>
            }
          </div>
        </details>
      } @empty {
        <p class="gear-muted">{{ history.loading() ? 'Loading…' : 'No saved tests yet.' }}</p>
      }
    </section>
  `,
  styles: `
    :host { display: grid; gap: 1rem; }
    .cycle-test-panel { padding: 1.25rem; }
    .cycle-test-heading { margin: 1.25rem 0 .75rem; font-size: 1rem; }
    .cycle-test-panel .gear-admin-form-actions { margin-top: 1.25rem; }
    .cycle-test-history-heading { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: .75rem; margin-bottom: .5rem; }
    .cycle-test-history-heading h2 { margin: 0; font-size: 1.125rem; }
    .cycle-test-history-heading p { margin: .25rem 0 0; }
    .cycle-test-result { padding: .75rem 0; border-top: 1px solid var(--dana-border); overflow-wrap: anywhere; }
    .cycle-test-result summary { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem; cursor: pointer; }
    .cycle-test-issues { margin: .75rem 0 0; padding-left: 1.25rem; color: var(--dana-danger); }
    .cycle-test-values { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr)); gap: .5rem; margin-top: .75rem; }
    .cycle-test-value { display: grid; gap: .125rem; padding: .5rem .75rem; border: 1px solid var(--dana-border); border-radius: var(--dana-radius-md); background: var(--dana-surface); }
    .cycle-test-value[data-state='fail'] { border-color: var(--dana-danger); background: var(--dana-danger-soft); }
    .cycle-test-value-label { font-size: .75rem; font-weight: 700; color: var(--dana-muted); }
  `,
})
export class CycleTestsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly machinesApi = inject(MachinesApi);
  private readonly gearsetsApi = inject(GearsetsApi);
  private readonly macrosApi = inject(MacrosApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly machines = loadable<Machine[]>([]);
  protected readonly gearsets = loadable<Gearset[]>([]);
  protected readonly macros = loadable<Macro[]>([]);
  protected readonly history = loadable<CycleTestRun[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected machineId = '';
  protected gearsetId = '';
  protected serial = '';
  protected values: Record<string, number | null> = {};
  protected readonly activeMacros = computed(() => this.macros.value().filter((m) => m.status === 1));
  protected readonly limitText = macroLimitText;
  /** Saved runs keep IDs; show the names people know. */
  protected machineLabel(id: string): string {
    const machine = this.machines.value().find((m) => m.id === id);
    return machine ? 'Machine ' + (machine.number || machine.ip) : 'Machine no longer configured';
  }
  protected gearsetLabel(id: string): string {
    const gearset = this.gearsets.value().find((g) => g.id === id);
    return gearset ? 'Gearset ' + gearset.number : 'Gearset no longer configured';
  }
  protected valueState(macro: CycleTestRun['result']['macros'][number]): 'ok' | 'fail' {
    return macro.value === null || macroLimitState(macro.value, macro) !== 'ok' ? 'fail' : 'ok';
  }
  ngOnInit() { this.reload(); }
  protected reload() {
    this.machines.load(this.machinesApi.list());
    this.gearsets.load(this.gearsetsApi.list());
    this.macros.load(this.macrosApi.list());
    this.refreshHistory();
  }
  protected refreshHistory() { this.history.load(this.http.get<CycleTestRun[]>('/api/v1/admin/cycle-tests')); }
  protected run() {
    if (this.busy() || !this.machineId || !this.gearsetId || !this.serial.trim()) return;
    this.busy.set(true); this.error.set('');
    const values = Object.fromEntries(Object.entries(this.values).filter(([, v]) => v !== null));
    this.http.post<CycleTestRun>('/api/v1/admin/cycle-tests', {
      machine_id: this.machineId, gearset_id: this.gearsetId, serial_number: this.serial.trim(), values,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busy.set(false); this.refreshHistory(); },
      error: error => { this.busy.set(false); this.error.set(apiErrorMessage(error)); },
    });
  }
}
