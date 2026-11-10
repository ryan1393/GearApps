import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DanaConfirmDialogComponent,
  DanaCountBadgeDirective,
  DanaPageHeaderComponent,
  DanaPanelHeaderDirective,
  DanaTabDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
  DanaTabsDirective,
} from '@dana/ui';
import {
  LapperAccess,
  GearsetsApi,
  loadable,
  PartsApi,
  SummariesApi,
  ToastService,
} from '@gearapps/client/core';
import { StatusBadgeComponent } from '@gearapps/client/ui';
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
    RouterLink,
    DanaConfirmDialogComponent,
    DanaCountBadgeDirective,
    DanaPageHeaderComponent,
    DanaPanelHeaderDirective,
    DanaTabDirective,
    DanaTableDirective,
    DanaTableEmptyDirective,
    DanaTableShellDirective,
    DanaTabsDirective,
    StatusBadgeComponent,
    PartFormDialogComponent,
    GearsetFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-page">
      <section
        danaPageHeader
        eyebrow="LAPPER / REFERENCE"
        heading="Parts & Gearsets"
        description="Pinions and rings, and the gearsets they are paired into for lapping."
      >
        <div danaPageHeaderAction class="dana-toolbar">
          <button
            type="button"
            class="gear-btn gear-btn-secondary"
            (click)="reload()"
            [disabled]="loading()"
          >
            ↻ {{ loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
          @if (tab() === 'parts') {
            @if (access.canEditSetup()) {
              <button type="button" class="gear-btn gear-btn-primary" (click)="openPart(null)">
                + Add part
              </button>
            }
          } @else {
            @if (access.canEditSetup()) {
              <button type="button" class="gear-btn gear-btn-primary" (click)="openGearset(null)">
                + Add gearset
              </button>
            }
          }
        </div>
      </section>

      <section class="gear-panel data-panel">
        <div danaPanelHeader class="gear-panel-header gear-panel-heading panel-heading panel-row">
          <div danaTabs aria-label="Parts and gearsets">
            <button danaTab type="button" [active]="tab() === 'parts'" (click)="tab.set('parts')">
              Parts
              <span danaCountBadge class="gear-count-badge count-chip">{{
                parts.value().length
              }}</span>
            </button>
            <button
              danaTab
              type="button"
              [active]="tab() === 'gearsets'"
              (click)="tab.set('gearsets')"
            >
              Gearsets
              <span danaCountBadge class="gear-count-badge count-chip">{{
                gearsets.value().length
              }}</span>
            </button>
          </div>
        </div>

        @if (tab() === 'parts') {
          <div danaTableShell class="table-wrap">
            <table danaTable class="gear-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Teeth</th>
                  <th>Summary</th>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Created by</th>
                  <th data-dana-table-static aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                @for (p of parts.value(); track p.id) {
                  <tr>
                    <td class="mono strong">{{ p.number }}</td>
                    <td>{{ p.type }}</td>
                    <td>{{ p.teeth ?? '—' }}</td>
                    <td class="mono">{{ p.summary?.number ?? '—' }}</td>
                    <td>{{ p.summary?.model || '—' }}</td>
                    <td><gear-status-badge [status]="p.status" /></td>
                    <td>{{ userName(p.user) }}</td>
                    <td class="right">
                      @if (access.canEditSetup()) {
                        <div class="gear-actions">
                          <button
                            type="button"
                            class="gear-btn gear-btn-secondary gear-btn-sm"
                            (click)="openPart(p)"
                            [attr.aria-label]="'Edit ' + p.number"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            class="gear-btn gear-btn-danger gear-btn-sm"
                            (click)="askDelete('part', p)"
                            [attr.aria-label]="'Delete ' + p.number"
                          >
                            Delete
                          </button>
                        </div>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td danaTableEmpty colspan="8" class="empty-row">
                      {{
                        parts.loading()
                          ? 'Loading parts…'
                          : 'No parts yet. Add pinions and rings, then pair them into gearsets.'
                      }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <div danaTableShell class="table-wrap">
            <table danaTable class="gear-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Rev</th>
                  <th>Pinion / Ring</th>
                  <th>Ratio</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th data-dana-table-static aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                @for (g of gearsets.value(); track g.id) {
                  <tr>
                    <td class="mono strong">{{ g.number }}</td>
                    <td>{{ g.rev || '—' }}</td>
                    <td class="mono nowrap">
                      {{ g.pinion?.number ?? '—' }} / {{ g.ring?.number ?? '—' }}
                    </td>
                    <td class="nowrap">
                      {{
                        g.ratio !== null && g.ratio !== undefined
                          ? (g.ratio | number: '1.2-4')
                          : '—'
                      }}
                      @if (g.pinion?.teeth && g.ring?.teeth) {
                        <span class="gear-muted">({{ g.ring?.teeth }}:{{ g.pinion?.teeth }})</span>
                      }
                    </td>
                    <td class="mono">{{ g.summary?.number ?? '—' }}</td>
                    <td><gear-status-badge [status]="g.status" /></td>
                    <td class="right">
                      <div class="gear-actions">
                        <a
                          class="gear-btn gear-btn-secondary gear-btn-sm"
                          routerLink="/lapping-summaries"
                          [queryParams]="{ gearset: g.id }"
                          [attr.aria-label]="'Lapping summary for ' + g.number"
                          >Summary</a
                        >
                        @if (access.canEditSetup()) {
                          <button
                            type="button"
                            class="gear-btn gear-btn-secondary gear-btn-sm"
                            (click)="openGearset(g)"
                            [attr.aria-label]="'Edit ' + g.number"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            class="gear-btn gear-btn-danger gear-btn-sm"
                            (click)="askDelete('gearset', g)"
                            [attr.aria-label]="'Delete ' + g.number"
                          >
                            Delete
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td danaTableEmpty colspan="7" class="empty-row">
                      {{
                        gearsets.loading()
                          ? 'Loading gearsets…'
                          : 'No gearsets yet. A gearset pairs a pinion with a ring from the same summary.'
                      }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>

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
})
export class PartsPageComponent implements OnInit {
  private readonly partsApi = inject(PartsApi);
  private readonly gearsetsApi = inject(GearsetsApi);
  private readonly summariesApi = inject(SummariesApi);
  private readonly toast = inject(ToastService);
  protected readonly access = inject(LapperAccess);

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
  protected readonly loading = computed(() => this.parts.loading() || this.gearsets.loading());

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
