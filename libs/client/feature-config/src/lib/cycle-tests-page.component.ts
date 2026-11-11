import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { apiErrorMessage, GearsetsApi, MachinesApi, MacrosApi, loadable } from '@meshforge/client/core';
import { CycleTestRun, Gearset, Machine, Macro } from '@meshforge/shared/domain';
import { DanaPageHeaderComponent } from '@dana/ui';

@Component({
  selector: 'gear-cycle-tests-page',
  imports: [CommonModule, FormsModule, DanaPageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section danaPageHeader heading="Cycle Test Lab" description="Validate a serial number and configured macro values. Test runs are saved separately from production and do not command machines."></section>
    @if (error()) { <p class="gear-alert gear-alert-danger" role="alert">{{ error() }}</p> }
    @if (machines.error() || gearsets.error() || macros.error()) { <p class="gear-alert gear-alert-danger" role="alert">Could not load the configuration. <button class="gear-btn gear-btn-secondary" (click)="reload()">Retry</button></p> }
    <form class="gear-panel p-5" (ngSubmit)="run()">
      <div class="gear-form-grid">
        <label class="gear-field">Machine<select class="gear-select" name="machine" [(ngModel)]="machineId" required><option value="">Choose a machine</option>@for (m of machines.value(); track m.id) { <option [value]="m.id">{{ m.number || m.ip }}</option> }</select></label>
        <label class="gear-field">Gearset<select class="gear-select" name="gearset" [(ngModel)]="gearsetId" required><option value="">Choose a gearset</option>@for (g of gearsets.value(); track g.id) { <option [value]="g.id">{{ g.number }}</option> }</select></label>
        <label class="gear-field">Test serial number<input class="gear-input" name="serial" [(ngModel)]="serial" maxlength="160" required /></label>
      </div>
      <h3>Active macro values</h3>
      <div class="gear-form-grid">
        @for (m of macros.value(); track m.id) {
          @if (m.status === 1) { <label class="gear-field">#{{ m.number }} · {{ m.name }} ({{ m.type }})<input class="gear-input" type="number" [step]="m.type === 'real' ? 'any' : '1'" [name]="'macro-' + m.id" [(ngModel)]="values[m.number]" /></label> }
        }
      </div>
      <button class="gear-btn gear-btn-primary" type="submit" [disabled]="busy() || !machineId || !gearsetId || !serial.trim() || macros.loading()">{{ busy() ? 'Testing…' : 'Run and save test' }}</button>
    </form>
    <section class="gear-panel p-5"><h2>Simulation history</h2><p>Latest 100 saved test runs. Validation failures are retained for diagnosis.</p>
      <button class="gear-btn gear-btn-secondary" (click)="refreshHistory()">Refresh history</button>
      @if (history.error()) { <p role="alert">Could not load test history.</p> }
      @for (test of history.value(); track test.id) {
        <details class="cycle-test-result"><summary><span class="dana-status-badge" [attr.data-tone]="test.result.passed ? 'success' : 'danger'">SIMULATION · {{ test.result.passed ? 'Pass' : 'Fail' }}</span> {{ test.serial_number }} · {{ test.created_at | date:'medium' }}</summary>
          <p>Machine {{ test.machine_id }} · Gearset {{ test.gearset_id }}</p>
          <ul>@for (issue of test.result.issues; track $index) { <li>{{ issue }}</li> }</ul>
          <dl>@for (macro of test.result.macros; track macro.number) { <dt>#{{ macro.number }} · {{ macro.name }}</dt><dd>{{ macro.value ?? 'Missing' }}</dd> }</dl>
        </details>
      } @empty { <p>{{ history.loading() ? 'Loading…' : 'No saved simulations yet.' }}</p> }
    </section>
  `,
  styles: `.cycle-test-result { padding:1rem 0; border-bottom:1px solid var(--dana-border); overflow-wrap:anywhere; } summary { cursor:pointer; } :host { display:grid; gap:1rem; }`,
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
