import { MachineDsfCountComponent } from '@meshforge/manufacturing/frontend/util-common';
import {
  CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  DestroyRef,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, Validators } from '@angular/forms';
import { GearLabelPrinterPickerComponent, GearToastService, announceAssetTagPrint, openLocationLabels } from '@meshforge/manufacturing/frontend/util-common';
import { map, Observable, tap } from 'rxjs';
import { Loadable, loadable } from '@meshforge/client/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import {
  CuttergrindNumberedShelfTag,
  CuttergrindRoughShelfTag,
  parseCuttergrindRoughShelfTag,
  parseCuttergrindNumberedShelfTag,
  describeCuttergrindShelfPosition,
  locationPartTypeFromSerial,
  parseSummaryShelfTag,
  SummaryShelfTag,
  CUTTER_BODY_RULES,
  KNOWN_BLADE_LABELS,
  normalizeBladeLabel,
  CutterBodyRuleResolution,
  resolveCutterBodyRule,
  PASSWORD_MIN_LENGTH,
  isStrongPassword,
} from '@meshforge/manufacturing/shared/util-constants';
import { IPartSummarySettings, ISavePartSummaryRequest, ISummaryBodyRuleRow, ISummaryPartTypeSettings } from '@meshforge/manufacturing/shared/util-types';
import {
  AdminApiService,
  AdminLocationRow,
  AdminUser,
  CutterBodyDefinitionRow, CutterBodyRow,
  DepartmentRow,
  MachineRow,
  ModelRow,
  PartRow,
  PartSummaryRow,
  PartTypeRow,
  RollMasterRow,
  adminApiErrorText,
  AdminContainerRow,
  AdminTrayRow,
  AssetTagKind,
} from '../admin-api.service';
import { DsfMachineMappingsComponent } from '../dsf-machine-mappings/dsf-machine-mappings.component';
import { LabelPrintersComponent } from '../label-printers/label-printers.component';
import { ServerSettingsComponent } from '../server-settings/server-settings.component';
import { CoaterRpaSetupComponent } from '../coater-rpa/coater-rpa-setup.component';
import { LaunchSetupComponent } from '../launch-setup/launch-setup.component';
import { AccessManagementComponent } from '../access-management.component';
import { LocationEditorComponent } from '../bulk-locations/location-editor.component';
import { BulkLocationsComponent } from '../bulk-locations/bulk-locations.component';
import { LappingGearsetsComponent } from '../lapping/lapping-gearsets.component';
import { LappingMachinesComponent } from '../lapping/lapping-machines.component';
import { AdminConfirmation, adminSearchMatches, allPages, failedLists } from '../shared/admin-data';
import { AdminListStateComponent } from '../shared/admin-list-state.component';
import {
  DanaPageHeaderComponent,
  DanaConfirmDialogComponent,
  DanaToneDirective,
} from '@dana/ui';

import { CycleTestsPageComponent, ScannersPageComponent, MacrosPageComponent, FanucVariablesPageComponent, CollectorTokensPageComponent } from '@meshforge/client/feature-config';

type AdminTab = 'access' | 'cycle-tests' | 'scanners' | 'macros' | 'fanuc-variables' | 'collector-tokens' | 'users' | 'part-summaries' | 'parts' | 'gearsets' | 'roll-masters' | 'models' | 'machines' | 'lapping-machines' | 'dsf-mappings' | 'label-printers' | 'coater-rpa' | 'launch' | 'server-settings' | 'trays' | 'containers' | 'locations' | 'cutter-bodies';
// Every tab, for ?tab= deep links; `satisfies` keeps it in step with AdminTab.
const ADMIN_TABS = ['access', 'cycle-tests', 'scanners', 'macros', 'fanuc-variables', 'collector-tokens', 'users', 'part-summaries', 'parts', 'gearsets', 'roll-masters', 'models', 'machines', 'lapping-machines', 'dsf-mappings', 'label-printers', 'coater-rpa', 'launch', 'server-settings', 'trays', 'containers', 'locations', 'cutter-bodies'] as const satisfies readonly AdminTab[];
const isAdminTab = (value: unknown): value is AdminTab => ADMIN_TABS.includes(value as AdminTab);
const isAdminRole = (role?: string | null) => String(role ?? '').toLowerCase() === 'admin';

/** The lists a tab shows or chooses from; only these load while it is open. */
type AdminList = 'users' | 'departments' | 'models' | 'partSummaries' | 'summaryBodyRules' | 'summarySettings' | 'partTypes'
  | 'parts' | 'rollMasters' | 'machines' | 'trays' | 'containers' | 'locations' | 'cutterBodies' | 'cutterBodyDefinitions';
const TAB_LISTS: Partial<Record<AdminTab, readonly AdminList[]>> = {
  users: ['users', 'departments'],
  access: ['users'],
  'part-summaries': ['partSummaries', 'models', 'summaryBodyRules', 'summarySettings'],
  parts: ['parts', 'partSummaries', 'partTypes'],
  'roll-masters': ['parts', 'rollMasters'],
  models: ['models'],
  machines: ['machines', 'departments'],
  'lapping-machines': ['machines'],
  trays: ['trays'],
  containers: ['containers'],
  locations: ['locations', 'partSummaries', 'partTypes'],
  'cutter-bodies': ['cutterBodies', 'cutterBodyDefinitions'],
};
/** The list a tab is about; its own list-state shows its failures. */
const TAB_OWN_LIST: Partial<Record<AdminTab, AdminList>> = {
  users: 'users', 'part-summaries': 'partSummaries', parts: 'parts', 'roll-masters': 'parts', models: 'models',
  machines: 'machines', trays: 'trays', containers: 'containers', locations: 'locations', 'cutter-bodies': 'cutterBodies',
};
const LIST_NAMES: Record<AdminList, string> = {
  users: 'users', departments: 'departments', models: 'models', partSummaries: 'Part Summaries',
  summaryBodyRules: 'Body Size Rules', summarySettings: 'Part Summary settings', partTypes: 'Part Types', parts: 'parts',
  rollMasters: 'Roll Master quantities', machines: 'machines', trays: 'trays', containers: 'containers', locations: 'locations',
  cutterBodies: 'cutter bodies', cutterBodyDefinitions: 'cutter body definitions',
};

