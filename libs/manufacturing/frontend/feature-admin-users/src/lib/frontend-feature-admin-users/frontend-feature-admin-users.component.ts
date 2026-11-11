import { MachineDsfCountComponent } from '@meshforge/manufacturing/frontend/util-common';
import {
  CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  DestroyRef,
  Component,
  inject,
  OnInit,
  } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { GearLabelPrinterPickerComponent, GearToastService, announceAssetTagPrint } from '@meshforge/manufacturing/frontend/util-common';
import { Observable } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import {
  CuttergrindNumberedShelfTag,
  CuttergrindRoughShelfTag,
  parseCuttergrindRoughShelfTag,
  parseCuttergrindNumberedShelfTag,
  describeCuttergrindShelfPosition,
  parseSummaryShelfTag,
  SummaryShelfTag,
} from '@meshforge/manufacturing/shared/util-constants';
import {
  AdminApiService,
  AdminLocationRow,
  AdminUser,
  CutterBodyRow,
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
import { LappingGearsetsComponent } from '../lapping/lapping-gearsets.component';
import { LappingMachinesComponent } from '../lapping/lapping-machines.component';
import {
  DanaPageHeaderComponent,
  DanaToneDirective,
} from '@dana/ui';

import { CycleTestsPageComponent, ScannersPageComponent, MacrosPageComponent, FanucVariablesPageComponent, CollectorTokensPageComponent } from '@meshforge/client/feature-config';

type AdminTab = 'cycle-tests' | 'scanners' | 'macros' | 'fanuc-variables' | 'collector-tokens' | 'users' | 'part-summaries' | 'parts' | 'gearsets' | 'roll-masters' | 'models' | 'machines' | 'lapping-machines' | 'dsf-mappings' | 'label-printers' | 'coater-rpa' | 'launch' | 'server-settings' | 'trays' | 'containers' | 'locations' | 'cutter-bodies';
// Every tab, for ?tab= deep links; `satisfies` keeps it in step with AdminTab.
const ADMIN_TABS = ['cycle-tests', 'scanners', 'macros', 'fanuc-variables', 'collector-tokens', 'users', 'part-summaries', 'parts', 'gearsets', 'roll-masters', 'models', 'machines', 'lapping-machines', 'dsf-mappings', 'label-printers', 'coater-rpa', 'launch', 'server-settings', 'trays', 'containers', 'locations', 'cutter-bodies'] as const satisfies readonly AdminTab[];
const isAdminTab = (value: unknown): value is AdminTab => ADMIN_TABS.includes(value as AdminTab);

@Component({
  selector: 'gear-admin-users-page',
  standalone: true,
  imports: [CoaterRpaSetupComponent, LaunchSetupComponent, DanaToneDirective, MachineDsfCountComponent,CycleTestsPageComponent, ScannersPageComponent, MacrosPageComponent, FanucVariablesPageComponent, CollectorTokensPageComponent, CommonModule, FormsModule, DanaPageHeaderComponent, DsfMachineMappingsComponent, LabelPrintersComponent, ServerSettingsComponent, GearLabelPrinterPickerComponent, LappingGearsetsComponent, LappingMachinesComponent],
  templateUrl: './frontend-feature-admin-users.component.html',
  styleUrls: ['./frontend-feature-admin-users.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FrontendFeatureAdminUsersComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(AdminApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly toast = inject(GearToastService);
  readonly session = inject(AuthSessionService);
  // Optional so the page also renders outside a router (component tests).
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });

  activeTab: AdminTab = 'users';
  busy = false;
  message = '';
  error = '';

  users: AdminUser[] = [];
  partSummaries: PartSummaryRow[] = [];
  partTypes: PartTypeRow[] = [];
  parts: PartRow[] = [];
  rollMasters: RollMasterRow[] = [];
  models: ModelRow[] = [];
  departments: DepartmentRow[] = [];
  machines: MachineRow[] = [];
  trays: AdminTrayRow[] = [];
  containers: AdminContainerRow[] = [];
  locations: AdminLocationRow[] = [];
  cutterBodies: CutterBodyRow[] = [];
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
    model_number: number | null;
    model_type: string;
  } = {
    model_number: null,
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
  };

  ngOnInit(): void {
    // ?tab= deep links, e.g. the old Lapping master-data pages redirect to /admin?tab=gearsets.
    const requested = this.route?.snapshot.queryParamMap.get('tab');
    if (isAdminTab(requested)) this.activeTab = requested;
    this.route?.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const tab = params.get('tab');
      if (isAdminTab(tab)) { this.activeTab = tab; this.cdr.markForCheck(); }
    });
    this.refreshAll();
  }

  /** Two enabled models with one number are usually the same model entered with and without a type. */
  modelSharesNumber(model: { id: string; model_number?: number | null; enabled?: boolean }): boolean {
    return model.model_number != null && model.enabled !== false
      && this.models.some(other => other.id !== model.id && other.enabled !== false && other.model_number === model.model_number);
  }

  /** A tab asked for by name from another Admin page; unknown names are ignored. */
  openTabByName(tab: string): void {
    if (isAdminTab(tab)) this.setTab(tab);
  }

  setTab(tab: AdminTab): void {
    this.activeTab = tab;
    this.clearNotice();
    if (this.route && this.router) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { tab }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  createUser(): void {
    const email = this.userForm.email.trim();
    if (this.editingUserId ? !this.userForm.departmentId : (!email || !this.userForm.departmentId || !this.userForm.password)) {
      this.error = this.editingUserId
        ? 'Department is required.'
        : 'Email, password, and department are required.';
      return;
    }
    if (this.editingUserId && this.isSelf(this.editingUserId) && this.userForm.role !== 'admin') {
      this.error = 'You cannot remove your own administrator role. Ask another administrator.';
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
      role: user.role || 'user', departmentId: user.departmentId || '',
    };
    this.clearNotice(); this.cdr.markForCheck();
  }

  cancelUserEdit(): void { this.resetUserForm(); this.clearNotice(); this.cdr.markForCheck(); }

  /** The signed-in administrator's own account: it cannot be disabled or demoted from here. */
  isSelf(userId: string): boolean { return this.session.currentUser?.sub === userId; }

  toggleUserEnabled(user: AdminUser): void {
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
    // Active/enabled are set on create only; an edit must not silently re-enable a disabled record.
    const request = this.editingPartSummaryId
      ? this.api.updatePartSummary(this.editingPartSummaryId, payload)
      : this.api.createPartSummary({ ...payload, active: true, enabled: true });
    this.runCreate(request, this.editingPartSummaryId ? 'Part Summary updated.' : 'Part Summary created.', () => {
      this.resetPartSummaryForm(); this.loadPartSummaries();
    });
  }

  beginEditPartSummary(summary: PartSummaryRow): void {
    this.editingPartSummaryId = summary.id;
    this.summaryForm = { number: summary.number, revision: summary.revision || '', model_id: summary.model_id || '', hos: summary.hos || '' };
    this.clearNotice(); this.cdr.markForCheck();
  }

  cancelPartSummaryEdit(): void { this.resetPartSummaryForm(); this.clearNotice(); this.cdr.markForCheck(); }

  togglePartSummaryEnabled(summary: PartSummaryRow): void {
    const enabled = !summary.enabled;
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
    this.clearNotice(); this.cdr.markForCheck();
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

  togglePartEnabled(part: PartRow): void {
    const enabled = !part.enabled;
    this.runCreate(this.api.updatePart(part.id, { enabled, active: enabled }), `Part ${part.part_number} ${enabled ? 'enabled' : 'disabled'}.`, () => { this.loadParts(); this.loadRollMasters(); });
  }

  createModel(): void {
    if (this.modelForm.model_number == null && !this.modelForm.model_type.trim()) {
      this.error = 'Model number or model type is required.';
      return;
    }

    this.runCreate(
      this.api.createModel({
        model_number: this.modelForm.model_number,
        model_type: this.modelForm.model_type.trim() || null,
        active: true,
      }),
      'Model created.',
      () => {
        this.modelForm = { model_number: null, model_type: '' };
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
    this.clearNotice(); this.cdr.markForCheck();
  }

  cancelMachineEdit(): void { this.resetMachineForm(); this.clearNotice(); this.cdr.markForCheck(); }

  toggleMachineEnabled(machine: MachineRow): void {
    const enabled = !machine.enabled;
    this.runCreate(this.api.updateMachine(machine.id, { enabled, active: enabled }), `Machine ${machine.machine_number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadMachines());
  }

  private adminSearchMatches(searchText: string, values: unknown[]): boolean {
    const search = searchText.trim().toUpperCase();
    if (!search) return true;

    return values
      .filter((value) => value !== null && value !== undefined && String(value).trim())
      .join(' ')
      .toUpperCase()
      .includes(search);
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
    if (!this.rollMasterEdits[part.id]) {
      const configured = this.rollMasters.find((row) => row.part_id === part.id) ?? part.roll_master ?? null;
      this.rollMasterEdits[part.id] = {
        current_quantity: configured?.current_quantity ?? 0,
        minimum_quantity: configured?.minimum_quantity ?? configured?.required_count ?? 0,
      };
    }
    return this.rollMasterEdits[part.id];
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

  toggleTrayEnabled(tray: AdminTrayRow): void {
    const enabled = !tray.enabled;
    this.runCreate(this.api.updateTray(tray.id, { enabled }), `Tray ${tray.serial_number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadTrays());
  }

  toggleContainerEnabled(container: AdminContainerRow): void {
    const enabled = !container.enabled;
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

  get locationSummaryChoices(): PartSummaryRow[] {
    return this.partSummaries
      .filter((summary) => summary.enabled || summary.id === this.locationForm.summary_id)
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }) || a.revision.localeCompare(b.revision));
  }

  get locationPartTypeChoices(): PartTypeRow[] {
    return this.partTypeChoices.filter((type) => type.enabled || type.id === this.locationForm.part_type_id);
  }

  /** What the location's summary tag reads, such as 1.955FC-RING. Null until both are set. */
  locationSummaryTag(location: AdminLocationRow): string | null {
    return location.summary && location.part_type ? `${location.summary.number}-${location.part_type.code}`.toUpperCase() : null;
  }

  locationShelfDisplay(shelf: CuttergrindRoughShelfTag | CuttergrindNumberedShelfTag | SummaryShelfTag): string {
    if ('position' in shelf && shelf.position) return describeCuttergrindShelfPosition(shelf.position);
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
      // A summary shelf's barcode sets these on the server.
      ...(shelfTag
        ? {}
        : { summary_id: this.locationForm.summary_id || null, part_type_id: this.locationForm.part_type_id || null }),
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
    this.cdr.markForCheck();
  }

  cancelLocationEdit(): void {
    this.resetLocationForm();
    this.clearNotice();
    this.cdr.markForCheck();
  }

  toggleLocationEnabled(location: AdminLocationRow): void {
    const nextEnabled = !location.enabled;
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
        this.error = adminApiErrorText(error);
        if (!this.error) {
          this.error = `Could not print ${serialNumber} tag.`;
        }
        this.toast.error(this.error, 'Tag not printed');
        this.cdr.markForCheck();
      },
    });
  }

  createCutterBody(): void {
    if (!this.cutterBodyForm.mf_serial_number.trim()) { this.error = 'MF / manufacturer serial number is required.'; return; }
    const payload = {
      mf_serial_number: this.cutterBodyForm.mf_serial_number.trim(),
      dana_serial_number: this.cutterBodyForm.dana_serial_number.trim() || null,
      description: this.cutterBodyForm.description.trim() || null,
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
    this.cutterBodyForm = { mf_serial_number: body.mf_serial_number || '', dana_serial_number: body.dana_serial_number || '', description: body.description || '' };
    this.clearNotice(); this.cdr.markForCheck();
  }

  cancelCutterBodyEdit(): void { this.resetCutterBodyForm(); this.clearNotice(); this.cdr.markForCheck(); }

  toggleCutterBodyEnabled(body: CutterBodyRow): void {
    const enabled = !body.enabled;
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

  private refreshAll(): void {
    this.loadUsers();
    this.loadModels();
    this.loadDepartments();
    this.loadPartSummaries();
    this.loadPartTypes();
    this.loadParts();
    this.loadRollMasters();
    this.loadMachines();
    this.loadTrays();
    this.loadContainers();
    this.loadLocations();
    this.loadCutterBodies();
  }

  private loadUsers(page = 1, accumulated: AdminUser[] = []): void {
    this.api.listUsers(page, 50).subscribe({
        next: (response) => {
          const rows = response.data ?? [];
          const combined = [...accumulated, ...rows];
          if (response.meta?.hasNextPage) {
            this.loadUsers(page + 1, combined);
            return;
          }
          this.users = combined;
          this.cdr.markForCheck();
        },
        error: (error) => this.handleLoadError(error),
      });
  }

  private loadPartSummaries(
    page = 1,
    accumulated: PartSummaryRow[] = [],
  ): void {
    this.api.listPartSummaries(page, 50).subscribe({
        next: (response) => {
          const rows = response.data ?? [];
          const combined = [...accumulated, ...rows];
          if (response.meta?.hasNextPage) {
            this.loadPartSummaries(page + 1, combined);
            return;
          }
          this.partSummaries = combined;
          this.cdr.markForCheck();
        },
        error: (error) => this.handleLoadError(error),
      });
  }

  private loadPartTypes(): void {
    this.api.listPartTypes().subscribe({
      next: (rows) => {
        this.partTypes = rows ?? [];
        this.cdr.markForCheck();
      },
      error: (error) => this.handleLoadError(error),
    });
  }

  private loadParts(): void {
    this.api.listParts().subscribe({
      next: (rows) => {
        this.parts = rows ?? [];
        this.cdr.markForCheck();
      },
      error: (error) => this.handleLoadError(error),
    });
  }

  /** `savedPartId`: only that part's typed values are now saved; keep the unsaved edits typed for other parts. */
  private loadRollMasters(savedPartId?: string): void {
    this.api.listRollMasters().subscribe({
      next: (rows) => {
        this.rollMasters = rows ?? [];
        if (savedPartId) delete this.rollMasterEdits[savedPartId];
        else this.rollMasterEdits = {};
        this.cdr.markForCheck();
      },
      error: (error) => this.handleLoadError(error),
    });
  }

  private loadModels(): void {
    this.api.listModels().subscribe({
      next: (rows) => {
        this.models = rows ?? [];
        this.cdr.markForCheck();
      },
      error: (error) => this.handleLoadError(error),
    });
  }

  private loadDepartments(): void {
    this.api.listDepartments().subscribe({
        next: (rows) => {
          this.departments = rows ?? [];
          this.cdr.markForCheck();
        },
        error: (error) => this.handleLoadError(error),
      });
  }

  private loadMachines(): void {
    this.api.listMachines().subscribe({
      next: (rows) => {
        this.machines = rows ?? [];
        this.cdr.markForCheck();
      },
      error: (error) => this.handleLoadError(error),
    });
  }

  private loadTrays(
    page = 1,
    accumulated: AdminTrayRow[] = [],
  ): void {
    this.api.listTrays(page, 50).subscribe({
      next: (response) => {
        const rows = response.data ?? [];
        const combined = [...accumulated, ...rows];
        if (response.meta?.hasNextPage) {
          this.loadTrays(page + 1, combined);
          return;
        }
        this.trays = combined;
        this.cdr.markForCheck();
      },
      error: (error) => this.handleLoadError(error),
    });
  }

  private loadContainers(
    page = 1,
    accumulated: AdminContainerRow[] = [],
  ): void {
    this.api.listContainers(page, 50).subscribe({
      next: (response) => {
        const rows = response.data ?? [];
        const combined = [...accumulated, ...rows];
        if (response.meta?.hasNextPage) {
          this.loadContainers(page + 1, combined);
          return;
        }
        this.containers = combined;
        this.cdr.markForCheck();
      },
      error: (error) => this.handleLoadError(error),
    });
  }

  private loadLocations(
    page = 1,
    accumulated: AdminLocationRow[] = [],
  ): void {
    this.api.listLocations(page, 50).subscribe({
      next: (response) => {
        const rows = response.data ?? [];
        const combined = [...accumulated, ...rows];
        if (response.meta?.hasNextPage) {
          this.loadLocations(page + 1, combined);
          return;
        }
        this.locations = combined;
        this.cdr.markForCheck();
      },
      error: (error) => this.handleLoadError(error),
    });
  }

  private loadCutterBodies(): void {
    this.api.listCutterBodies().subscribe({
        next: (rows) => {
          this.cutterBodies = rows ?? [];
          this.cdr.markForCheck();
        },
        error: (error) => this.handleLoadError(error),
      });
  }

  private resetUserForm(): void {
    this.editingUserId = null;
    this.userForm = { email: '', password: '', firstName: '', lastName: '', role: 'user', departmentId: '' };
  }

  private resetPartSummaryForm(): void {
    this.editingPartSummaryId = null;
    this.summaryForm = { number: '', revision: '', model_id: '', hos: '' };
  }

  private resetMachineForm(): void {
    this.editingMachineId = null;
    this.machineForm = { machine_number: '', department_id: '', cell: null, description: '', machine_type: 'PRODUCTION' };
  }

  private resetCutterBodyForm(): void {
    this.editingCutterBodyId = null;
    this.cutterBodyForm = { mf_serial_number: '', dana_serial_number: '', description: '' };
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
    this.busy = true;
    this.clearNotice();
    request.subscribe({
      next: () => {
        this.busy = false;
        this.message = '';
        this.toast.success(successMessage, 'Saved');
        onSuccess();
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.busy = false;
        const message = this.errorMessage(error);
        this.error = '';
        this.toast.error(message, 'Save failed');
        this.cdr.markForCheck();
      },
    });
  }

  private handleLoadError(error: HttpErrorResponse): void {
    if (!this.error) {
      this.error = this.errorMessage(error);
    }
    this.cdr.markForCheck();
  }

  private errorMessage(error: HttpErrorResponse): string {
    return adminApiErrorText(error);
  }

  private clearNotice(): void {
    this.message = '';
    this.error = '';
  }
}
