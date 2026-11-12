import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DanaKpiCardDirective, DanaKpiGridDirective, DanaTableDirective, DanaTableShellDirective } from '@dana/ui';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { timer } from 'rxjs';
import { csvCell, filterMachines, formatPlantTime, freshCount, machineCsv, rowLabel, shiftReports, cuttergrindCoverage, departmentLabel, plantDepartmentCoverage, REFERENCE_DEPARTMENTS } from '@meshforge/manufacturing/frontend/util-plant-dashboard';
import type { MachineCount } from '@meshforge/shared/domain';
import { PlantDashboardDataService } from '@meshforge/manufacturing/frontend/data-access-plant-dashboard';

@Component({
  selector: 'gear-plant-dashboard', standalone: true,
  styleUrls: ['./plant-layout.css'],
  imports: [CommonModule, FormsModule, DanaKpiCardDirective, DanaKpiGridDirective, DanaTableDirective, DanaTableShellDirective],
  templateUrl: './dashboard.component.html',
  providers: [PlantDashboardDataService],
})
export class DashboardComponent {
  private readonly data = inject(PlantDashboardDataService);
  private readonly session = inject(AuthSessionService);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  readonly board = this.data.board;
  readonly error = this.data.error;
  readonly loading = this.data.loading;
  readonly now = signal(Date.now());
  readonly department = signal('');
  readonly search = signal('');
  readonly attention = signal(false);
  readonly view = signal<'overview' | 'reports'>('overview');
  readonly formatTime = formatPlantTime;
  readonly departmentLabel = departmentLabel;
  readonly isAdmin = this.data.isAdmin;
  readonly mappingBoard = this.data.mappingBoard;
  readonly mappingError = this.data.mappingError;
  readonly cuttergrind = computed(() => cuttergrindCoverage(this.board()?.rows ?? [], this.mappingBoard(), this.now()));
  readonly referenceDepartmentCount = REFERENCE_DEPARTMENTS.length;
  readonly plantCoverage = computed(() => plantDepartmentCoverage(this.board()?.rows ?? [], this.mappingBoard(), this.now()));
  readonly departments = computed(() => this.plantCoverage().map(row => row.code));
  readonly rows = computed(() => {
    const board = this.board();
    return board ? filterMachines(board.rows, this.department(), this.search(), this.attention(), board, this.now()) : [];
  });
  readonly reporting = computed(() => this.rows().filter(row => this.count(row) !== null).length);
  readonly pieces = computed(() => this.reporting() ? this.rows().reduce((sum, row) => sum + (this.count(row) ?? 0), 0) : null);
  readonly reports = computed(() => {
    const board = this.board();
    return board ? shiftReports(this.rows(), board, this.now()) : [];
  });

  constructor() {
    timer(0, 15000).pipe(takeUntilDestroyed(this.destroy)).subscribe(() => this.now.set(Date.now()));
  }

  count(row: MachineCount): number | null {
    const board = this.board();
    return board ? freshCount(row, board, this.now()) : null;
  }

  label(row: MachineCount): string {
    const board = this.board();
    return board ? rowLabel(row, board, this.now()) : 'Unavailable';
  }

  refresh(): void { this.data.refresh(); }
  clearFilters(): void { this.department.set(''); this.search.set(''); this.attention.set(false); }
  showCuttergrind(): void { this.department.set('45'); this.search.set(''); this.attention.set(false); this.view.set('overview'); }
  logout(): void { this.session.logout(); void this.router.navigateByUrl('/login'); }
  print(): void { window.print(); }

  exportMachines(): void {
    const board = this.board();
    if (board) this.download(machineCsv(this.rows(), board, this.now()), 'machine-production');
  }

  exportDepartments(): void {
    const records = [['Department', 'Shift date', 'Shift', 'Shift start UTC', 'Shift end UTC', 'Registered machines',
      'Reporting machines', 'Reported RUN pieces', 'Coverage', 'Exported UTC'],
      ...this.reports().map(report => [report.department, report.date, report.shift, report.start, report.end,
        report.machines, report.reporting, report.pieces, report.reporting === report.machines ? 'Complete for registered group' : 'Partial',
        new Date(this.now()).toISOString()])];
    this.download(records.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'department-shift-production');
  }

  exportCoverage(): void {
    const records = [['Department', 'In supplied DSF reference', 'Registered machines', 'DSF source mappings',
      'Active sources without registered link', 'DSF catalog evidence', 'Exported UTC'],
      ...this.plantCoverage().map(row => [row.code, row.inReference ? 'Yes' : 'No', row.registered,
        row.sourceMappings, row.unlinkedActiveSources, row.sourceMappings === null ? 'Unverified' : 'Fresh source catalog; physical inventory unverified',
        new Date(this.now()).toISOString()])];
    this.download(records.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'plant-department-coverage');
  }

  private download(content: string, name: string): void {
    const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}-${new Date(this.now()).toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
