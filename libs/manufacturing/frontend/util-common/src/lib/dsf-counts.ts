import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, Injectable, Input, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, map, of, shareReplay, switchMap, timer } from 'rxjs';
import { DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective } from '@dana/ui';

export interface MachineDsfCount {
  machine_id: string; machine_number: string; department: string; status: string;
  count: number | null; note: string; shift_number: number | null;
  shift_date: string | null; as_of: string | null;
}
export interface MachineDsfBoard { rows: MachineDsfCount[]; configured: boolean; last_success_at: string | null; }
@Injectable({ providedIn: 'root' })
export class MachineDsfService {
  private readonly http = inject(HttpClient);
  // One snapshot request per app, shared by every visible machine. No source reads from browsers.
  readonly board$ = timer(0, 30000).pipe(
    switchMap(() => this.http.get<MachineDsfBoard>('/api/v1/dsf-counts').pipe(
      map(board => ({ board, error: '' })),
      catchError(() => of({ board: null, error: 'DSF counts are unavailable. Retrying automatically.' })),
    )),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
}

@Component({
  selector: 'gear-machine-dsf-count', standalone: true, imports: [CommonModule],
  template: `@if (dsf.board$ | async; as state) {
    @if (row(state.board); as count) {
      <span class="dana-status-badge" [attr.data-tone]="count.status === 'OK' ? 'success' : count.status === 'INACTIVE' ? 'neutral' : 'warning'" [title]="count.note">
        DSF {{ count.count === null ? '—' : count.count }} · {{ count.status.replaceAll('_', ' ') }}
      </span>
      @if (count.shift_number !== null) { <small class="gear-muted">Shift {{ count.shift_number }} · {{ count.shift_date }} · As of {{ count.as_of | date:'shortTime' }}</small> }
    } @else { <span class="dana-status-badge" data-tone="neutral">DSF {{ state.error ? 'unavailable' : 'not configured' }}</span> }
  } @else { <span class="gear-muted">DSF loading…</span> }`,
})
export class MachineDsfCountComponent {
  readonly dsf = inject(MachineDsfService);
  @Input() machineId = '';
  row(board: MachineDsfBoard | null) { return board?.rows.find(row => row.machine_id === this.machineId); }
}

@Component({
  selector: 'gear-machine-counts', standalone: true,
  imports: [CommonModule, FormsModule, DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective],
  template: `<section class="gear-page space-y-5">
    <header class="gear-page-header" danaPageHeader heading="Machine DSF Counts" eyebrow="PRODUCTION" description="Current-shift counts for every machine. Configure each source in Admin → DSF Mappings."></header>
    <label class="gear-field">Find machine or department<input class="gear-input" [(ngModel)]="search" placeholder="Machine number or department" /></label>
    @if (dsf.board$ | async; as state) {
      @if (state.error) { <p role="alert">{{ state.error }}</p> }
      @if (state.board; as board) {
        @if (!board.configured) { <p role="status">DSF connection is not configured. Counts remain unavailable until connected.</p> }
        <p class="gear-muted">Last successful DSF read: {{ (board.last_success_at | date:'medium') || 'Waiting for connection' }} · Refreshes automatically</p>
        <div danaTableShell><table danaTable class="gear-table"><thead><tr><th>Machine</th><th>Department</th><th>DSF count</th><th>Shift</th><th>Status</th><th>As of</th></tr></thead><tbody>
          @for (row of filtered(board.rows); track row.machine_id) {
            <tr><td>{{ row.machine_number }}</td><td>{{ row.department }}</td><td>{{ row.count === null ? '—' : row.count }}</td><td>{{ row.shift_number ?? '—' }} · {{ row.shift_date || '—' }}</td>
            <td><span class="dana-status-badge" [attr.data-tone]="row.status === 'OK' ? 'success' : row.status === 'INACTIVE' ? 'neutral' : 'warning'">{{ row.status.replaceAll('_', ' ') }}</span><small class="block">{{ row.note }}</small></td><td>{{ (row.as_of | date:'short') || '—' }}</td></tr>
          } @empty { <tr><td colspan="6">No matching machines.</td></tr> }
        </tbody></table></div>
      }
    } @else { <p role="status">Loading DSF counts…</p> }
  </section>`,
})
export class MachineCountsComponent {
  readonly dsf = inject(MachineDsfService);
  search = '';
  filtered(rows: MachineDsfCount[]) { const q = this.search.trim().toLowerCase(); return rows.filter(row => `${row.machine_number} ${row.department}`.toLowerCase().includes(q)); }
}
