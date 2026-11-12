import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';

import {
  RunningMachineRow,
  RunningMachinesBoard,
} from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { RunningMachinesFeed } from './running-machines-feed';
import { MachineAction, machineActionRoute } from './running-machines.logic';
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
export class GreenshedMachinesComponent extends RunningMachinesFeed {
  private readonly router = inject(Router);

  actionMachine: string | null = null;
  selectedMachine: RunningMachineRow | null = null;
  @ViewChild('machineActions', { static: true }) private machineActions!: ElementRef<HTMLDialogElement>;
  @ViewChild('closeActionsButton') private closeActionsButton?: ElementRef<HTMLButtonElement>;

  protected override beforeRefresh(): void {
    this.closeActions();
  }

  protected override applyBoard(board: RunningMachinesBoard): void {
    super.applyBoard(board);
    if (!this.selectedMachine) return;
    const current = board.departments.flatMap(department => department.machines).find(machine => machine.machine_id === this.selectedMachine?.machine_id);
    if (!current || !current.has_cutter || current.run_id !== this.selectedMachine.run_id || current.build_number !== this.selectedMachine.build_number) this.closeActions();
    else this.selectedMachine = { ...current };
  }

  toggleActions(machine: RunningMachineRow): void {
    if (!machine.has_cutter) {
      if (!machine.machine_active) return;
      this.go('setup', machine);
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
    this.go('frequency', machine);
  }

  cmmCheck(machine: RunningMachineRow): void {
    if (!machine.build_number) return;
    this.closeActions();
    this.go('cmm', machine);
  }

  changeover(machine: RunningMachineRow): void {
    if (!machine.build_number) return;
    this.closeActions();
    this.go('changeover', machine);
  }

  deathCertificate(machine: RunningMachineRow): void {
    if (!machine.build_number) return;
    this.closeActions();
    this.go('death-certificate', machine);
  }

  setupMachine(machine: RunningMachineRow): void {
    this.go('setup', machine);
  }

  openBuild(machine: RunningMachineRow): void {
    if (!machine.build_number) return;
    this.go('lookup', machine);
  }

  private go(action: MachineAction, machine: RunningMachineRow): void {
    const { commands, queryParams } = machineActionRoute(action, machine);
    void this.router.navigate(commands, { queryParams });
  }
}
