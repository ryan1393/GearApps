import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Directive, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DsfCountRow,
  DsfCountsBoard,
  GreenshedApiService,
  RunningMachineRow,
  RunningMachinesBoard,
  greenshedApiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { DsfCountCell, checkNeedsAttention, dsfCountCell, sortRunningMachines } from './running-machines.logic';

/**
 * The live data behind both Running Machines screens: the board for the Active / Inactive / All
 * filter, a quiet count refresh every 30 seconds, and the DSF count snapshot. Each screen extends it
 * and only lays the machines out.
 */
@Directive()
export abstract class RunningMachinesFeed implements OnInit, OnDestroy {
  protected readonly api = inject(GreenshedApiService);
  protected readonly destroyRef = inject(DestroyRef);

  board: RunningMachinesBoard | null = null;
  activeFilter: 'ALL' | 'ACTIVE' | 'INACTIVE' = 'ACTIVE';
  busy = false;
  error = '';

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

  dsfCell(machine: RunningMachineRow): DsfCountCell {
    return dsfCountCell(this.dsfRows.get(machine.machine_id), this.dsfBoard, this.dsfTransportFailed);
  }

  // DANA-R61R14-COUNT-REFRESH
  private r14Timer: ReturnType<typeof setInterval> | null = null;
  private r14Loading = false;
  protected r14Destroyed = false;
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
    this.beforeRefresh();

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

  setActiveFilter(value: 'ALL' | 'ACTIVE' | 'INACTIVE'): void {
    if (this.activeFilter === value) return;
    this.activeFilter = value;
    this.refresh();
  }

  /** A failed or held check is not a completed quality check, however recently it was recorded. */
  checkNeedsAttention(machine: RunningMachineRow): boolean {
    return checkNeedsAttention(machine);
  }

  sortedMachines(machines: RunningMachineRow[]): RunningMachineRow[] {
    return sortRunningMachines(machines);
  }

  /** A manual refresh starts: e.g. close a machine's actions, whose run may have changed. */
  protected beforeRefresh(): void {
    // Nothing by default.
  }

  /** A new board arrived, from a manual refresh or the timed count refresh. */
  protected applyBoard(board: RunningMachinesBoard): void {
    this.board = board;
  }
}
