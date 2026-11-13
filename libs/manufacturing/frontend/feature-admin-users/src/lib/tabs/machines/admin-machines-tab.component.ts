import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaToneDirective } from '@dana/ui';
import { MachineDsfCountComponent } from '@meshforge/manufacturing/frontend/util-common';

import { DepartmentRow, MachineRow } from '../../admin-api.service';
import { AdminFeedbackComponent } from '../../shared/admin-feedback.component';
import { AdminListStateComponent } from '../../shared/admin-list-state.component';
import { AdminTabBase } from '../../shared/admin-tab-base';

type MachineType = 'PRODUCTION' | 'CUTTER_BUILDER' | 'GRINDER';

/** Admin > Machines: production, Cutter Builder and grinder machines by department. */
@Component({
  selector: 'gear-admin-machines-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaToneDirective, MachineDsfCountComponent, AdminFeedbackComponent, AdminListStateComponent],
  templateUrl: './admin-machines-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
})
export class AdminMachinesTabComponent extends AdminTabBase implements OnInit {
  readonly machinesList = this.list<MachineRow[]>([]);
  readonly departmentsList = this.list<DepartmentRow[]>([]);
  get machines(): MachineRow[] { return this.machinesList.value(); }
  get departments(): DepartmentRow[] { return this.departmentsList.value(); }

  machineSearch = '';
  editingMachineId: string | null = null;
  machineForm: { machine_number: string; department_id: string; cell: number | null; description: string; machine_type: MachineType } = {
    machine_number: '', department_id: '', cell: null, description: '', machine_type: 'PRODUCTION',
  };

  ngOnInit(): void {
    this.choiceLists = { departments: this.departmentsList };
    this.loadMachines();
    this.loadDepartments();
  }

  retryChoices(): void { this.loadDepartments(); }

  loadMachines(): void { this.machinesList.load(this.api.listMachines()); }
  loadDepartments(): void { this.departmentsList.load(this.api.listDepartments()); }

  createMachine(): void {
    if (!this.machineForm.machine_number.trim() || !this.machineForm.department_id) {
      this.error = 'Machine number and department are required.'; return;
    }
    const payload = {
      machine_number: this.machineForm.machine_number.trim(), department_id: this.machineForm.department_id,
      cell: this.machineForm.cell, description: this.machineForm.description.trim() || null,
      machine_type: this.machineForm.machine_type,
    };
    const request = this.editingMachineId
      ? this.api.updateMachine(this.editingMachineId, payload)
      : this.api.createMachine({ ...payload, active: true });
    this.runSave(request, this.editingMachineId ? 'Machine updated.' : 'Machine created.', () => {
      this.resetMachineForm(); this.loadMachines();
    });
  }

  beginEditMachine(machine: MachineRow): void {
    this.editingMachineId = machine.id;
    this.machineForm = {
      machine_number: machine.machine_number, department_id: machine.department_id, cell: machine.cell,
      description: machine.description || '', machine_type: machine.machine_type === 'GRINDER' ? 'GRINDER' : machine.machine_type === 'CUTTER_BUILDER' ? 'CUTTER_BUILDER' : 'PRODUCTION',
    };
    this.clearNotice(); this.focusEditor();
  }

  cancelMachineEdit(): void { this.resetMachineForm(); this.clearNotice(); this.cdr.markForCheck(); }

  toggleMachineEnabled(machine: MachineRow, confirmed = false): void {
    const enabled = !machine.enabled;
    if (!enabled && !confirmed) { this.askDisable(`machine ${machine.machine_number}`, 'It can no longer be chosen for builds, counts or lapping until it is enabled again.', () => this.toggleMachineEnabled(machine, true)); return; }
    this.runSave(this.api.updateMachine(machine.id, { enabled, active: enabled }), `Machine ${machine.machine_number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadMachines());
  }

  get filteredMachines(): MachineRow[] {
    return this.machines.filter((machine) =>
      this.matches(this.machineSearch, [
        machine.machine_number,
        machine.department?.code,
        machine.department?.description,
        machine.cell,
        machine.description,
        machine.machine_type,
        machine.active ? 'active' : 'inactive',
        machine.enabled ? 'enabled' : 'disabled',
      ]),
    );
  }

  private resetMachineForm(): void {
    this.editingMachineId = null;
    this.machineForm = { machine_number: '', department_id: '', cell: null, description: '', machine_type: 'PRODUCTION' };
  }
}
