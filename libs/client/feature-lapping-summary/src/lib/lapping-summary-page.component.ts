import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap } from '@angular/router';
import {
  GearsetsApi,
  loadable,
  MachineCyclesApi,
  MachinesApi,
  MacroLogsApi,
} from '@meshforge/client/core';
import {
  DanaComboboxColumn,
  DanaComboboxComponent,
  DanaCountBadgeDirective,
  DanaDetailGridDirective,
  DanaKpiCardDirective,
  DanaKpiGridDirective,
  DanaLoadingStateDirective,
  DanaPageHeaderComponent,
  DanaPanelHeaderDirective,
} from '@dana/ui';
import {
  EmptyStateComponent,
  StatusBadgeComponent,
  ValueFieldComponent,
} from '@meshforge/client/ui';
import { Gearset, LappingSummaryRow, Machine, MachineCycle } from '@meshforge/shared/domain';
import { catchError, forkJoin, map, of, shareReplay, switchMap } from 'rxjs';
import {
  fieldValue,
  findByName,
  GEARSET_FIELDS,
  GENERAL_GROUPS,
  groupByForm,
  isOn,
  MESH_GROUPS,
  PATH_ACTIVE_NAME,
  PATH_FORMS,
  PATH_GROUPS,
} from './macro-map';
import { SummaryGroupComponent } from './summary-group.component';

