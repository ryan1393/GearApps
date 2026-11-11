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
import { RouterLink } from '@angular/router';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import {
  DanaConfirmDialogComponent,
  DanaCountBadgeDirective,
  DanaPageHeaderComponent,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';
import {
  CollectorApi,
  CollectorMachine,
  CollectorStatus,
  FanucVariablesApi,
  LapperAccess,
  loadable,
  MachinesApi,
  ToastService,
} from '@meshforge/client/core';
import { StatusBadgeComponent } from '@meshforge/client/ui';
import { Machine, MachineFanucVariable } from '@meshforge/shared/domain';
import { FanucFormDialogComponent } from './fanuc-form-dialog.component';
import { FANUC_SIGNALS } from './options';

interface FanucRow {
  machine: Machine;
  snapshot: MachineFanucVariable | null;
}

@Component({
  selector: 'gear-fanuc-variables-page',
  imports: [
    RouterLink,
    DanaConfirmDialogComponent,
    DanaCountBadgeDirective,
    DanaPageHeaderComponent,
    DanaTableDirective,
    DanaTableEmptyDirective,
    DanaTableShellDirective,
    StatusBadgeComponent,
    FanucFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .lapper-collector-detail {
      margin-top: 4px;
      font-size: 12px;
    }
  `,
  template: `
    <div class="gear-page gear-workflow-page">
      <section
        danaPageHeader
        eyebrow="LAPPER / CONFIGURATION"
        heading="Fanuc Variables"
        description="Each Active lapper with a FANUC controller IP gets a Lapper Read worker automatically (without an online scanner, its cycles are recorded without a serial). These are the signals it reports."
      >
        <div danaPageHeaderAction class="dana-toolbar">
          <button
            type="button"
            class="gear-btn gear-btn-secondary"
            (click)="reload()"
            [disabled]="loading()"
           data-icon="refresh" title="Refresh">
            ↻ {{ loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>
      </section>

      <section class="gear-workflow-table-panel">
        <div class="gear-workflow-table-heading gear-workflow-status-row">
          <div>
            <h2>Machine I/O</h2>
            <p>
              {{ workerCount() }} workers running · {{ withSnapshot() }} of
              {{ rows().length }} machines report signals · {{ inCycle() }} in cycle now.
            </p>
            @if (collectorOffline()) {
              <p class="gear-muted">
                Collector status unavailable. Start it with
                <code>docker compose --profile collectors up -d lapper-read</code>.
              </p>
            }
          </div>
          <span danaCountBadge class="gear-count-badge count-chip">{{ rows().length }}</span>
        </div>
        <div danaTableShell class="table-wrap">
          <table danaTable class="gear-table">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Cell</th>
                <th>Collector</th>
                <th>Scanner</th>
                @for (s of signals; track s.key) {
                  <th [attr.title]="s.label">{{ s.short }} {{ s.address }}</th>
                }
                <th data-dana-table-static aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.machine.id) {
                <tr>
                  <td class="mono strong nowrap">{{ r.machine.number || r.machine.ip }}</td>
                  <td>
                    @if (r.machine.cell) {
                      <a [routerLink]="['/dashboard/cell', r.machine.cell]"
                        >Cell {{ r.machine.cell }}</a
                      >
                    } @else {
                      —
                    }
                  </td>
                  <td class="nowrap">
                    @if (collectorFor(r.machine.id); as c) {
                      <gear-status-badge [tone]="c.tone" [text]="c.label" />
                      @if (c.detail) {
                        <div class="gear-muted lapper-collector-detail">{{ c.detail }}</div>
                      }
                    } @else {
                      <span class="gear-muted">—</span>
                    }
                  </td>
                  <td class="nowrap">
                    @if (scannerFor(r.machine.id); as sc) {
                      <gear-status-badge [tone]="sc.tone" [text]="sc.label" />
                      @if (sc.detail) {
                        <div class="gear-muted lapper-collector-detail">{{ sc.detail }}</div>
                      }
                    } @else {
                      <span class="gear-muted">—</span>
                    }
                  </td>
                  @for (s of signals; track s.key) {
                    <td>
                      @if (r.snapshot) {
                        <gear-status-badge
                          [tone]="r.snapshot[s.key] ? 'success' : 'neutral'"
                          [text]="r.snapshot[s.key] ? 'ON' : 'OFF'"
                        />
                      } @else {
                        <span class="gear-muted">No signal</span>
                      }
                    </td>
                  }
                  <td class="right">
                    @if (access.canEditSetup()) {
                      <div class="gear-actions">
                        <button
                          type="button"
                          class="gear-btn gear-btn-secondary gear-btn-sm"
                          (click)="openDialog(r)"
                        >
                          {{ r.snapshot ? 'Edit' : 'Set up' }}
                        </button>
                        @if (r.snapshot) {
                          <button
                            type="button"
                            class="gear-btn gear-btn-danger gear-btn-sm"
                            (click)="pendingDelete.set(r)"
                          >
                            Reset
                          </button>
                        }
                      </div>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td danaTableEmpty colspan="8" class="empty-row">
                    {{ loading() ? 'Loading machines…' : 'No machines configured yet.' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <gear-fanuc-form-dialog
      [(open)]="dialogOpen"
      [machine]="editing()?.machine ?? null"
      [snapshot]="editing()?.snapshot ?? null"
      (saved)="onSaved()"
    />
    <dana-confirm-dialog
      [open]="!!pendingDelete()"
      title="Reset Fanuc I/O"
      [message]="
        'Remove the I/O snapshot for ' +
        (pendingDelete()?.machine?.number ?? '') +
        '? The collector creates a new one the next time the machine reports.'
      "
      confirmLabel="Reset"
      [danger]="true"
      (confirm)="deleteConfirmed()"
      (cancel)="pendingDelete.set(null)"
    />
  `,
})
export class FanucVariablesPageComponent implements OnInit {
  private readonly api = inject(FanucVariablesApi);
  private readonly machinesApi = inject(MachinesApi);
  private readonly toast = inject(ToastService);
  private readonly collectorApi = inject(CollectorApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly access = inject(LapperAccess);
  protected readonly signals = FANUC_SIGNALS;

  /** null = the collector couldn't be reached. */
  protected readonly collector = signal<CollectorStatus | null | undefined>(undefined);
  protected readonly collectorOffline = computed(() => this.collector() === null);
  protected readonly workerCount = computed(
    () => this.collector()?.machines.filter((m) => m.worker).length ?? 0,
  );

  protected readonly machines = loadable<Machine[]>([]);
  protected readonly snapshots = loadable<MachineFanucVariable[]>([]);
  protected readonly loading = computed(() => this.machines.loading() || this.snapshots.loading());
  protected readonly rows = computed<FanucRow[]>(() =>
    [...this.machines.value()]
      .sort((a, b) => (a.number ?? a.ip).localeCompare(b.number ?? b.ip))
      .map((machine) => ({
        machine,
        snapshot: this.snapshots.value().find((s) => s.machine_id === machine.id) ?? null,
      })),
  );
  protected readonly withSnapshot = computed(() => this.rows().filter((r) => r.snapshot).length);
  protected readonly inCycle = computed(
    () => this.rows().filter((r) => r.snapshot?.y03_2_stack_inCycle).length,
  );

  protected dialogOpen = false;
  protected readonly editing = signal<FanucRow | null>(null);
  protected readonly pendingDelete = signal<FanucRow | null>(null);

  ngOnInit() {
    this.reload();
    // Worker status and signals change on their own; refresh while the page is open.
    interval(10_000)
      .pipe(
        startWith(0),
        switchMap(() => this.collectorApi.status().pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((status) => this.collector.set(status));
    interval(10_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.snapshots.load(this.api.list()));
  }

  protected collectorFor(
    machineId: string,
  ): { tone: 'success' | 'warning' | 'neutral'; label: string; detail: string } | null {
    const status = this.collector();
    if (!status) return null;
    const m: CollectorMachine | undefined = status.machines.find((x) => x.machine_id === machineId);
    if (!m)
      return {
        tone: 'neutral',
        label: 'Not seen yet',
        detail: 'Waiting for the next machine check',
      };
    if (!m.worker)
      return { tone: 'neutral', label: 'No worker', detail: capitalise(m.phase ?? '') };
    if (m.phase === 'no gearset loaded')
      return {
        tone: 'neutral',
        label: 'No gearset loaded',
        detail: `Connected and idle · checked ${clock(m.last_sample_at)} · collects once a program is loaded`,
      };
    if (m.phase === 'collecting') {
      const waiting = m.pending_runs ? ` · ${m.pending_runs} runs waiting to send` : '';
      return {
        tone: 'success',
        label: 'Collecting',
        detail: `Read ${clock(m.last_sample_at)}${waiting}`,
      };
    }
    return {
      tone: 'warning',
      label: capitalise(m.phase ?? 'Starting'),
      detail: m.last_sample_at ? `Last read ${clock(m.last_sample_at)}` : '',
    };
  }

  /** Scanner state reported by the collector; cycles are recorded either way, with or without a serial. */
  protected scannerFor(
    machineId: string,
  ): { tone: 'success' | 'warning' | 'neutral'; label: string; detail: string } | null {
    const m = this.collector()?.machines.find((x) => x.machine_id === machineId);
    if (!m?.worker || !m.scanner) return null;
    if (m.scanner === 'none')
      return { tone: 'neutral', label: 'No scanner', detail: 'Cycles recorded without a serial' };
    if (m.scanner === 'online')
      return { tone: 'success', label: 'Online', detail: 'Cycles get the scanned serial' };
    const ping =
      m.scanner_ping === 'answers'
        ? 'Answers ping, but its port is closed'
        : m.scanner_ping === 'no answer'
          ? 'No answer to ping'
          : 'Not reachable';
    const seen = m.scanner_last_seen ? ` · last seen ${clock(m.scanner_last_seen)}` : '';
    return {
      tone: 'warning',
      label: 'Offline',
      detail: `${ping}${seen} · cycles recorded without a serial`,
    };
  }

  protected reload() {
    this.machines.load(this.machinesApi.list());
    this.snapshots.load(this.api.list());
  }

  protected openDialog(r: FanucRow) {
    this.editing.set(r);
    this.dialogOpen = true;
  }

  protected onSaved() {
    this.toast.success('Fanuc I/O saved', this.editing()?.machine.number ?? '');
    this.reload();
  }

  protected deleteConfirmed() {
    const r = this.pendingDelete();
    if (!r?.snapshot) return;
    this.pendingDelete.set(null);
    this.api.delete(r.snapshot.id).subscribe({
      next: () => {
        this.toast.success('Fanuc I/O reset', r.machine.number ?? '');
        this.reload();
      },
      error: (err) => this.toast.error(err, 'Could not reset Fanuc I/O'),
    });
  }
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function clock(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleTimeString() : 'never';
}