@Component({
  selector: 'gear-admin-users-page',
  standalone: true,
  imports: [DanaConfirmDialogComponent, AdminListStateComponent, AccessManagementComponent, LocationEditorComponent, CoaterRpaSetupComponent, LaunchSetupComponent, BulkLocationsComponent, DanaToneDirective, MachineDsfCountComponent,CycleTestsPageComponent, ScannersPageComponent, MacrosPageComponent, FanucVariablesPageComponent, CollectorTokensPageComponent, CommonModule, FormsModule, DanaPageHeaderComponent, DsfMachineMappingsComponent, LabelPrintersComponent, ServerSettingsComponent, GearLabelPrinterPickerComponent, LappingGearsetsComponent, LappingMachinesComponent],
  templateUrl: './frontend-feature-admin-users.component.html',
  styleUrls: ['./frontend-feature-admin-users.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FrontendFeatureAdminUsersComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(AdminApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly toast = inject(GearToastService);
  readonly session = inject(AuthSessionService);
  // Optional so the page also renders outside a router (component tests).
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });

  activeTab: AdminTab = 'users';
  busy = false;
  message = '';
  error = '';
  readonly minPasswordLength = PASSWORD_MIN_LENGTH;
  userToDisable: AdminUser | null = null;
  /** In-page confirmations for disabling records and granting administrator access. */
  readonly confirmation = new AdminConfirmation();

  // Each list loads when a tab that needs it opens; a newer load cancels an older one.
  readonly usersList = loadable<AdminUser[]>([]);
  readonly partSummariesList = loadable<PartSummaryRow[]>([]);
  readonly partTypesList = loadable<PartTypeRow[]>([]);
  readonly partsList = loadable<PartRow[]>([]);
  readonly rollMastersList = loadable<RollMasterRow[]>([]);
  readonly modelsList = loadable<ModelRow[]>([]);
  readonly departmentsList = loadable<DepartmentRow[]>([]);
  readonly machinesList = loadable<MachineRow[]>([]);
  readonly traysList = loadable<AdminTrayRow[]>([]);
  readonly containersList = loadable<AdminContainerRow[]>([]);
  readonly locationsList = loadable<AdminLocationRow[]>([]);
  readonly cutterBodiesList = loadable<CutterBodyRow[]>([]);
  readonly cutterBodyDefinitionsList = loadable<CutterBodyDefinitionRow[]>([]);
  /** Summary Body Size Rules keyed by Summary id; the rule controls the read-only Required Blades. */
  readonly summaryBodyRulesList = loadable(new Map<string, ISummaryBodyRuleRow>());
  /** RING/PINION HOS, Inner blade and Outer blade of each Summary (blank when not set). */
  readonly summarySettingsList = loadable(new Map<string, IPartSummarySettings>());

  get users(): AdminUser[] { return this.usersList.value(); }
  get partSummaries(): PartSummaryRow[] { return this.partSummariesList.value(); }
  get partTypes(): PartTypeRow[] { return this.partTypesList.value(); }
  get parts(): PartRow[] { return this.partsList.value(); }
  get rollMasters(): RollMasterRow[] { return this.rollMastersList.value(); }
  get models(): ModelRow[] { return this.modelsList.value(); }
  get departments(): DepartmentRow[] { return this.departmentsList.value(); }
  get machines(): MachineRow[] { return this.machinesList.value(); }
  get trays(): AdminTrayRow[] { return this.traysList.value(); }
  get containers(): AdminContainerRow[] { return this.containersList.value(); }
  get locations(): AdminLocationRow[] { return this.locationsList.value(); }
  get cutterBodies(): CutterBodyRow[] { return this.cutterBodiesList.value(); }
  get cutterBodyDefinitions(): CutterBodyDefinitionRow[] { return this.cutterBodyDefinitionsList.value(); }
  get summaryBodyRules(): Map<string, ISummaryBodyRuleRow> { return this.summaryBodyRulesList.value(); }
  get summarySettings(): Map<string, IPartSummarySettings> { return this.summarySettingsList.value(); }

  private readonly lists: Record<AdminList, { list: Loadable<unknown>; load: () => void }> = {
    users: { list: this.usersList, load: () => this.loadUsers() },
    departments: { list: this.departmentsList, load: () => this.loadDepartments() },
    models: { list: this.modelsList, load: () => this.loadModels() },
    partSummaries: { list: this.partSummariesList, load: () => this.loadPartSummaries() },
    summaryBodyRules: { list: this.summaryBodyRulesList, load: () => this.loadSummaryBodyRules() },
    summarySettings: { list: this.summarySettingsList, load: () => this.loadSummarySettings() },
    partTypes: { list: this.partTypesList, load: () => this.loadPartTypes() },
    parts: { list: this.partsList, load: () => this.loadParts() },
    rollMasters: { list: this.rollMastersList, load: () => this.loadRollMasters() },
    machines: { list: this.machinesList, load: () => this.loadMachines() },
    trays: { list: this.traysList, load: () => this.loadTrays() },
    containers: { list: this.containersList, load: () => this.loadContainers() },
    locations: { list: this.locationsList, load: () => this.loadLocations() },
    cutterBodies: { list: this.cutterBodiesList, load: () => this.loadCutterBodies() },
    cutterBodyDefinitions: { list: this.cutterBodyDefinitionsList, load: () => this.loadCutterBodyDefinitions() },
  };

  /** Choices the open tab's form needs that could not be loaded. */
  get failedChoices(): string[] {
    const lists = (TAB_LISTS[this.activeTab] ?? []).filter((name) => name !== TAB_OWN_LIST[this.activeTab]);
    return failedLists(Object.fromEntries(lists.map((name) => [LIST_NAMES[name], this.lists[name].list])));
  }

  retryFailedChoices(): void {
    for (const name of TAB_LISTS[this.activeTab] ?? []) if (this.lists[name].list.error() !== null) this.lists[name].load();
  }
  readonly summaryPartTypes = ['RING', 'PINION'] as const;
  readonly knownBladeLabels: readonly string[] = KNOWN_BLADE_LABELS;
  /** Edit Part Summary draft: both Part Type groups and the Body Size choice ('KEEP' keeps the mapping). */
  summaryTypeForm: Record<'RING' | 'PINION', { hos: string; inner_blade: string; outer_blade: string }> = this.emptySummaryTypeForm();
  summaryBodyRuleChoice = 'KEEP';
  readonly cutterBodyRules = CUTTER_BODY_RULES;
  danaAssignments: Record<string, string | undefined> = {};
  userSearch = '';
  partSummarySearch = '';
  partSearch = '';
  rollMasterSearch = '';
  modelSearch = '';
  machineSearch = '';
  traySearch = '';
  containerSearch = '';
  locationSearch = '';
  cutterBodySearch = '';
  editingUserId: string | null = null;
  editingPartSummaryId: string | null = null;
  editingPartId: string | null = null;
  editingMachineId: string | null = null;
  editingLocationId: string | null = null;
  editingCutterBodyId: string | null = null;
  /** Typed Roll Master quantities per part, created when parts or Roll Masters load (never while rendering). */
  rollMasterEdits: Record<string, { current_quantity: number; minimum_quantity: number }> = {};
  printingTagId: string | null = null;

  userForm = {
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: 'user',
    departmentId: '',
  };

  summaryForm = {
    number: '',
    revision: '',
    model_id: '',
    hos: '',
  };

  partForm: {
    part_number: string;
    summary_id: string;
    part_type_id: string;
    teeth: number | null;
  } = {
    part_number: '',
    summary_id: '',
    part_type_id: '',
    teeth: null,
  };

  modelForm: {
    model_number: string;
    model_type: string;
  } = {
    model_number: '',
    model_type: '',
  };

  machineForm: {
    machine_number: string;
    department_id: string;
    cell: number | null;
    description: string;
    machine_type: 'PRODUCTION' | 'CUTTER_BUILDER' | 'GRINDER';
  } = {
    machine_number: '',
    department_id: '',
    cell: null,
    description: '',
    machine_type: 'PRODUCTION',
  };

  trayForm = {
    serial_number: '',
  };

  containerForm = {
    serial_number: '',
  };

  locationForm = {
    serial_number: '',
    number: '',
    description: '',
    department: '',
    location_type: 'INTERNAL',
    enabled: true,
    summary_id: '',
    part_type_id: '',
  };

  cutterBodyForm = {
    mf_serial_number: '',
    dana_serial_number: '',
    description: '',
    definition_id: '',
  };

  ngOnInit(): void {
    // ?tab= deep links, e.g. the old Lapping master-data pages redirect to /admin?tab=gearsets.
    const requested = this.route?.snapshot.queryParamMap.get('tab');
    if (isAdminTab(requested)) this.activeTab = requested;
    this.route?.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const tab = params.get('tab');
      if (isAdminTab(tab) && tab !== this.activeTab) { this.activeTab = tab; this.loadTab(); this.cdr.markForCheck(); }
    });
    this.loadTab();
  }

  ngOnDestroy(): void {
    for (const { list } of Object.values(this.lists)) list.dispose();
  }

  /** Loads the open tab's lists and cancels loads the other tabs started. */
  private loadTab(): void {
    const needed = new Set(TAB_LISTS[this.activeTab] ?? []);
    for (const [name, entry] of Object.entries(this.lists) as [AdminList, { list: Loadable<unknown>; load: () => void }][]) {
      if (needed.has(name)) entry.load();
      else entry.list.dispose();
    }
  }

  /** Two enabled models with one number are usually the same model entered with and without a type. */
  modelSharesNumber(model: { id: string; model_number?: string | null; enabled?: boolean }): boolean {
    const key = (value?: string | null) => (value ?? '').trim().toUpperCase();
    return !!key(model.model_number) && model.enabled !== false
      && this.models.some(other => other.id !== model.id && other.enabled !== false && key(other.model_number) === key(model.model_number));
  }

  /** A model's name: its number, or its type when it has no number. */
  modelLabel(model?: { model_number?: string | null; model_type?: string | null } | null): string {
    return model?.model_number?.trim() || model?.model_type?.trim() || '—';
  }

  /** A tab asked for by name from another Admin page; unknown names are ignored. */
  openTabByName(tab: string): void {
    if (isAdminTab(tab)) this.setTab(tab);
  }

  setTab(tab: AdminTab): void {
    const changed = tab !== this.activeTab;
    this.activeTab = tab;
    this.clearNotice();
    this.confirmation.dismiss();
    if (changed) this.loadTab();
    if (this.route && this.router) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { tab }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  /** `confirmed`: the administrator already agreed to grant administrator access. */
  createUser(confirmed = false): void {
    if (this.busy) return;
    const email = this.userForm.email.trim();
    if (this.editingUserId ? !this.userForm.departmentId : (!email || !this.userForm.departmentId || !this.userForm.password)) {
      this.error = this.editingUserId
        ? 'Department is required.'
        : 'Email, password, and department are required.';
      this.focusUserField(!email && !this.editingUserId ? '#admin-user-email'
        : !this.userForm.password && !this.editingUserId ? '#admin-user-password' : '#admin-user-department');
      return;
    }
    if (email && Validators.email(new FormControl(email))) {
      this.error = 'Enter a valid email address.';
      this.focusUserField('#admin-user-email');
      return;
    }
    if (!this.editingUserId && !isStrongPassword(this.userForm.password)) {
      this.error = `Temporary password must have at least ${PASSWORD_MIN_LENGTH} characters, uppercase and lowercase letters, a number, and a symbol.`;
      this.focusUserField('#admin-user-password');
      return;
    }
    if (this.editingUserId && this.isSelf(this.editingUserId) && this.userForm.role !== 'admin') {
      this.error = 'You cannot remove your own administrator role. Ask another administrator.';
      return;
    }

    const grantsAdmin = isAdminRole(this.userForm.role) &&
      (!this.editingUserId || !isAdminRole(this.users.find((user) => user.id === this.editingUserId)?.role));
    if (grantsAdmin && !confirmed) {
      const who = email || 'This account';
      this.confirmation.ask({
        title: this.editingUserId ? 'Make this user an administrator?' : 'Create an administrator?',
        message: `${who} will be able to change every MeshForge setting, account and record. Administrators sign in with email and password, not a badge.`,
        confirmLabel: this.editingUserId ? 'Make administrator' : 'Create administrator',
        danger: true,
        run: () => this.createUser(true),
      });
      this.cdr.markForCheck();
      return;
    }

    const request = this.editingUserId
      ? this.api.updateUser(this.editingUserId, {
          // Accounts imported without an email keep none unless one is typed in.
          ...(email ? { email } : {}),
          firstName: this.userForm.firstName.trim() || null,
          lastName: this.userForm.lastName.trim() || null,
          role: this.userForm.role,
          departmentId: this.userForm.departmentId,
        })
      : this.api.createUser({
          email: this.userForm.email.trim(),
          password: this.userForm.password,
          firstName: this.userForm.firstName.trim() || null,
          lastName: this.userForm.lastName.trim() || null,
          role: this.userForm.role,
          departmentId: this.userForm.departmentId,
        });

    this.runCreate(request, this.editingUserId ? 'User updated.' : 'User created.', () => {
      this.resetUserForm();
      this.loadUsers();
    });
  }

  beginEditUser(user: AdminUser): void {
    this.editingUserId = user.id;
    this.userForm = {
      email: user.email || '', password: '', firstName: user.firstName || '', lastName: user.lastName || '',
      role: isAdminRole(user.role) ? 'admin' : 'user', departmentId: user.departmentId || '',
    };
    this.clearNotice(); this.focusEditor();
  }

  cancelUserEdit(): void { this.resetUserForm(); this.clearNotice(); this.cdr.markForCheck(); }

  /** The signed-in administrator's own account: it cannot be disabled or demoted from here. */
  isSelf(userId: string): boolean { return this.session.currentUser?.sub === userId; }

  requestUserEnabled(user: AdminUser): void {
    if (this.busy) return;
    if (user.active && !this.isSelf(user.id)) this.userToDisable = user;
    else this.toggleUserEnabled(user);
  }

  confirmDisableUser(): void {
    const user = this.userToDisable;
    this.userToDisable = null;
    if (user) this.toggleUserEnabled(user);
  }

  /** Brings the tab's form into view and focuses its first field, e.g. after Edit is clicked below it. */
  private focusEditor(): void {
    this.cdr.detectChanges();
    const form = this.element.nativeElement.querySelector<HTMLElement>('form[data-admin-editor]');
    if (!form) return;
    form.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    form.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])')?.focus({ preventScroll: true });
  }

  private focusUserField(selector: string): void {
    this.cdr.detectChanges();
    this.element.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }

  toggleUserEnabled(user: AdminUser): void {
    if (this.busy) return;
    const active = !user.active;
    if (!active && this.isSelf(user.id)) { this.error = 'You cannot disable your own account. Ask another administrator.'; return; }
    this.runCreate(this.api.updateUser(user.id, { active }), `User ${active ? 'enabled' : 'disabled'}.`, () => this.loadUsers());
  }

  createPartSummary(): void {
    const number = this.summaryForm.number.trim();
    if (!number) { this.error = 'Part Summary number is required.'; return; }
    const payload = {
      number, revision: this.summaryForm.revision.trim(), model_id: this.summaryForm.model_id || null,
      hos: this.summaryForm.hos.trim() || null,
    };
    if (this.editingPartSummaryId) { this.savePartSummary(this.editingPartSummaryId, payload); return; }
    // Active/enabled are set on create only; an edit must not silently re-enable a disabled record.
    this.runCreate(this.api.createPartSummary({ ...payload, active: true, enabled: true }), 'Part Summary created.', () => {
      this.resetPartSummaryForm(); this.loadPartSummaries(); this.loadSummaryBodyRules(); this.loadSummarySettings();
    });
  }

  /**
   * Save Part Summary: Summary fields, both RING/PINION groups and any Body Size change go in ONE
   * request and one transaction. On failure nothing is saved and the draft stays in the form.
   */
  private savePartSummary(summaryId: string, summaryFields: { number: string; revision: string; model_id: string | null; hos: string | null }, confirmed = false): void {
    if (this.busy) return;
    const body: ISavePartSummaryRequest = { ...summaryFields, part_types: {} };
    for (const code of this.summaryPartTypes) {
      const group = this.summaryTypeForm[code];
      // Every field is sent: an untouched field resends its current value; a blank clears it.
      body.part_types![code] = { hos: group.hos || null, inner_blade: normalizeBladeLabel(group.inner_blade), outer_blade: normalizeBladeLabel(group.outer_blade) };
    }
    const current = this.summaryBodyRuleById(summaryId);
    if (this.summaryBodyRuleChoice !== 'KEEP' && this.summaryBodyRuleChoice !== (current?.configured_body_rule ?? '')) {
      body.body_rule = this.summaryBodyRuleChoice || null;
      const rule = CUTTER_BODY_RULES.find((r) => r.code === this.summaryBodyRuleChoice);
      const existing = current?.required_blade_sets;
      if (rule && existing != null && existing !== rule.blade_sets && !confirmed) {
        this.confirmation.ask({
          title: 'Change Required Blades?',
          message: `${rule.label} changes ${summaryFields.number}'s Required Blades from ${existing * 2} to ${rule.total_blades} for every Part Type. Trays already ground keep their quantity.`,
          confirmLabel: 'Save Part Summary',
          run: () => this.savePartSummary(summaryId, summaryFields, true),
        });
        this.cdr.markForCheck();
        return;
      }
    }
    this.busy = true; this.clearNotice();
    this.api.savePartSummary(summaryId, body).subscribe({
      next: (row) => {
        this.busy = false;
        const trays = row.open_trays_with_other_quantity ?? 0;
        this.message = `${row.summary_number} saved.${trays ? ` ${trays} tray(s) hold the previous quantity and need review.` : ''}`;
        this.resetPartSummaryForm();
        this.loadPartSummaries(); this.loadSummaryBodyRules(); this.loadSummarySettings();
        this.cdr.markForCheck();
      },
      // The draft is kept so the administrator can correct it and save again.
      error: (error: HttpErrorResponse) => { this.busy = false; this.error = `Nothing was changed. ${this.errorMessage(error)}`; this.cdr.markForCheck(); },
    });
  }

  private emptySummaryTypeForm(): Record<'RING' | 'PINION', { hos: string; inner_blade: string; outer_blade: string }> {
    return { RING: { hos: '', inner_blade: '', outer_blade: '' }, PINION: { hos: '', inner_blade: '', outer_blade: '' } };
  }

  /** One Part Type's stored HOS / Inner blade / Outer blade for a Summary. */
  summaryPartTypeSettings(summaryId: string, code: string): ISummaryPartTypeSettings | null {
    return this.summarySettings.get(summaryId)?.part_types.find((pt) => pt.part_type_code === code) ?? null;
  }

  /** Label choices for a blade field: the known labels plus whatever is stored or typed. */
  bladeLabelChoices(current: string): string[] {
    const value = normalizeBladeLabel(current);
    return value && !this.knownBladeLabels.includes(value) ? [...this.knownBladeLabels, value] : [...this.knownBladeLabels];
  }

  /** Required Blades preview for the Body Size choice in the edit form. */
  get summaryRequiredBladesPreview(): string {
    if (!this.editingPartSummaryId) return '—';
    const current = this.summaryBodyRuleById(this.editingPartSummaryId);
    if (this.summaryBodyRuleChoice === 'KEEP') {
      return current?.required_total_blades != null ? `${current.required_total_blades} blades (${current.required_blade_sets} sets) — current` : 'Unchanged';
    }
    const rule = CUTTER_BODY_RULES.find((r) => r.code === this.summaryBodyRuleChoice);
    return rule ? `${rule.total_blades} blades (${rule.blade_sets} sets) — ${rule.label}` : 'Rule removed; quantities stay as they are';
  }

  private summaryBodyRuleById(summaryId: string): ISummaryBodyRuleRow | null {
    return this.summaryBodyRules.get(summaryId) ?? null;
  }

  beginEditPartSummary(summary: PartSummaryRow): void {
    this.editingPartSummaryId = summary.id;
    this.summaryForm = { number: summary.number, revision: summary.revision || '', model_id: summary.model_id || '', hos: summary.hos || '' };
    const form = this.emptySummaryTypeForm();
    for (const code of this.summaryPartTypes) {
      const stored = this.summaryPartTypeSettings(summary.id, code);
      form[code] = { hos: stored?.hos ?? '', inner_blade: stored?.inner_blade ?? '', outer_blade: stored?.outer_blade ?? '' };
    }
    this.summaryTypeForm = form;
    this.summaryBodyRuleChoice = 'KEEP';
    this.clearNotice(); this.focusEditor();
  }

  cancelPartSummaryEdit(): void { this.resetPartSummaryForm(); this.clearNotice(); this.cdr.markForCheck(); }

  summaryBodyRule(summary: PartSummaryRow): ISummaryBodyRuleRow | null {
    return this.summaryBodyRules.get(summary.id) ?? null;
  }

  /** Read-only Required Blades: Summary-based, shown in total blades and matched sets. */
  summaryRequiredBladesText(summary: PartSummaryRow): string {
    const row = this.summaryBodyRule(summary);
    if (!row || row.required_total_blades == null) return row?.status === 'CONFLICT' ? 'Needs review' : '—';
    return `${row.required_total_blades} blades (${row.required_blade_sets} sets)`;
  }

  summaryBodyRuleText(summary: PartSummaryRow): string {
    const row = this.summaryBodyRule(summary);
    if (!row) return '—';
    switch (row.status) {
      case 'CONFIGURED': return row.effective_body_rule_label ?? row.configured_body_rule ?? '—';
      case 'DERIVED': return `${row.effective_body_rule_label} (from quantity)`;
      case 'UNRESOLVED': return `Unresolved — ${row.detail}. Cutter Builder is blocked until a rule is set.`;
      case 'CONFLICT': return `Conflict — ${row.detail}`;
      default: return 'No blade requirement';
    }
  }

  /** Body definitions this Summary's blades may be loaded into, or why none are permitted yet. */
  summaryPermittedBodiesText(summary: PartSummaryRow): string {
    const row = this.summaryBodyRule(summary);
    if (!row) return '—';
    const codes = row.permitted_body_definitions ?? [];
    if (codes.length) return codes.join(', ') + (row.effective_body_rule?.startsWith('105') ? ' (8th Dana S/N character decides 105 Standard / Special)' : '');
    return row.effective_body_rule ? 'No enabled body definition of this size' : 'None until the Body Size Rule is resolved';
  }

  /** Read-only decode of a cutter body's Dana S/N (never its MF serial). */
  cutterBodyDecode(body: CutterBodyRow): CutterBodyRuleResolution {
    return resolveCutterBodyRule(body);
  }

  togglePartSummaryEnabled(summary: PartSummaryRow, confirmed = false): void {
    const enabled = !summary.enabled;
    if (!enabled && !confirmed) { this.askDisable(`Part Summary ${summary.number}`, 'Parts, locations and new work can no longer choose it until it is enabled again.', () => this.togglePartSummaryEnabled(summary, true)); return; }
    this.runCreate(this.api.updatePartSummary(summary.id, { enabled, active: enabled }), `Part Summary ${summary.number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadPartSummaries());
  }

  createPart(): void {
    const partNumber = this.partForm.part_number.trim();
    if (!partNumber || !this.partForm.summary_id || !this.partForm.part_type_id) {
      this.error = 'Part number, Part Summary, and Part Type are required.';
      return;
    }
    const payload = {
      part_number: partNumber,
      summary_id: this.partForm.summary_id,
      part_type_id: this.partForm.part_type_id,
      teeth: this.partForm.teeth,
    };
    // Active/enabled are set on create only; an edit must not silently re-enable a disabled record.
    const editing = this.editingPartId;
    this.runCreate(
      editing
        ? this.api.updatePart(editing, payload)
        : this.api.createPart({ ...payload, active: true, enabled: true }),
      editing ? 'Part updated.' : 'Part created.',
      () => {
        this.resetPartForm();
        this.loadParts();
      },
    );
  }

  beginEditPart(part: PartRow): void {
    this.editingPartId = part.id;
    this.partForm = {
      part_number: part.part_number,
      summary_id: part.summary_id,
      part_type_id: part.part_type_id,
      teeth: part.teeth,
    };
    this.clearNotice(); this.focusEditor();
  }

  cancelPartEdit(): void { this.resetPartForm(); this.clearNotice(); this.cdr.markForCheck(); }

  /** Gearset-type parts exist only as part of a gearset assembly (Admin > Gearsets). */
  isGearsetPart(part: PartRow): boolean {
    return (part.part_type?.code ?? '').trim().toUpperCase() === 'GEARSET';
  }

  get partTypeChoices(): PartTypeRow[] {
    return this.partTypes.filter((type) => type.code.trim().toUpperCase() !== 'GEARSET');
  }

  private resetPartForm(): void {
    this.editingPartId = null;
    this.partForm = { part_number: '', summary_id: '', part_type_id: '', teeth: null };
  }

  togglePartEnabled(part: PartRow, confirmed = false): void {
    const enabled = !part.enabled;
    if (!enabled && !confirmed) { this.askDisable(`part ${part.part_number}`, 'It can no longer be chosen for new work until it is enabled again.', () => this.togglePartEnabled(part, true)); return; }
    this.runCreate(this.api.updatePart(part.id, { enabled, active: enabled }), `Part ${part.part_number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadParts());
  }

  createModel(): void {
    if (!this.modelForm.model_number.trim() && !this.modelForm.model_type.trim()) {
      this.error = 'Model number or model type is required.';
      return;
    }

    this.runCreate(
      this.api.createModel({
        model_number: this.modelForm.model_number.trim() || null,
        model_type: this.modelForm.model_type.trim() || null,
        active: true,
      }),
      'Model created.',
      () => {
        this.modelForm = { model_number: '', model_type: '' };
        this.loadModels();
      },
    );
  }

  toggleModelEnabled(model: ModelRow): void {
    const enabled = !model.enabled;
    this.runCreate(this.api.updateModel(model.id, { enabled, active: enabled }), `Model ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadModels());
  }

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
    this.runCreate(request, this.editingMachineId ? 'Machine updated.' : 'Machine created.', () => {
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
    this.runCreate(this.api.updateMachine(machine.id, { enabled, active: enabled }), `Machine ${machine.machine_number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadMachines());
  }

  private adminSearchMatches(searchText: string, values: unknown[]): boolean {
    return adminSearchMatches(searchText, values);
  }

  /** Disabling waits for an in-page confirmation; `send` runs once it is given. */
  private askDisable(what: string, consequence: string, send: () => void): void {
    if (this.busy) return;
    this.confirmation.ask({ title: `Disable ${what}?`, message: `Disable ${what}? ${consequence}`, confirmLabel: 'Disable', danger: true, run: send });
    this.cdr.markForCheck();
  }

  get filteredUsers(): AdminUser[] {
    return this.users.filter((user) =>
      this.adminSearchMatches(this.userSearch, [
        user.fullName,
        user.firstName,
        user.lastName,
        user.email,
        user.role,
        this.departmentName(user.departmentId),
        user.active ? 'active' : 'inactive',
      ]),
    );
  }

  /** The part-summary list returns model_id only; look the model up in the loaded Models list. */
  summaryModel(summary: PartSummaryRow): ModelRow | undefined {
    return summary.model ?? this.models.find((model) => model.id === summary.model_id);
  }

  get filteredPartSummaries(): PartSummaryRow[] {
    return this.partSummaries.filter((summary) =>
      this.adminSearchMatches(this.partSummarySearch, [
        summary.number,
        summary.revision,
        this.summaryModel(summary)?.model_number,
        this.summaryModel(summary)?.model_type,
        summary.hos,
        summary.active ? 'active' : 'inactive',
        summary.enabled ? 'enabled' : 'disabled',
      ]),
    );
  }

  get filteredParts(): PartRow[] {
    return this.parts.filter((part) =>
      this.adminSearchMatches(this.partSearch, [
        part.part_number,
        part.summary?.number,
        part.summary?.revision,
        part.part_type?.code,
        part.part_type?.name,
        part.teeth,
        part.active ? 'active' : 'inactive',
        part.enabled ? 'enabled' : 'disabled',
      ]),
    );
  }

  get filteredModels(): ModelRow[] {
    return this.models.filter((model) =>
      this.adminSearchMatches(this.modelSearch, [
        model.model_number,
        model.model_type,
        model.active ? 'active' : 'inactive',
        model.enabled ? 'enabled' : 'disabled',
      ]),
    );
  }

  get filteredMachines(): MachineRow[] {
    return this.machines.filter((machine) =>
      this.adminSearchMatches(this.machineSearch, [
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

  get filteredRollMasterParts(): PartRow[] {
    return this.parts.filter((part) => this.adminSearchMatches(this.rollMasterSearch, [
      part.part_number, part.summary?.number, part.part_type?.code,
      part.roll_master?.current_quantity ?? 0, part.roll_master?.minimum_quantity ?? part.roll_master?.required_count ?? 0,
    ]));
  }

  rollMasterEdit(part: PartRow): { current_quantity: number; minimum_quantity: number } {
    return this.rollMasterEdits[part.id] ?? this.rollMasterDefaults(part);
  }

  private rollMasterDefaults(part: PartRow, rollMasters = this.rollMasters): { current_quantity: number; minimum_quantity: number } {
    const configured = rollMasters.find((row) => row.part_id === part.id) ?? part.roll_master ?? null;
    return {
      current_quantity: configured?.current_quantity ?? 0,
      minimum_quantity: configured?.minimum_quantity ?? configured?.required_count ?? 0,
    };
  }

  /** Gives every part an editable quantity; typed values that have not been saved are kept. */
  private syncRollMasterEdits(parts = this.parts, rollMasters = this.rollMasters): void {
    const edits: Record<string, { current_quantity: number; minimum_quantity: number }> = {};
    for (const part of parts) edits[part.id] = this.rollMasterEdits[part.id] ?? this.rollMasterDefaults(part, rollMasters);
    this.rollMasterEdits = edits;
  }

  rollMasterRecord(part: PartRow): RollMasterRow | null {
    return this.rollMasters.find((row) => row.part_id === part.id) ?? part.roll_master ?? null;
  }

  rollMasterLow(part: PartRow): boolean {
    const record = this.rollMasterRecord(part);
    if (record && !record.enabled) return false;
    const edit = this.rollMasterEdit(part);
    return edit.minimum_quantity > 0 && edit.current_quantity <= edit.minimum_quantity;
  }

  toggleRollMasterEnabled(part: PartRow): void {
    const record = this.rollMasterRecord(part);
    if (!record) { this.error = `Save a Roll Master quantity for ${part.part_number} before disabling it.`; return; }
    const enabled = !record.enabled;
    this.runCreate(this.api.updateRollMaster(record.id, { enabled, active: enabled }), `Roll Master for ${part.part_number} ${enabled ? 'enabled' : 'disabled'}.`, () => { this.loadRollMasters(); this.loadParts(); });
  }

  saveRollMaster(part: PartRow): void {
    const edit = this.rollMasterEdit(part);
    if (edit.current_quantity < 0 || edit.minimum_quantity < 0 || !Number.isInteger(edit.current_quantity) || !Number.isInteger(edit.minimum_quantity)) {
      this.error = 'Roll Master current and minimum quantities must be whole numbers of 0 or greater.'; return;
    }
    const existing = this.rollMasters.find((row) => row.part_id === part.id) ?? part.roll_master ?? null;
    const request = existing
      ? this.api.updateRollMaster(existing.id, { current_quantity: edit.current_quantity, minimum_quantity: edit.minimum_quantity })
      : this.api.createRollMaster({ part_id: part.id, current_quantity: edit.current_quantity, minimum_quantity: edit.minimum_quantity, active: true, enabled: true });
    this.runCreate(request, `Roll Master quantity saved for ${part.part_number}.`, () => { this.loadRollMasters(part.id); this.loadParts(); });
  }

  private normalizeSequentialAssetSerial(prefix: 'T' | 'C', input: string): string {
    const raw = input.trim().toUpperCase();
    const match = new RegExp(`^(?:${prefix})?0*([0-9]+)$`).exec(raw);
    if (!match) return '';
    const numeric = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(numeric) || numeric < 1) return '';
    return `${prefix}${String(numeric).padStart(4, '0')}`;
  }

  get traySerialPreview(): string {
    return this.normalizeSequentialAssetSerial('T', this.trayForm.serial_number);
  }

  get containerSerialPreview(): string {
    return this.normalizeSequentialAssetSerial('C', this.containerForm.serial_number);
  }

  createTray(): void {
    const input = this.trayForm.serial_number.trim();
    const serial = this.normalizeSequentialAssetSerial('T', input);
    if (!serial) {
      this.error = 'Tray serial must be T followed by digits, for example T0301 or 301.';
      return;
    }

    this.runCreate(
      this.api.createTray({ serial_number: input, blade_count: 0, enabled: true }),
      `Tray ${serial} created.`,
      () => {
        this.trayForm = { serial_number: '' };
        this.loadTrays();
      },
    );
  }

  createContainer(): void {
    const input = this.containerForm.serial_number.trim();
    const serial = this.normalizeSequentialAssetSerial('C', input);
    if (!serial) {
      this.error = 'Container serial must be C followed by digits, for example C0101 or 101.';
      return;
    }

    this.runCreate(
      this.api.createContainer({ serial_number: input, enabled: true }),
      `Container ${serial} created.`,
      () => {
        this.containerForm = { serial_number: '' };
        this.loadContainers();
      },
    );
  }

  toggleTrayEnabled(tray: AdminTrayRow, confirmed = false): void {
    const enabled = !tray.enabled;
    if (!enabled && !confirmed) { this.askDisable(`tray ${tray.serial_number}`, 'Scans of it are refused until it is enabled again.', () => this.toggleTrayEnabled(tray, true)); return; }
    this.runCreate(this.api.updateTray(tray.id, { enabled }), `Tray ${tray.serial_number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadTrays());
  }

  toggleContainerEnabled(container: AdminContainerRow, confirmed = false): void {
    const enabled = !container.enabled;
    if (!enabled && !confirmed) { this.askDisable(`container ${container.serial_number}`, 'Scans of it are refused until it is enabled again.', () => this.toggleContainerEnabled(container, true)); return; }
    this.runCreate(this.api.updateContainer(container.id, { enabled }), `Container ${container.serial_number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadContainers());
  }

  get filteredTrays(): AdminTrayRow[] {
    return this.trays.filter((tray) =>
      this.adminSearchMatches(this.traySearch, [
        tray.serial_number,
        tray.blade_count,
        tray.current_stage?.code,
        tray.current_stage?.name,
        tray.current_location?.serial_number,
        tray.current_container?.serial_number,
        tray.enabled ? 'active' : 'inactive',
      ]),
    );
  }

  get filteredContainers(): AdminContainerRow[] {
    return this.containers.filter((container) =>
      this.adminSearchMatches(this.containerSearch, [
        container.serial_number,
        container.tray_count,
        container.blade_count,
        container.enabled ? 'active' : 'inactive',
      ]),
    );
  }

  get filteredLocations(): AdminLocationRow[] {
    return this.locations.filter((location) =>
      this.adminSearchMatches(this.locationSearch, [
        location.serial_number,
        location.number,
        location.description,
        location.department,
        location.location_type,
        location.summary?.number,
        location.part_type?.code,
        location.tray_count,
        location.blade_count,
        location.enabled ? 'active' : 'inactive',
      ]),
    );
  }

  get filteredCutterBodies(): CutterBodyRow[] {
    return this.cutterBodies.filter((body) =>
      this.adminSearchMatches(this.cutterBodySearch, [
        body.mf_serial_number,
        body.dana_serial_number,
        body.description,
        body.enabled ? 'enabled' : 'disabled',
      ]),
    );
  }

  get locationShelfPreview() {
    return (
      parseCuttergrindRoughShelfTag(this.locationForm.serial_number) ??
      parseCuttergrindNumberedShelfTag(this.locationForm.serial_number) ??
      parseSummaryShelfTag(this.locationForm.serial_number)
    );
  }

  /** A Green Shed summary shelf names its Summary and part type in its barcode, so they are not chosen. */
  get locationContentsFromBarcode(): boolean {
    const serial = this.locationForm.serial_number;
    return !parseCuttergrindRoughShelfTag(serial) && !parseCuttergrindNumberedShelfTag(serial) && !!parseSummaryShelfTag(serial);
  }

  /**
   * One choice per Summary number, without revisions. The location keeps its current pick;
   * otherwise each number offers the revision a shelf barcode would choose (active, then newest).
   */
  get locationSummaryChoices(): PartSummaryRow[] {
    const selectedId = this.locationForm.summary_id;
    const preference = (summary: PartSummaryRow) => [summary.id === selectedId, summary.active] as const;
    const byNumber = new Map<string, PartSummaryRow>();
    for (const summary of this.partSummaries) {
      if (!summary.enabled && summary.id !== selectedId) continue;
      const key = summary.number.trim().toUpperCase();
      const current = byNumber.get(key);
      if (!current) {
        byNumber.set(key, summary);
        continue;
      }
      const [aSelected, aActive] = preference(summary);
      const [bSelected, bActive] = preference(current);
      const better =
        aSelected !== bSelected ? aSelected
        : aActive !== bActive ? aActive
        : summary.revision.localeCompare(current.revision, undefined, { numeric: true }) > 0;
      if (better) byNumber.set(key, summary);
    }
    return [...byNumber.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  }

  /**
   * RING or PINION when the barcode names it (the R or P in GSR, CGDR, CGFP...). The server always
   * sets the part type from it, so it is shown but not chosen.
   */
  get locationBarcodePartType(): string | null {
    return locationPartTypeFromSerial(this.locationForm.serial_number);
  }

  get locationPartTypeChoices(): PartTypeRow[] {
    return this.partTypeChoices.filter((type) => type.enabled || type.id === this.locationForm.part_type_id);
  }

  /** What the location's summary tag reads, such as 1.955FC-RING. Null until both are set. */
  locationSummaryTag(location: AdminLocationRow): string | null {
    return location.summary && location.part_type ? `${location.summary.number}-${location.part_type.code}`.toUpperCase() : null;
  }

  locationShelfDisplay(shelf: CuttergrindRoughShelfTag | CuttergrindNumberedShelfTag | SummaryShelfTag): string {
    if ('position' in shelf) return describeCuttergrindShelfPosition(shelf.position);
    return 'shelfNumber' in shelf
      ? `Shelf ${shelf.shelfNumber}`
      : `Summary ${shelf.summaryNumber}`;
  }

  saveLocation(): void {
    const serialNumber = this.locationForm.serial_number.trim().toUpperCase();
    const numberedShelf = parseCuttergrindRoughShelfTag(serialNumber) ?? parseCuttergrindNumberedShelfTag(serialNumber);
    const shelfTag = numberedShelf ? null : parseSummaryShelfTag(serialNumber);
    const number =
      numberedShelf?.shelfNumber ??
      shelfTag?.summaryNumber ??
      this.locationForm.number.trim();

    if (!serialNumber || !number) {
      this.error = 'Location barcode and location number are required.';
      return;
    }

    const payload = {
      serial_number: serialNumber,
      number,
      description: this.locationForm.description.trim() || null,
      department:
        numberedShelf?.department ?? shelfTag?.department ??
        (this.locationForm.department.trim().toUpperCase() || null),
      location_type:
        numberedShelf?.locationType ?? shelfTag?.locationType ??
        (this.locationForm.location_type.trim().toUpperCase() || 'INTERNAL'),
      enabled: this.locationForm.enabled,
      // A summary shelf's barcode sets both on the server; a barcode with R or P sets the part type.
      ...(shelfTag ? {} : { summary_id: this.locationForm.summary_id || null }),
      ...(shelfTag || locationPartTypeFromSerial(serialNumber) ? {} : { part_type_id: this.locationForm.part_type_id || null }),
    };

    const request = this.editingLocationId
      ? this.api.updateLocation(this.editingLocationId, payload)
      : this.api.createLocation(payload);

    this.runCreate(
      request,
      this.editingLocationId ? 'Location updated.' : 'Location created.',
      () => {
        this.resetLocationForm();
        this.loadLocations();
      },
    );
  }

  beginEditLocation(location: AdminLocationRow): void {
    this.editingLocationId = location.id;
    this.locationForm = {
      serial_number: location.serial_number,
      number: location.number,
      description: location.description || '',
      department: location.department || '',
      location_type: location.location_type || 'INTERNAL',
      enabled: location.enabled,
      summary_id: location.summary_id || '',
      part_type_id: location.part_type_id || '',
    };
    this.clearNotice();
    this.focusEditor();
  }

  cancelLocationEdit(): void {
    this.resetLocationForm();
    this.clearNotice();
    this.cdr.markForCheck();
  }

  toggleLocationEnabled(location: AdminLocationRow, confirmed = false): void {
    const nextEnabled = !location.enabled;
    if (!nextEnabled && !confirmed) { this.askDisable(`location ${location.serial_number}`, 'Trays and cutters can no longer be placed there until it is enabled again.', () => this.toggleLocationEnabled(location, true)); return; }
    this.runCreate(
      this.api.updateLocation(location.id, { enabled: nextEnabled }),
      `Location ${location.serial_number} ${nextEnabled ? 'enabled' : 'disabled'}.`,
      () => this.loadLocations(),
    );
  }

  printTag(
    kind: AssetTagKind,
    recordId: string,
    serialNumber: string,
  ): void {
    if (this.printingTagId) return;
    this.clearNotice();
    // A location's summary tag is printed from the same row as its location tag.
    this.printingTagId = kind === 'LOCATION_SUMMARY' ? `${recordId}:summary` : recordId;
    this.api.printAssetTag(kind, recordId).subscribe({
      next: (result) => {
        this.printingTagId = null;
        if (!result.printed) {
          this.api.downloadAssetTagPrn(result);
        }
        // The page banners read "Saved." and "Unable to continue.", which fit neither a sent tag nor
        // a downloaded one, so the outcome is announced on its own.
        announceAssetTagPrint(this.toast, result);
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.printingTagId = null;
        // Shown once, in the page banner.
        this.error = adminApiErrorText(error) || `Could not print ${serialNumber} tag.`;
        this.cdr.markForCheck();
      },
    });
  }

  /** Opens the location's 4 x 6 label in the browser print dialog. */
  printLocationLabel(location: AdminLocationRow): void {
    this.clearNotice();
    const opened = openLocationLabels([
      {
        serial_number: location.serial_number,
        number: location.number,
        summary: location.summary?.number,
        part_type: location.part_type?.code,
        description: location.description,
        department: location.department,
      },
    ]);
    if (!opened.ok) this.error = opened.reason;
    this.cdr.markForCheck();
  }

  createCutterBody(): void {
    if (!this.cutterBodyForm.mf_serial_number.trim()) { this.error = 'MF / manufacturer serial number is required.'; return; }
    const payload = {
      mf_serial_number: this.cutterBodyForm.mf_serial_number.trim(),
      dana_serial_number: this.cutterBodyForm.dana_serial_number.trim() || null,
      description: this.cutterBodyForm.description.trim() || null,
      definition_id: this.cutterBodyForm.definition_id || null,
    };
    const request = this.editingCutterBodyId
      ? this.api.updateCutterBody(this.editingCutterBodyId, payload)
      : this.api.createCutterBody(payload);
    this.runCreate(request, this.editingCutterBodyId ? 'Cutter body updated.' : 'Cutter body created.', () => {
      this.resetCutterBodyForm(); this.loadCutterBodies();
    });
  }

  beginEditCutterBody(body: CutterBodyRow): void {
    this.editingCutterBodyId = body.id;
    this.cutterBodyForm = { mf_serial_number: body.mf_serial_number || '', dana_serial_number: body.dana_serial_number || '', description: body.description || '', definition_id: body.definition_id || body.definition?.id || '' };
    this.clearNotice(); this.focusEditor();
  }

  cancelCutterBodyEdit(): void { this.resetCutterBodyForm(); this.clearNotice(); this.cdr.markForCheck(); }

  toggleCutterBodyEnabled(body: CutterBodyRow, confirmed = false): void {
    const enabled = !body.enabled;
    if (!enabled && !confirmed) { this.askDisable(`cutter body ${body.dana_serial_number || body.mf_serial_number || ''}`.trim(), 'It can no longer be used for new builds until it is enabled again.', () => this.toggleCutterBodyEnabled(body, true)); return; }
    this.runCreate(this.api.updateCutterBody(body.id, { enabled }), `Cutter body ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadCutterBodies());
  }

  departmentName(departmentId?: string | null): string {
    if (!departmentId) return 'No department';
    return (
      this.departments.find((department) => department.id === departmentId)
        ?.description || 'Unknown department'
    );
  }

  assignDanaSerial(body: CutterBodyRow): void {
    if (body.dana_serial_number) return;
    const dana = (this.danaAssignments[body.id] || '').trim().toUpperCase();
    if (!dana) {
      this.error = 'Enter the etched Dana serial number.';
      return;
    }

    this.runCreate(
      this.api.assignCutterBodyDanaSerial(body.id, dana),
      `Dana serial ${dana} assigned.`,
      () => {
        delete this.danaAssignments[body.id];
        this.loadCutterBodies();
      },
    );
  }

  loadUsers(): void {
    this.usersList.load(allPages((page) => this.api.listUsers(page, 50)));
  }

  loadPartSummaries(): void {
    this.partSummariesList.load(allPages((page) => this.api.listPartSummaries(page, 50)));
  }

  loadPartTypes(): void {
    this.partTypesList.load(this.api.listPartTypes());
  }

  loadParts(): void {
    this.partsList.load(this.api.listParts().pipe(tap((rows) => this.syncRollMasterEdits(rows ?? []))));
  }

  /** `savedPartId`: only that part's typed values are now saved; keep the unsaved edits typed for other parts. */
  loadRollMasters(savedPartId?: string): void {
    this.rollMastersList.load(this.api.listRollMasters().pipe(tap((rows) => {
      if (savedPartId) delete this.rollMasterEdits[savedPartId];
      else this.rollMasterEdits = {};
      this.syncRollMasterEdits(this.parts, rows ?? []);
    })));
  }

  loadModels(): void {
    this.modelsList.load(this.api.listModels());
  }

  loadDepartments(): void {
    this.departmentsList.load(this.api.listDepartments());
  }

  loadMachines(): void {
    this.machinesList.load(this.api.listMachines());
  }

  loadTrays(): void {
    this.traysList.load(allPages((page) => this.api.listTrays(page, 50)));
  }

  loadContainers(): void {
    this.containersList.load(allPages((page) => this.api.listContainers(page, 50)));
  }

  /** The bulk shelf panel made locations: show them in the list. */
  reloadLocations(): void {
    this.loadLocations();
  }

  loadLocations(): void {
    this.locationsList.load(allPages((page) => this.api.listLocations(page, 50)));
  }

  loadSummaryBodyRules(): void {
    this.summaryBodyRulesList.load(this.api.listSummaryBodyRules().pipe(
      map((rows) => new Map((rows ?? []).map((row) => [row.summary_id, row]))),
    ));
  }

  loadSummarySettings(): void {
    this.summarySettingsList.load(this.api.listPartSummarySettings().pipe(
      map((rows) => new Map((rows ?? []).map((row) => [row.summary_id, row]))),
    ));
  }

  loadCutterBodies(): void {
    this.cutterBodiesList.load(this.api.listCutterBodies());
  }

  loadCutterBodyDefinitions(): void {
    this.cutterBodyDefinitionsList.load(this.api.listCutterBodyDefinitions());
  }

  private resetUserForm(): void {
    this.editingUserId = null;
    this.userForm = { email: '', password: '', firstName: '', lastName: '', role: 'user', departmentId: '' };
  }

  private resetPartSummaryForm(): void {
    this.editingPartSummaryId = null;
    this.summaryForm = { number: '', revision: '', model_id: '', hos: '' };
    this.summaryTypeForm = this.emptySummaryTypeForm();
    this.summaryBodyRuleChoice = 'KEEP';
  }

  private resetMachineForm(): void {
    this.editingMachineId = null;
    this.machineForm = { machine_number: '', department_id: '', cell: null, description: '', machine_type: 'PRODUCTION' };
  }

  private resetCutterBodyForm(): void {
    this.editingCutterBodyId = null;
    this.cutterBodyForm = { mf_serial_number: '', dana_serial_number: '', description: '', definition_id: '' };
  }

  private resetLocationForm(): void {
    this.editingLocationId = null;
    this.locationForm = {
      serial_number: '',
      number: '',
      description: '',
      department: '',
      location_type: 'INTERNAL',
      enabled: true,
      summary_id: '',
      part_type_id: '',
    };
  }

  private runCreate(
    request: Observable<unknown>,
    successMessage: string,
    onSuccess: () => void,
  ): void {
    if (this.busy) return;
    this.busy = true;
    this.clearNotice();
    request.subscribe({
      next: () => {
        this.busy = false;
        this.message = successMessage;
        onSuccess();
        this.cdr.markForCheck();
      },
      // Shown once, in the banner beside the form; the typed draft is kept.
      error: (error: HttpErrorResponse) => {
        this.busy = false;
        this.error = this.errorMessage(error);
        this.cdr.markForCheck();
      },
    });
  }

  private errorMessage(error: HttpErrorResponse): string {
    return adminApiErrorText(error);
  }

  private clearNotice(): void {
    this.message = '';
    this.error = '';
  }
}
