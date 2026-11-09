import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import {
  DanaConfirmDialogComponent,
  DanaTabDirective,
  DanaTableDirective,
  DanaTabsDirective,
} from '@dana/ui';
import { GearsetsApi, loadable, PartsApi, SummariesApi, ToastService } from '@gearapps/client/core';
import { EmptyStateComponent, StatusBadgeComponent } from '@gearapps/client/ui';
import { Gearset, Part, Summary } from '@gearapps/shared/domain';
import { Observable } from 'rxjs';
import { GearsetFormDialogComponent } from './gearset-form-dialog.component';
import { PartFormDialogComponent } from './part-form-dialog.component';
import { userName } from './shared';

type Tab = 'parts' | 'gearsets';

@Component({
  selector: 'gear-parts-page',
  imports: [
    DecimalPipe,
    DanaTableDirective,
    DanaTabsDirective,
    DanaTabDirective,
    DanaConfirmDialogComponent,
    StatusBadgeComponent,
    EmptyStateComponent,
    PartFormDialogComponent,
    GearsetFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dana-page-header">
      <div>
        <h1>Parts &amp; gearsets</h1>
        <p>Pinions and rings, and the gearsets built from them.</p>
      </div>
      <div class="dana-toolbar">
        <button type="button" class="dana-btn" (click)="reload()">Refresh</button>
        @if (tab() === 'parts') {
          <button type="button" class="dana-btn dana-btn-primary" (click)="openPart(null)">
            + Add part
          </button>
        } @else {
          <button type="button" class="dana-btn dana-btn-primary" (click)="openGearset(null)">
            + Add gearset
          </button>
        }
      </div>
    </div>

    <section class="dana-panel">
      <div class="dana-panel-header">
        <div class="dana-tabs" danaTabs role="tablist">
          <button
            danaTab
            role="tab"
            type="button"
            [active]="tab() === 'parts'"
            (click)="tab.set('parts')"
          >
            Parts <span class="dana-count-badge">{{ parts.value().length }}</span>
          </button>
          <button
            danaTab
            role="tab"
            type="button"
            [active]="tab() === 'gearsets'"
            (click)="tab.set('gearsets')"
          >
            Gearsets <span class="dana-count-badge">{{ gearsets.value().length }}</span>
          </button>
        </div>
      </div>

      @if (tab() === 'parts') {
        @if (!parts.loading() && !parts.value().length) {
          <div class="dana-panel-body">
            <gear-empty-state
              title="No parts yet"
              hint="Add pinions and rings, then combine them into gearsets."
            />
          </div>
        } @else {
          <div class="dana-table-shell is-sticky-head">
            <table danaTable class="dana-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Teeth</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th>Created by</th>
                  <th data-dana-table-static>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (p of parts.value(); track p.id) {
                  <tr>
                    <td>
                      <strong>{{ p.number }}</strong>
                    </td>
                    <td>{{ p.type }}</td>
                    <td>{{ p.teeth ?? '—' }}</td>
                    <td>
                      {{ p.summary?.number ?? '—' }}
                      @if (p.summary?.model) {
                        <span class="dana-cell-sub">{{ p.summary?.model }}</span>
                      }
                    </td>
                    <td><gear-status-badge [status]="p.status" /></td>
                    <td>{{ userName(p.user) }}</td>
                    <td>
                      <div class="dana-table-actions">
                        <button type="button" class="dana-btn dana-btn-sm" (click)="openPart(p)">
                          Edit
                        </button>
                        <button
                          type="button"
                          class="dana-btn dana-btn-sm dana-btn-danger"
                          (click)="askDelete('part', p)"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      } @else {
        @if (!gearsets.loading() && !gearsets.value().length) {
          <div class="dana-panel-body">
            <gear-empty-state
              title="No gearsets yet"
              hint="A gearset pairs a pinion with a ring; the ratio is calculated from their teeth."
            />
          </div>
        } @else {
          <div class="dana-table-shell is-sticky-head">
            <table danaTable class="dana-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Rev</th>
                  <th>Pinion</th>
                  <th>Ring</th>
                  <th>Ratio</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th data-dana-table-static>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (g of gearsets.value(); track g.id) {
                  <tr>
                    <td>
                      <strong>{{ g.number }}</strong>
                    </td>
                    <td>{{ g.rev || '—' }}</td>
                    <td>
                      {{ g.pinion?.number ?? '—' }}
                      @if (g.pinion?.teeth) {
                        <span class="dana-cell-sub">{{ g.pinion?.teeth }} teeth</span>
                      }
                    </td>
                    <td>
                      {{ g.ring?.number ?? '—' }}
                      @if (g.ring?.teeth) {
                        <span class="dana-cell-sub">{{ g.ring?.teeth }} teeth</span>
                      }
                    </td>
                    <td>
                      {{
                        g.ratio !== null && g.ratio !== undefined
                          ? (g.ratio | number: '1.2-4')
                          : '—'
                      }}
                    </td>
                    <td>{{ g.summary?.number ?? '—' }}</td>
                    <td><gear-status-badge [status]="g.status" /></td>
                    <td>
                      <div class="dana-table-actions">
                        <button type="button" class="dana-btn dana-btn-sm" (click)="openGearset(g)">
                          Edit
                        </button>
                        <button
                          type="button"
                          class="dana-btn dana-btn-sm dana-btn-danger"
                          (click)="askDelete('gearset', g)"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>

    <gear-part-form-dialog
      [(open)]="partDialog"
      [part]="editingPart()"
      [summaries]="summaries.value()"
      (saved)="onSaved('Part')"
    />
    <gear-gearset-form-dialog
      [(open)]="gearsetDialog"
      [gearset]="editingGearset()"
      [parts]="parts.value()"
      [summaries]="summaries.value()"
      (saved)="onSaved('Gearset')"
    />
    <dana-confirm-dialog
      [open]="!!pending()"
      [title]="'Delete ' + (pending()?.kind ?? '')"
      [message]="pending()?.message ?? ''"
      confirmLabel="Delete"
      [danger]="true"
      (confirm)="deleteConfirmed()"
      (cancel)="pending.set(null)"
    />
  `,
  styles: `
    .dana-panel-header .dana-tabs {
      border-bottom: 0;
    }
    .dana-tab .dana-count-badge {
      margin-left: 6px;
    }
  `,
})
export class PartsPageComponent implements OnInit {
  private readonly partsApi = inject(PartsApi);
  private readonly gearsetsApi = inject(GearsetsApi);
  private readonly summariesApi = inject(SummariesApi);
  private readonly toast = inject(ToastService);

  protected readonly parts = loadable<Part[]>([]);
  protected readonly gearsets = loadable<Gearset[]>([]);
  protected readonly summaries = loadable<Summary[]>([]);
  protected readonly tab = signal<Tab>('parts');
  protected readonly userName = userName;

  protected partDialog = false;
  protected gearsetDialog = false;
  protected readonly editingPart = signal<Part | null>(null);
  protected readonly editingGearset = signal<Gearset | null>(null);
  protected readonly pending = signal<{
    kind: string;
    message: string;
    run: () => Observable<void>;
  } | null>(null);
  protected readonly total = computed(
    () => this.parts.value().length + this.gearsets.value().length,
  );

  ngOnInit() {
    this.reload();
  }

  protected reload() {
    this.parts.load(this.partsApi.list());
    this.gearsets.load(this.gearsetsApi.list());
    this.summaries.load(this.summariesApi.list());
  }

  protected openPart(p: Part | null) {
    this.editingPart.set(p);
    this.partDialog = true;
  }
  protected openGearset(g: Gearset | null) {
    this.editingGearset.set(g);
    this.gearsetDialog = true;
  }
  protected onSaved(what: string) {
    this.toast.success(`${what} saved`);
    this.reload();
  }

  protected askDelete(kind: 'part' | 'gearset', item: Part | Gearset) {
    const message =
      kind === 'part'
        ? `Delete part ${item.number}? Gearsets that use it keep their reference.`
        : `Delete gearset ${item.number}? Cycle history that references it will be affected.`;
    const run = () =>
      kind === 'part' ? this.partsApi.delete(item.id) : this.gearsetsApi.delete(item.id);
    this.pending.set({ kind, message, run });
  }

  protected deleteConfirmed() {
    const p = this.pending();
    if (!p) return;
    this.pending.set(null);
    p.run().subscribe({
      next: () => {
        this.toast.success(`${p.kind[0].toUpperCase()}${p.kind.slice(1)} deleted`);
        this.reload();
      },
      error: (err) => this.toast.error(err, `Could not delete ${p.kind}`),
    });
  }
}
