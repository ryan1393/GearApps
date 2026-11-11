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
  ARGONAUT_MACROS,
  ArgonautPayload,
  ArgonautTestInput,
  ArgonautTestResult,
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
    <form class="gear-panel cycle-test-panel" (ngSubmit)="sendToArgonaut()">
      <h2 class="cycle-test-title">Send to Argonaut</h2>
      <p class="gear-muted cycle-test-intro">
        Sends one real Track and Trace transaction for the machine, gearset and serial number above, built
        exactly as Lapper Read sends a finished cycle. Argonaut records it, so point it at a test location.
        Nothing is saved in MeshForge.
      </p>
      <div class="gear-form-grid">
        <label class="gear-field"
          >Argonaut address<input
            class="gear-input"
            name="argonautUrl"
            [(ngModel)]="argonautUrl"
            maxlength="2000"
            [placeholder]="selectedMachine()?.argonaut_url || 'https://argonaut:3003/api/mes/trigger-transaction'"
          />
          <small class="gear-field-help">{{
            selectedMachine()?.argonaut_url
              ? "Empty uses this machine's saved address."
              : 'Empty uses the address in Admin > Server Settings > Lapping and scanners.'
          }}</small>
        </label>
        <label class="gear-field"
          >Location ID<input
            class="gear-input"
            name="argonautLocation"
            [(ngModel)]="argonautLocation"
            maxlength="200"
            [placeholder]="selectedMachine()?.argonaut_location_id || ''"
          />
          <small class="gear-field-help"
            >Empty uses the machine's, then Server Settings'. Sign-in comes from Server Settings. An address that already has
            ?locationId= is sent as entered.</small
          >
        </label>
        <label class="gear-field"
          >Sequence<input
            class="gear-input"
            type="number"
            name="sequence"
            min="0"
            step="1"
            [(ngModel)]="sequence"
            required
          />
          <small class="gear-field-help">A real cycle sends its consec number.</small>
        </label>
      </div>
      <details class="cycle-test-details">
        <summary>Argonaut macro values · {{ argonautFilled() }} of {{ argonautMacros.length }} entered, the rest are sent as 0</summary>
        <p class="gear-muted">#10020 defaults to the gearset number.</p>
        <div class="cycle-test-macro-grid">
          @for (n of argonautMacros; track n) {
            <label class="gear-field"
              >#{{ n }}<input class="gear-input" type="number" step="any" [name]="'argonaut-' + n" [(ngModel)]="values[n]"
            /></label>
          }
        </div>
      </details>
      @if (argonautError()) {
        <p class="gear-alert gear-alert-danger" role="alert">{{ argonautError() }}</p>
      }
      @if (argonautPreview(); as preview) {
        <div class="cycle-test-argonaut-box">
          <strong>Request preview</strong>
          <span class="gear-muted">POST {{ preview.url }}</span>
          <pre class="cycle-test-json">{{ preview.payload | json }}</pre>
        </div>
      }
      <div class="gear-admin-form-actions">
        <button
          class="gear-btn gear-btn-secondary"
          type="button"
          (click)="previewArgonaut()"
          [disabled]="argonautBusy() || !argonautReady()"
        >
          Preview request
        </button>
        <button class="gear-btn gear-btn-primary" type="submit" [disabled]="argonautBusy() || !argonautReady()">
          {{ argonautBusy() ? 'Sending…' : 'Send to Argonaut' }}
        </button>
      </div>
      @if (argonautResult(); as r) {
        <div class="cycle-test-argonaut-box" role="status">
          <span class="dana-status-badge" [danaTone]="r.ok ? 'pass' : 'fail'"
            >Argonaut · {{ r.ok ? 'Accepted' : 'Not accepted' }}</span
          >
          <span>{{ r.message }}</span>
          <span class="gear-muted">Sent to {{ r.url }} · {{ r.sent_at | date: 'medium' }}</span>
          @if (r.response) {
            <pre class="cycle-test-json">{{ r.response }}</pre>
          }
          <details class="cycle-test-details">
            <summary>Request sent</summary>
            <pre class="cycle-test-json">{{ r.payload | json }}</pre>
          </details>
        </div>
      }
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
    .cycle-test-title { margin: 0; font-size: 1.125rem; }
    .cycle-test-intro { margin: .25rem 0 1rem; max-width: 48rem; }
    .cycle-test-details { margin-top: 1rem; }
    .cycle-test-details summary { cursor: pointer; font-weight: 600; }
    .cycle-test-macro-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 9rem), 1fr)); gap: .5rem; margin-top: .5rem; }
    .cycle-test-argonaut-box { display: grid; gap: .375rem; margin-top: 1rem; padding: .75rem; border: 1px solid var(--dana-border); border-radius: var(--dana-radius-md); overflow-wrap: anywhere; }
    .cycle-test-argonaut-box .dana-status-badge { justify-self: start; }
    .cycle-test-json { margin: 0; max-height: 20rem; overflow: auto; padding: .5rem; font-size: .75rem; white-space: pre-wrap; background: var(--dana-surface); border-radius: var(--dana-radius-md); }
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
  protected argonautUrl = '';
  protected argonautLocation = '';
  protected sequence: number | null = 1;
  protected readonly argonautMacros = ARGONAUT_MACROS;
  protected readonly argonautBusy = signal(false);
  protected readonly argonautError = signal('');
  protected readonly argonautPreview = signal<{ url: string; payload: ArgonautPayload } | null>(null);
  protected readonly argonautResult = signal<ArgonautTestResult | null>(null);
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
  protected selectedMachine(): Machine | undefined {
    return this.machines.value().find((m) => m.id === this.machineId);
  }
  protected argonautFilled(): number {
    return ARGONAUT_MACROS.filter((n) => typeof this.values[n] === 'number').length;
  }
  protected argonautReady(): boolean {
    const sequence = this.sequence;
    return !!this.machineId && !!this.gearsetId && !!this.serial.trim() && typeof sequence === 'number' && Number.isInteger(sequence) && sequence >= 0;
  }
  private argonautInput(): ArgonautTestInput {
    const values = Object.fromEntries(
      Object.entries(this.values).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
    );
    return {
      machine_id: this.machineId, gearset_id: this.gearsetId, serial_number: this.serial.trim(), sequence: this.sequence ?? 0, values,
      ...(this.argonautUrl.trim() ? { url: this.argonautUrl.trim() } : {}),
      ...(this.argonautLocation.trim() ? { location_id: this.argonautLocation.trim() } : {}),
    };
  }
  private previewRequest() {
    return this.http.post<{ url: string; payload: ArgonautPayload }>('/api/v1/admin/cycle-tests/argonaut/preview', this.argonautInput())
      .pipe(takeUntilDestroyed(this.destroyRef));
  }
  protected previewArgonaut() {
    if (this.argonautBusy() || !this.argonautReady()) return;
    this.argonautBusy.set(true); this.argonautError.set(''); this.argonautResult.set(null);
    this.previewRequest().subscribe({
      next: (preview) => { this.argonautBusy.set(false); this.argonautPreview.set(preview); },
      error: (error) => { this.argonautBusy.set(false); this.argonautPreview.set(null); this.argonautError.set(apiErrorMessage(error)); },
    });
  }
  /** Shows the exact address and serial first: Argonaut records every transaction it accepts. */
  protected sendToArgonaut() {
    if (this.argonautBusy() || !this.argonautReady()) return;
    this.argonautBusy.set(true); this.argonautError.set(''); this.argonautResult.set(null);
    this.previewRequest().subscribe({
      next: (preview) => {
        this.argonautPreview.set(preview);
        const r = preview.payload.request;
        if (!globalThis.confirm(`Send a test transaction to Argonaut?\n\nAddress: ${preview.url}\nSerial: ${r.serialNumber}\nPart number: ${r.partNumber}\nSequence: ${r.sequence}\n\nArgonaut records it as a real transaction.`)) {
          this.argonautBusy.set(false);
          return;
        }
        this.http.post<ArgonautTestResult>('/api/v1/admin/cycle-tests/argonaut', this.argonautInput())
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (result) => { this.argonautBusy.set(false); this.argonautPreview.set(null); this.argonautResult.set(result); },
            error: (error) => { this.argonautBusy.set(false); this.argonautError.set(apiErrorMessage(error)); },
          });
      },
      error: (error) => { this.argonautBusy.set(false); this.argonautError.set(apiErrorMessage(error)); },
    });
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
