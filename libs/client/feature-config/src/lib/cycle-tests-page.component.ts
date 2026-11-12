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
  ControllerMacroValues,
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
    <form class="gear-panel dana-panel-padded cycle-test-panel" (ngSubmit)="run()">
      <div class="gear-form-grid">
        <label class="gear-field"
          >Machine<select class="gear-select" name="machine" [(ngModel)]="machineId" [disabled]="working()" required>
            <option value="">Choose a machine</option>
            @for (m of machines.value(); track m.id) {
              <option [value]="m.id">{{ m.number || m.ip }}</option>
            }
          </select></label
        >
        <label class="gear-field"
          >Gearset<select class="gear-select" name="gearset" [(ngModel)]="gearsetId" [disabled]="working()" required>
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
            [disabled]="working()"
            maxlength="160"
            required
        /></label>
      </div>
      <div class="cycle-test-read">
        <button
          type="button"
          class="gear-btn gear-btn-secondary"
          (click)="readFromMachine()"
          [disabled]="working() || !machineId"
        >
          {{ reading() ? 'Reading the controller…' : 'Read values from machine' }}
        </button>
        <span class="gear-muted"
          >Fills the macros below and the Argonaut macros with the controller's current values, read by Lapper
          Read. Nothing is written to the machine.</span
        >
      </div>
      @if (readError()) {
        <p class="gear-alert gear-alert-danger" role="alert">{{ readError() }}</p>
      }
      @if (lastRead(); as read) {
        <p class="gear-muted" role="status">
          Read {{ readCount(read) }} of {{ readTotal(read) }} macros from {{ machineLabel(read.machine_id) }} at
          {{ read.read_at | date: 'mediumTime' }}.
          @if (readTotal(read) - readCount(read); as unanswered) {
            {{ unanswered }} did not answer and were left blank (Argonaut gets 0).
          }
        </p>
      }
      <h3 class="dana-section-title cycle-test-heading">Active macro values</h3>
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
              [disabled]="working()"
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
          [disabled]="working() || !machineId || !gearsetId || !serial.trim() || macros.loading()"
        >
          {{ busy() ? 'Testing…' : 'Run and save test' }}
        </button>
      </div>
    </form>
    <form class="gear-panel dana-panel-padded cycle-test-panel" (ngSubmit)="sendToArgonaut()">
      <h2 class="gear-panel-title">Send to Argonaut</h2>
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
            [disabled]="working()"
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
            [disabled]="working()"
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
            [disabled]="working()"
            required
          />
          <small class="gear-field-help">A real cycle sends its consec number.</small>
        </label>
        <label class="gear-field"
          >Cycle time (seconds)<input
            class="gear-input"
            type="number"
            name="cycleTime"
            min="0"
            step="any"
            [(ngModel)]="cycleTime"
            [disabled]="working()"
          />
          <small class="gear-field-help">Sent as floatData[0]. A real cycle sends the time the lapper was in cycle; empty sends 0.</small>
        </label>
      </div>
      <details class="cycle-test-details">
        <summary>Argonaut macro values · {{ argonautFilled() }} of {{ argonautMacros.length }} entered, the rest are sent as 0</summary>
        <p class="gear-muted">#10020 defaults to the gearset number.</p>
        <div class="cycle-test-macro-grid">
          @for (n of argonautMacros; track n) {
            <label class="gear-field"
              >#{{ n }}<input class="gear-input" type="number" step="any" [name]="'argonaut-' + n" [(ngModel)]="values[n]" [disabled]="working()"
            /></label>
          }
        </div>
      </details>
      @if (argonautError()) {
        <p class="gear-alert gear-alert-danger" role="alert">{{ argonautError() }}</p>
      }
      @if (argonautPreview(); as preview) {
        <div class="dana-card-section cycle-test-argonaut-box">
          <strong>Request preview</strong>
          <span class="gear-muted">POST {{ preview.url }}</span>
          <pre class="dana-code-block cycle-test-json">{{ preview.payload | json }}</pre>
        </div>
      }
      <div class="gear-admin-form-actions">
        <button
          class="gear-btn gear-btn-secondary"
          type="button"
          (click)="previewArgonaut()"
          [disabled]="working() || !argonautReady()"
        >
          Preview request
        </button>
        <button class="gear-btn gear-btn-primary" type="submit" [disabled]="working() || !argonautReady()">
          {{ argonautBusy() ? 'Sending…' : 'Send to Argonaut' }}
        </button>
      </div>
      @if (argonautResult(); as r) {
        <div class="dana-card-section cycle-test-argonaut-box" role="status">
          <span class="dana-status-badge" [danaTone]="r.ok ? 'pass' : 'fail'"
            >Argonaut · {{ r.ok ? 'Accepted' : 'Not accepted' }}</span
          >
          <span>{{ r.message }}</span>
          <span class="gear-muted">Sent to {{ r.url }} · {{ r.sent_at | date: 'medium' }}</span>
          @if (r.response) {
            <pre class="dana-code-block cycle-test-json">{{ r.response }}</pre>
          }
          <details class="cycle-test-details">
            <summary>Request sent</summary>
            <pre class="dana-code-block cycle-test-json">{{ r.payload | json }}</pre>
          </details>
        </div>
      }
    </form>
    <section class="gear-panel dana-panel-padded cycle-test-panel">
      <div class="cycle-test-history-heading">
        <div>
          <h2 class="gear-panel-title">Test history</h2>
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
        <details class="dana-divider-section cycle-test-result">
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
              <div class="dana-detail cycle-test-value" [attr.data-state]="valueState(macro)" [attr.data-tone]="valueState(macro) === 'fail' ? 'danger' : null">
                <span class="dana-detail-label">#{{ macro.number }} · {{ macro.name }}</span>
                <strong class="dana-detail-value">{{ macro.value ?? 'Missing' }}{{ macro.unit ? ' ' + macro.unit : '' }}</strong>
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
  host: { class: 'dana-page-stack' },
  styles: `
    .cycle-test-heading { margin-block: var(--dana-section-gap) var(--dana-form-gap); }
    .cycle-test-panel .gear-admin-form-actions { margin-top: var(--dana-section-gap); }
    .cycle-test-history-heading { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--dana-action-gap); margin-bottom: var(--dana-field-gap); }
    .cycle-test-result { overflow-wrap: anywhere; }
    .cycle-test-result summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--dana-field-gap) var(--dana-action-gap); }
    .cycle-test-issues { margin: var(--dana-form-gap) 0 0; padding-inline-start: var(--dana-space-5); }
    .cycle-test-values { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr)); gap: var(--dana-field-gap); margin-top: var(--dana-form-gap); }
    .cycle-test-value { display: grid; gap: var(--dana-space-1); }
    .cycle-test-read { display: flex; flex-wrap: wrap; align-items: center; gap: var(--dana-action-gap); margin-top: var(--dana-form-gap); }
    .cycle-test-read .gear-muted { flex: 1 1 18rem; }
    .cycle-test-intro { max-width: 48rem; }
    .cycle-test-details { margin-top: var(--dana-form-gap); }
    .cycle-test-macro-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 9rem), 1fr)); gap: var(--dana-field-gap); margin-top: var(--dana-field-gap); }
    .cycle-test-argonaut-box { display: grid; gap: var(--dana-field-gap); margin-top: var(--dana-form-gap); overflow-wrap: anywhere; }
    .cycle-test-argonaut-box .dana-status-badge { justify-self: start; }
    .cycle-test-json { max-height: 20rem; }

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
  protected cycleTime: number | null = null;
  protected readonly argonautMacros = ARGONAUT_MACROS;
  protected readonly argonautBusy = signal(false);
  protected readonly argonautError = signal('');
  protected readonly argonautPreview = signal<{ url: string; payload: ArgonautPayload } | null>(null);
  protected readonly argonautResult = signal<ArgonautTestResult | null>(null);
  protected readonly reading = signal(false);
  protected readonly readError = signal('');
  protected readonly lastRead = signal<ControllerMacroValues | null>(null);
  protected readonly working = computed(() => this.busy() || this.reading() || this.argonautBusy());
  protected readCount(read: ControllerMacroValues): number {
    return Object.values(read.values).filter((v) => v !== null).length;
  }
  protected readTotal(read: ControllerMacroValues): number {
    return Object.keys(read.values).length;
  }
  /** Replaces the entered values with the controller's; macros it did not answer are cleared. */
  protected readFromMachine() {
    if (this.working() || !this.machineId) return;
    const machineId = this.machineId;
    this.reading.set(true); this.readError.set(''); this.lastRead.set(null);
    this.http.post<ControllerMacroValues>('/api/v1/admin/cycle-tests/controller-values', { machine_id: machineId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (read) => {
          if (this.machineId !== machineId || read.machine_id !== machineId) {
            this.reading.set(false);
            this.readError.set('The selected machine changed. Read values again for the current machine.');
            return;
          }
          this.values = { ...this.values, ...read.values };
          this.argonautPreview.set(null);
          this.reading.set(false);
          this.lastRead.set(read);
        },
        error: (error) => { this.reading.set(false); this.readError.set(apiErrorMessage(error)); },
      });
  }
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
    const cycleTime = this.cycleTime;
    const cycleTimeValid = cycleTime === null || cycleTime === undefined || (typeof cycleTime === 'number' && Number.isFinite(cycleTime) && cycleTime >= 0 && cycleTime <= 86400);
    return !!this.machineId && !!this.gearsetId && !!this.serial.trim() && typeof sequence === 'number' && Number.isInteger(sequence) && sequence >= 0 && cycleTimeValid;
  }
  private argonautInput(): ArgonautTestInput {
    const values = Object.fromEntries(
      Object.entries(this.values).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
    );
    return {
      machine_id: this.machineId, gearset_id: this.gearsetId, serial_number: this.serial.trim(), sequence: this.sequence ?? 0, values,
      ...(this.argonautUrl.trim() ? { url: this.argonautUrl.trim() } : {}),
      ...(this.argonautLocation.trim() ? { location_id: this.argonautLocation.trim() } : {}),
      ...(typeof this.cycleTime === 'number' && Number.isFinite(this.cycleTime) ? { cycle_time_s: this.cycleTime } : {}),
    };
  }
  private previewRequest(input: ArgonautTestInput) {
    return this.http.post<{ url: string; payload: ArgonautPayload }>('/api/v1/admin/cycle-tests/argonaut/preview', input)
      .pipe(takeUntilDestroyed(this.destroyRef));
  }
  protected previewArgonaut() {
    if (this.working() || !this.argonautReady()) return;
    const input = this.argonautInput();
    this.argonautBusy.set(true); this.argonautError.set(''); this.argonautResult.set(null);
    this.previewRequest(input).subscribe({
      next: (preview) => { this.argonautBusy.set(false); this.argonautPreview.set(preview); },
      error: (error) => { this.argonautBusy.set(false); this.argonautPreview.set(null); this.argonautError.set(apiErrorMessage(error)); },
    });
  }
  /** Shows the exact address and serial first: Argonaut records every transaction it accepts. */
  protected sendToArgonaut() {
    if (this.working() || !this.argonautReady()) return;
    const input = this.argonautInput();
    this.argonautBusy.set(true); this.argonautError.set(''); this.argonautResult.set(null);
    this.previewRequest(input).subscribe({
      next: (preview) => {
        this.argonautPreview.set(preview);
        const r = preview.payload.request;
        if (!globalThis.confirm(`Send a test transaction to Argonaut?\n\nAddress: ${preview.url}\nSerial: ${r.serialNumber}\nPart number: ${r.partNumber}\nSequence: ${r.sequence}\n\nArgonaut records it as a real transaction.`)) {
          this.argonautBusy.set(false);
          return;
        }
        this.http.post<ArgonautTestResult>('/api/v1/admin/cycle-tests/argonaut', input)
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
    if (this.working() || !this.machineId || !this.gearsetId || !this.serial.trim()) return;
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