@Component({
  selector: 'gear-lapping-summary-page',
  imports: [
    FormsModule,
    DatePipe,
    DecimalPipe,
    DanaComboboxComponent,
    DanaCountBadgeDirective,
    DanaDetailGridDirective,
    DanaKpiCardDirective,
    DanaKpiGridDirective,
    DanaLoadingStateDirective,
    DanaPageHeaderComponent,
    DanaPanelHeaderDirective,
    EmptyStateComponent,
    StatusBadgeComponent,
    ValueFieldComponent,
    SummaryGroupComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lapping-summary-page.component.html',
  styleUrl: './lapping-summary-page.component.scss',
})
export class LappingSummaryPageComponent implements OnInit {
  private readonly machinesApi = inject(MachinesApi);
  private readonly gearsetsApi = inject(GearsetsApi);
  private readonly cyclesApi = inject(MachineCyclesApi);
  private readonly macroLogsApi = inject(MacroLogsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  /** Topbar search text that matched neither a gearset nor a machine. */
  protected readonly searchMiss = signal<string | null>(null);

  // Selection — each list narrows to what has actually run with the other selection.
  protected readonly allMachines = loadable<Machine[]>([]);
  protected readonly allGearsets = loadable<Gearset[]>([]);
  protected readonly machineOptions = loadable<Machine[]>([]);
  protected readonly gearsetOptions = loadable<Gearset[]>([]);
  protected readonly machineId = signal<string | null>(null);
  protected readonly gearsetId = signal<string | null>(null);
  protected readonly machine = computed(
    () => this.allMachines.value().find((m) => m.id === this.machineId()) ?? null,
  );
  protected readonly gearset = computed(
    () => this.allGearsets.value().find((g) => g.id === this.gearsetId()) ?? null,
  );

  // Data
  protected readonly rows = loadable<LappingSummaryRow[]>([]);
  protected readonly cycle = signal<MachineCycle | null>(null);
  private readonly byForm = computed(() => groupByForm(this.rows.value()));
  protected readonly gearData = computed(() => this.byForm().get('gear_data') ?? []);
  protected readonly generalData = computed(() => this.byForm().get('general_data') ?? []);
  protected readonly meshData = computed(() => this.byForm().get('mesh') ?? []);
  protected readonly paths = computed(() =>
    PATH_FORMS.map((p) => {
      const rows = this.byForm().get(p.form) ?? [];
      return { ...p, rows, active: isOn(findByName(rows, PATH_ACTIVE_NAME)?.value) };
    }),
  );
  protected readonly activePaths = computed(() =>
    this.paths().filter((p) => p.active && p.rows.length),
  );
  protected readonly inactivePaths = computed(() =>
    this.paths().filter((p) => !p.active || !p.rows.length),
  );
  protected readonly hasData = computed(() => this.rows.value().length > 0);
  protected readonly ready = computed(() => !!this.machineId() && !!this.gearsetId());

  protected readonly gearsetFields = GEARSET_FIELDS;
  protected readonly generalGroups = GENERAL_GROUPS;
  protected readonly meshGroups = MESH_GROUPS;
  protected readonly pathGroups = PATH_GROUPS;
  protected readonly consec = computed(() =>
    fieldValue(this.generalData(), { label: '', macro: 10032 }),
  );

  constructor() {
    // Load the summary whenever both selections are present.
    effect(() => {
      const m = this.machineId();
      const g = this.gearsetId();
      untracked(() => {
        if (m && g) this.load(m, g);
        else {
          this.rows.set([]);
          this.cycle.set(null);
        }
      });
    });
  }

  ngOnInit() {
    const lists$ = forkJoin({
      machines: this.machinesApi.list(),
      gearsets: this.gearsetsApi.list(),
    }).pipe(shareReplay(1));
    this.allMachines.load(lists$.pipe(map((l) => l.machines)));
    this.allGearsets.load(lists$.pipe(map((l) => l.gearsets)));
    this.machineOptions.load(lists$.pipe(map((l) => l.machines)));
    this.gearsetOptions.load(lists$.pipe(map((l) => l.gearsets)));

    // ?gearset=<id>&machine=<id> deep links, and ?q=<text> from the topbar search.
    this.route.queryParamMap
      .pipe(
        switchMap((params) => lists$.pipe(map((lists) => ({ params, ...lists })))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ params, machines, gearsets }) => this.applyParams(params, machines, gearsets));
  }

  private applyParams(params: ParamMap, machines: Machine[], gearsets: Gearset[]) {
    this.searchMiss.set(null);
    const gearsetId = params.get('gearset');
    const machineId = params.get('machine');
    if (gearsetId && gearsets.some((g) => g.id === gearsetId)) this.selectGearset(gearsetId);
    if (machineId && machines.some((m) => m.id === machineId)) this.selectMachine(machineId);

    const q = params.get('q')?.trim().toLowerCase();
    if (!q) return;
    const gearset = gearsets.find((g) => g.number.trim().toLowerCase() === q);
    const machine = machines.find((m) => m.number?.trim().toLowerCase() === q || m.ip.trim() === q);
    if (gearset) this.selectGearset(gearset.id);
    else if (machine) this.selectMachine(machine.id);
    else this.searchMiss.set(params.get('q')?.trim() ?? null);
  }

  protected selectMachine(id: string | null) {
    id = id || null;
    if (id === this.machineId()) return;
    this.machineId.set(id);
    if (id) this.gearsetOptions.load(this.gearsetsApi.byMachine(id));
    else this.gearsetOptions.load(this.gearsetsApi.list());
  }

  protected selectGearset(id: string | null) {
    id = id || null;
    if (id === this.gearsetId()) return;
    this.gearsetId.set(id);
    if (id) this.machineOptions.load(this.machinesApi.byGearset(id));
    else this.machineOptions.load(this.machinesApi.list());
  }

  protected clear() {
    this.searchMiss.set(null);
    this.machineId.set(null);
    this.gearsetId.set(null);
    this.machineOptions.load(this.machinesApi.list());
    this.gearsetOptions.load(this.gearsetsApi.list());
  }

  protected refresh() {
    const m = this.machineId();
    const g = this.gearsetId();
    if (m && g) this.load(m, g);
  }

  protected valueOf(
    rows: LappingSummaryRow[],
    f: { label: string; macro?: number; name?: string },
  ) {
    return fieldValue(rows, f);
  }

  // Combobox column layouts (Dana searchable dropdowns with headers)
  protected readonly gearsetColumns: DanaComboboxColumn<Gearset>[] = [
    { label: 'Gearset', value: (g) => g.number, width: '1.2fr' },
    { label: 'Rev', value: (g) => g.rev ?? '—', width: '64px' },
    { label: 'Pinion', value: (g) => g.pinion?.number ?? '—', width: '1fr' },
    { label: 'Ring', value: (g) => g.ring?.number ?? '—', width: '1fr' },
    { label: 'Summary', value: (g) => g.summary?.number ?? '—', width: '90px', align: 'end' },
  ];
  protected readonly machineColumns: DanaComboboxColumn<Machine>[] = [
    { label: 'Asset ID', value: (m) => m.number ?? m.ip, width: '1.2fr' },
    { label: 'Cell', value: (m) => m.cell ?? '—', width: '64px' },
    { label: 'Type', value: (m) => m.type ?? '—', width: '90px' },
    { label: 'IP', value: (m) => m.ip, width: '130px', align: 'end' },
  ];
  protected readonly idOf = (row: { id: string }) => row.id;
  protected readonly gearsetText = (g: Gearset) => `${g.number}${g.rev ? ` rev ${g.rev}` : ''}`;
  protected readonly machineText = (m: Machine) =>
    `${m.number ?? m.ip}${m.cell ? ` · Cell ${m.cell}` : ''}`;

  private load(machineId: string, gearsetId: string) {
    this.rows.load(this.macroLogsApi.lappingSummary(machineId, gearsetId));
    this.cyclesApi
      .latest(machineId, gearsetId)
      .pipe(catchError(() => of(null)))
      .subscribe((c) => this.cycle.set(c));
  }
}
