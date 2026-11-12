import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaToneDirective } from '@dana/ui';
import { tap } from 'rxjs';

import { PartRow, RollMasterRow } from '../../admin-api.service';
import { AdminFeedbackComponent } from '../../shared/admin-feedback.component';
import { AdminListStateComponent } from '../../shared/admin-list-state.component';
import { AdminTabBase } from '../../shared/admin-tab-base';

type RollMasterEdit = { current_quantity: number; minimum_quantity: number };

/** Admin > Roll Master: current and minimum Roll Master quantity per part. */
@Component({
  selector: 'gear-admin-roll-masters-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaToneDirective, AdminFeedbackComponent, AdminListStateComponent],
  templateUrl: './admin-roll-masters-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
})
export class AdminRollMastersTabComponent extends AdminTabBase implements OnInit {
  readonly partsList = this.list<PartRow[]>([]);
  readonly rollMastersList = this.list<RollMasterRow[]>([]);
  get parts(): PartRow[] { return this.partsList.value(); }
  get rollMasters(): RollMasterRow[] { return this.rollMastersList.value(); }

  rollMasterSearch = '';
  /** Typed quantities per part, created when parts or Roll Masters load (never while rendering). */
  rollMasterEdits: Record<string, RollMasterEdit> = {};

  ngOnInit(): void {
    this.loadParts();
    this.loadRollMasters();
  }

  // Roll Master quantities report their own failure in the list.
  retryChoices(): void { this.loadRollMasters(); }

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

  get filteredRollMasterParts(): PartRow[] {
    return this.parts.filter((part) => this.matches(this.rollMasterSearch, [
      part.part_number, part.summary?.number, part.part_type?.code,
      part.roll_master?.current_quantity ?? 0, part.roll_master?.minimum_quantity ?? part.roll_master?.required_count ?? 0,
    ]));
  }

  rollMasterEdit(part: PartRow): RollMasterEdit {
    return this.rollMasterEdits[part.id] ?? this.rollMasterDefaults(part);
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
    this.runSave(this.api.updateRollMaster(record.id, { enabled, active: enabled }), `Roll Master for ${part.part_number} ${enabled ? 'enabled' : 'disabled'}.`, () => { this.loadRollMasters(); this.loadParts(); });
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
    this.runSave(request, `Roll Master quantity saved for ${part.part_number}.`, () => { this.loadRollMasters(part.id); this.loadParts(); });
  }

  private rollMasterDefaults(part: PartRow, rollMasters = this.rollMasters): RollMasterEdit {
    const configured = rollMasters.find((row) => row.part_id === part.id) ?? part.roll_master ?? null;
    return {
      current_quantity: configured?.current_quantity ?? 0,
      minimum_quantity: configured?.minimum_quantity ?? configured?.required_count ?? 0,
    };
  }

  /** Gives every part an editable quantity; typed values that have not been saved are kept. */
  private syncRollMasterEdits(parts = this.parts, rollMasters = this.rollMasters): void {
    const edits: Record<string, RollMasterEdit> = {};
    for (const part of parts) edits[part.id] = this.rollMasterEdits[part.id] ?? this.rollMasterDefaults(part, rollMasters);
    this.rollMasterEdits = edits;
  }
}
