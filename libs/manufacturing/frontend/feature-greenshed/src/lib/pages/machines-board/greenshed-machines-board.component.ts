import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';
import { RunningMachineRow, RunningMachinesBoard } from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { DanaPageHeaderComponent, DanaStatusBadgeDirective } from '@dana/ui';
import { RunningMachinesFeed } from '../machines/running-machines-feed';
import { MachineAction, lastCheckKind, machineActionRoute, machineCheckStatus, sameRunOnBoard } from '../machines/running-machines.logic';

/**
 * Running Machines as large touch cards, one section per department. Same data, filter, refresh and
 * colour rules as the Running Machines table (/greenshed/machines), which stays as it is. Every
 * state is written out: no colour-only signals and no hover-only details.
 */
@Component({
  selector: 'gear-greenshed-machines-board',
  standalone: true,
  imports: [CommonModule, DanaPageHeaderComponent, DanaStatusBadgeDirective],
  templateUrl: './greenshed-machines-board.component.html',
  styleUrl: './greenshed-machines-board.component.css',
})
export class GreenshedMachinesBoardComponent extends RunningMachinesFeed {
  private readonly router = inject(Router);
  readonly filters = [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
    { value: 'ALL', label: 'All' },
  ] as const;
  readonly checkStatus = machineCheckStatus;
  readonly checkKind = lastCheckKind;

  /** The running cutter whose actions are open. */
  selectedMachine: RunningMachineRow | null = null;
  @ViewChild('machineActions', { static: true }) private machineActions?: ElementRef<HTMLDialogElement>;
  @ViewChild('closeActionsButton') private closeActionsButton?: ElementRef<HTMLButtonElement>;

  get filterLabel(): string {
    return this.filters.find((filter) => filter.value === this.activeFilter)?.label ?? 'All';
  }

  /** The current shift is still partial: counting began after it started. */
  get partialShift(): boolean {
    return Boolean(this.board?.current_shift && !this.board.current_shift.is_complete);
  }

  /** A machine card responds to a tap: a running cutter (its actions) or an active empty machine (setup). */
  actionable(machine: RunningMachineRow): boolean {
    return machine.has_cutter || machine.machine_active;
  }

  /** The same as clicking a machine on the table: actions for a running cutter, setup for an empty active machine. */
  openMachine(machine: RunningMachineRow): void {
    if (!machine.has_cutter) {
      if (machine.machine_active) this.go('setup', machine);
      return;
    }
    this.selectedMachine = { ...machine };
    const dialog = this.machineActions?.nativeElement;
    if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    setTimeout(() => {
      if (!this.r14Destroyed && this.machineActions?.nativeElement.open) this.closeActionsButton?.nativeElement.focus({ preventScroll: true });
    });
  }

  act(action: MachineAction, machine: RunningMachineRow): void {
    if (!machine.build_number) return;
    this.closeActions();
    this.go(action, machine);
  }

  closeActions(): void {
    const dialog = this.machineActions?.nativeElement;
    if (dialog?.open) dialog.close();
    this.selectedMachine = null;
  }

  closeFromBackdrop(event: MouseEvent): void {
    const dialog = this.machineActions?.nativeElement;
    if (!dialog || event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.closeActions();
  }

  protected override beforeRefresh(): void {
    this.closeActions();
  }

  /** A refreshed board closes the actions when that cutter is no longer on the same run. */
  protected override applyBoard(board: RunningMachinesBoard): void {
    super.applyBoard(board);
    const selected = this.selectedMachine;
    if (!selected) return;
    const current = sameRunOnBoard(board, selected);
    if (!current) this.closeActions();
    else this.selectedMachine = { ...current };
  }

  private go(action: MachineAction, machine: RunningMachineRow): void {
    const { commands, queryParams } = machineActionRoute(action, machine);
    void this.router.navigate(commands, { queryParams });
  }
}
