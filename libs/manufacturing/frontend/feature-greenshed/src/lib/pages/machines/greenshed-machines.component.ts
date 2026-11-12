import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  DsfCountRow,
  DsfCountsBoard,
  GreenshedApiService,
  RunningMachineRow,
  RunningMachinesBoard,
  greenshedApiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-greenshed';
import {
  DanaTableDirective,
  DanaTableShellDirective,
} from '@dana/ui';

@Component({
  selector: 'gear-greenshed-machines',
  standalone: true,
  imports: [CommonModule, DanaTableDirective, DanaTableShellDirective],
  templateUrl: './greenshed-machines.component.html',
  styles: [`
    :host{display:block}
    .machine-actions-dialog{margin:auto;width:min(28rem,calc(100vw - 2rem));max-height:calc(100dvh - 2rem);overflow:auto}
    .machine-actions-dialog p{overflow-wrap:anywhere}
    .machine-actions-dialog .dialog-actions{display:grid;gap:var(--dana-action-gap)}
    .machine-actions-dialog button{width:100%;text-align:left}
    /* DSF count: a seventh column. Re-share the widths the six-column board sets by position. */
    .running-machines-page.dsf-count-enabled .running-machine-table th:nth-child(1),
    .running-machines-page.dsf-count-enabled .running-machine-table td:nth-child(1){width:12%!important}
    .running-machines-page.dsf-count-enabled .running-machine-table th:nth-child(2),
    .running-machines-page.dsf-count-enabled .running-machine-table td:nth-child(2){width:27%!important}
    .running-machines-page.dsf-count-enabled .running-machine-table th:nth-child(3),
    .running-machines-page.dsf-count-enabled .running-machine-table td:nth-child(3){width:16%!important}
    .running-machines-page.dsf-count-enabled .running-machine-table th:nth-child(4),
    .running-machines-page.dsf-count-enabled .running-machine-table td:nth-child(4),
    .running-machines-page.dsf-count-enabled .running-machine-table th:nth-child(5),
    .running-machines-page.dsf-count-enabled .running-machine-table td:nth-child(5),
    .running-machines-page.dsf-count-enabled .running-machine-table th.dsf-count-col,
    .running-machines-page.dsf-count-enabled .running-machine-table td.dsf-count-cell{width:9%!important}
    .running-machines-page.dsf-count-enabled .running-machine-table th.machine-check-col,
    .running-machines-page.dsf-count-enabled .running-machine-table td.machine-check-cell{width:18%!important}
    .running-machines-page.dsf-count-enabled .running-machine-table .dsf-count-cell{white-space:normal!important;text-align:center!important;vertical-align:middle!important}
    .dsf-count-value{display:block}
    .dsf-count-state{display:block;margin-top:var(--dana-space-1);white-space:normal;overflow-wrap:anywhere}
  `],
})
export class GreenshedMachinesComponent implements OnInit, OnDestroy {
  private readonly api = inject(GreenshedApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  board: RunningMachinesBoard | null = null;
  activeFilter: 'ALL' | 'ACTIVE' | 'INACTIVE' = 'ACTIVE';
  busy = false;
  error = '';
  actionMachine: string | null = null;
  selectedMachine: RunningMachineRow | null = null;
  @ViewChild('machineActions', { static: true }) private machineActions!: ElementRef<HTMLDialogElement>;
  @ViewChild('closeActionsButton') private closeActionsButton?: ElementRef<HTMLButtonElement>;

  // DSF (Digital Shop Floor) counts. Read from the API's own snapshot endpoint; the column only
  // appears when the API has a DSF reader configured, and it never changes the existing counters.
  dsfBoard: DsfCountsBoard | null = null;
  dsfTransportFailed = false;
  private dsfLoading = false;
  private dsfRows = new Map<string, DsfCountRow>();

  get dsfShown(): boolean { return this.dsfBoard?.configured === true; }

  private refreshDsf(): void {
    if (this.dsfLoading || this.r14Destroyed) return;
    this.dsfLoading = true;
    this.api.getDsfCounts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (value) => {
        if (!this.r14Destroyed && value?.format === 'DSFCOUNT1' && Array.isArray(value.rows)) {
          this.dsfBoard = value;
          this.dsfRows = new Map(value.rows.map((row) => [row.machine_id, row]));
          this.dsfTransportFailed = false;
        }
        this.dsfLoading = false;
      },
      // Keep the last snapshot on screen, marked stale, rather than blanking the column.
      error: () => { this.dsfLoading = false; this.dsfTransportFailed = true; },
    });
  }

  dsfCell(machine: RunningMachineRow): { value: number | null; label: string; title: string; warning: boolean } {
    const r = this.dsfRows.get(machine.machine_id);
    if (!r) {
      const label = this.dsfTransportFailed ? 'Unavailable' : this.dsfBoard?.status === 'UNAVAILABLE' ? 'Unavailable' :
        this.dsfBoard?.status === 'WAITING' ? 'Waiting' : 'Not mapped';
      return { value: null, label, title: 'No DSF source is mapped to this machine.', warning: this.dsfTransportFailed };
    }
    const expired = !!r.shift_end && Date.now() >= Date.parse(r.shift_end);
    const stale = this.dsfTransportFailed || r.status === 'STALE' ||
      (!!r.refreshed_at && Date.now() - Date.parse(r.refreshed_at) > ((this.dsfBoard?.interval_seconds || 300) * 2 + 30) * 1000);
    const labels: Record<string, string> = { NOT_CONFIGURED: 'Not enabled', WAITING: 'Waiting',
      MAPPING_REVIEW: 'Mapping review', SHIFT_REVIEW: 'Shift review', DATA_REVIEW: 'Data review',
      INACTIVE: 'Inactive', UNAVAILABLE: 'Unavailable' };
    const usable = !expired && r.count != null && ['OK', 'STALE', 'UNAVAILABLE'].includes(r.status);
    const label = expired && ['OK', 'STALE', 'UNAVAILABLE'].includes(r.status) ? 'New shift pending' :
      usable && stale ? 'Stale' : usable ? 'Shift ' + r.shift_number : (labels[r.status] || 'Unavailable');
    const at = r.as_of ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Indiana/Indianapolis',
      month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(r.as_of)) + ' ET' : 'No verified count';
    return { value: usable ? r.count : null, label,
      title: 'DSF machine total for the current shift. ' + (r.shift_date || '') + ' | Counted through ' + at + ' | ' + r.note,
      warning: stale || ['MAPPING_REVIEW', 'SHIFT_REVIEW', 'DATA_REVIEW', 'UNAVAILABLE'].includes(r.status) };
  }

  // DANA-R61R14-COUNT-REFRESH
  private r14Timer: ReturnType<typeof setInterval> | null = null;
  private r14Loading = false;
  private r14Destroyed = false;
  private r14Generation = 0;

  ngOnDestroy(): void {
    this.r14Destroyed = true;
    this.r14Generation++;
    if (this.r14Timer !== null) clearInterval(this.r14Timer);
  }

  private refreshCounts(): void {
    this.refreshDsf();
    if (this.busy || this.r14Loading || this.r14Destroyed) return;
    this.r14Loading = true;
    const generation = this.r14Generation;
    const filter = this.activeFilter;
    this.api.getRunningMachines(filter).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (board) => {
        if (!this.r14Destroyed && !this.busy && this.r14Generation === generation && this.activeFilter === filter) {
          this.applyBoard(board);
          // A live board replaces any earlier load or refresh failure message.
          this.error = '';
        }
        this.r14Loading = false;
      },
      error: () => {
        this.r14Loading = false;
        // Do not let the board go quietly stale: say that what is shown is the last good refresh.
        if (!this.r14Destroyed && !this.busy && this.r14Generation === generation && this.board) {
          this.error = 'Could not refresh Running Machines. Showing the last refreshed board; it will retry automatically.';
        }
      },
    });
  }

  ngOnInit(): void {
    this.r14Timer = setInterval(() => this.refreshCounts(), 30000);
    this.refresh();
  }

  refresh(): void {
    this.refreshDsf();
    const generation = ++this.r14Generation;
    const filter = this.activeFilter;
    this.busy = true;
    this.error = '';
    this.closeActions();

    this.api.getRunningMachines(filter).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (board) => {
        if (this.r14Destroyed || generation !== this.r14Generation || filter !== this.activeFilter) return;
        this.applyBoard(board);
        this.busy = false;
      },
      error: (err: HttpErrorResponse) => {
        if (this.r14Destroyed || generation !== this.r14Generation || filter !== this.activeFilter) return;
        this.busy = false;
        this.error = greenshedApiErrorText(
          err,
          'Could not load Running Machines.',
        );
      },
    });
  }

  /** A failed or held check is not a completed quality check, however recently it was recorded. */
  checkNeedsAttention(machine: RunningMachineRow): boolean {
    return machine.last_check_code !== 'CS' && ['FAIL', 'HOLD'].includes(String(machine.last_check_result ?? '').toUpperCase());
  }

  private applyBoard(board: RunningMachinesBoard): void {
    this.board = board;
    if (!this.selectedMachine) return;
    const current = board.departments.flatMap(department => department.machines).find(machine => machine.machine_id === this.selectedMachine?.machine_id);
    if (!current || !current.has_cutter || current.run_id !== this.selectedMachine.run_id || current.build_number !== this.selectedMachine.build_number) this.closeActions();
    else this.selectedMachine = { ...current };
  }

  setActiveFilter(value: 'ALL' | 'ACTIVE' | 'INACTIVE'): void {
    if (this.activeFilter === value) return;
    this.activeFilter = value;
    this.refresh();
  }

  sortedMachines(machines: RunningMachineRow[]): RunningMachineRow[] {
    return [...machines].sort((a, b) => {
      if (a.cell == null && b.cell != null) return 1;
      if (a.cell != null && b.cell == null) return -1;
      if (a.cell != null && b.cell != null && a.cell !== b.cell) return a.cell - b.cell;
      return a.machine_number.localeCompare(b.machine_number, undefined, { numeric: true });
    });
  }

  toggleActions(machine: RunningMachineRow): void {
    if (!machine.has_cutter) {
      if (!machine.machine_active) return;
      void this.router.navigate(['/greenshed/setup'], {
        queryParams: { machine: machine.machine_number, origin: 'running-machines' },
      });
      return;
    }

    this.actionMachine = machine.machine_number;
    this.selectedMachine = { ...machine };
    this.machineActions.nativeElement.showModal();
    setTimeout(() => {
      if (!this.r14Destroyed && this.machineActions.nativeElement.open) {
        this.closeActionsButton?.nativeElement.focus({ preventScroll: true });
      }
    });
  }

  closeActions(): void {
    this.machineActions?.nativeElement.close();
    this.actionMachine = null;
    this.selectedMachine = null;
  }

  closeFromBackdrop(event: MouseEvent): void {
    if (event.target !== this.machineActions.nativeElement) return;
    const rect = this.machineActions.nativeElement.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.closeActions();
  }

  frequencyCheck(machine: RunningMachineRow): void {
    if (!machine.build_number) return;
    this.closeActions();
    void this.router.navigate(['/greenshed/check'], {
      queryParams: { build: machine.build_number, machine: machine.machine_number, run: machine.run_id, type: 'FC', origin: 'running-machines' },
    });
  }

  cmmCheck(machine: RunningMachineRow): void {
    if (!machine.build_number) return;
    this.closeActions();
    void this.router.navigate(['/greenshed/check'], {
      queryParams: { build: machine.build_number, machine: machine.machine_number, run: machine.run_id, type: 'CMM', origin: 'running-machines' },
    });
  }

  changeover(machine: RunningMachineRow): void {
    if (!machine.build_number) return;
    this.closeActions();
    void this.router.navigate(['/greenshed/pull'], {
      queryParams: {
        build: machine.build_number,
        reason: 'CHANGEOVER',
        machine: machine.machine_number, run: machine.run_id, origin: 'running-machines',
      },
    });
  }

  deathCertificate(machine: RunningMachineRow): void {
    if (!machine.build_number) return;
    this.closeActions();
    void this.router.navigate(['/greenshed/pull'], {
      queryParams: { build: machine.build_number, machine: machine.machine_number, run: machine.run_id, origin: 'running-machines' },
    });
  }

  setupMachine(machine: RunningMachineRow): void {
    void this.router.navigate(['/greenshed/setup'], {
      queryParams: { machine: machine.machine_number, origin: 'running-machines' },
    });
  }

  openBuild(machine: RunningMachineRow): void {
    if (!machine.build_number) return;
    void this.router.navigate(['/greenshed/lookup'], {
      queryParams: { build: machine.build_number },
    });
  }
}
