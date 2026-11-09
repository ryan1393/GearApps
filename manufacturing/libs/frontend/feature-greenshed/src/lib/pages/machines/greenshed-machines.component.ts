import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  GreenshedApiService,
  RunningMachineRow,
  RunningMachinesBoard,
  greenshedApiErrorText,
} from '@libs/frontend/data-access-greenshed';
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
    .machine-actions-dialog{border:1px solid #cbd5e1;border-radius:1rem;padding:1.5rem;margin:auto;width:min(28rem,calc(100vw - 2rem));max-height:calc(100dvh - 2rem);overflow:auto;color:#0f172a;background:white;box-shadow:0 1.5rem 4rem #0f172a40}
    .machine-actions-dialog::backdrop{background:#0f172a80}
    .machine-actions-dialog h2{margin:0 0 .4rem;font-size:1.35rem}
    .machine-actions-dialog p{margin:0 0 1rem;overflow-wrap:anywhere}
    .machine-actions-dialog .dialog-actions{display:grid;gap:.65rem}
    .machine-actions-dialog button{width:100%;min-height:2.75rem;text-align:left}
    .running-machines-page{max-width:100%!important;width:100%!important;min-width:0!important;box-sizing:border-box!important;margin:0!important;padding-left:.5rem!important;padding-right:.5rem!important}
    .running-machines-header{max-width:none!important}
    .running-machines-grid{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:.75rem!important;width:100%!important}
    .department-table{min-width:0!important;width:100%!important;overflow:visible!important}
    .department-table table,.department-table-inner{width:100%!important;min-width:0!important;table-layout:fixed!important;font-size:clamp(.68rem,.70vw,.82rem)!important}
    .department-table th,.department-table td,.department-table-inner th,.department-table-inner td{padding:.4rem .38rem!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    .department-table th,.department-table-inner th{font-size:clamp(.56rem,.55vw,.68rem)!important;letter-spacing:.02em!important}
    .department-table th:first-child,.department-table td:first-child,.department-table-inner th:first-child,.department-table-inner td:first-child{width:18%!important}
    .department-table .machine-cell button{width:100%!important;min-width:0!important}
    .running-machines-footer{font-size:.68rem!important;gap:.65rem!important;flex-wrap:wrap!important}
    @media(max-width:1150px){.running-machines-grid{grid-template-columns:1fr!important}.running-machines-page{width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important}}
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
    if (this.busy || this.r14Loading || this.r14Destroyed) return;
    this.r14Loading = true;
    const generation = this.r14Generation;
    const filter = this.activeFilter;
    this.api.getRunningMachines(filter).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (board) => {
        if (!this.r14Destroyed && !this.busy && this.r14Generation === generation && this.activeFilter === filter) this.applyBoard(board);
        this.r14Loading = false;
      },
      error: () => { this.r14Loading = false; },
    });
  }

  ngOnInit(): void {
    this.r14Timer = setInterval(() => this.refreshCounts(), 30000);
    this.refresh();
  }

  refresh(): void {
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
