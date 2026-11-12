import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaToneDirective } from '@dana/ui';

import { PartRow, PartSummaryRow, PartTypeRow } from '../../admin-api.service';
import { allPages } from '../../shared/admin-data';
import { AdminFeedbackComponent } from '../../shared/admin-feedback.component';
import { AdminListStateComponent } from '../../shared/admin-list-state.component';
import { AdminTabBase } from '../../shared/admin-tab-base';

/** Admin > Parts: production part numbers with their Summary, Part Type and teeth. */
@Component({
  selector: 'gear-admin-parts-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaToneDirective, AdminFeedbackComponent, AdminListStateComponent],
  templateUrl: './admin-parts-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
})
export class AdminPartsTabComponent extends AdminTabBase implements OnInit {
  readonly partsList = this.list<PartRow[]>([]);
  readonly partSummariesList = this.list<PartSummaryRow[]>([]);
  readonly partTypesList = this.list<PartTypeRow[]>([]);
  get parts(): PartRow[] { return this.partsList.value(); }
  get partSummaries(): PartSummaryRow[] { return this.partSummariesList.value(); }
  get partTypes(): PartTypeRow[] { return this.partTypesList.value(); }

  partSearch = '';
  editingPartId: string | null = null;
  partForm: { part_number: string; summary_id: string; part_type_id: string; teeth: number | null } = {
    part_number: '', summary_id: '', part_type_id: '', teeth: null,
  };

  ngOnInit(): void {
    this.choiceLists = { 'Part Summaries': this.partSummariesList, 'Part Types': this.partTypesList };
    this.loadParts();
    this.loadPartSummaries();
    this.loadPartTypes();
  }

  retryChoices(): void {
    if (this.partSummariesList.error() !== null) this.loadPartSummaries();
    if (this.partTypesList.error() !== null) this.loadPartTypes();
  }

  loadParts(): void { this.partsList.load(this.api.listParts()); }
  loadPartSummaries(): void { this.partSummariesList.load(allPages((page) => this.api.listPartSummaries(page, 50))); }
  loadPartTypes(): void { this.partTypesList.load(this.api.listPartTypes()); }

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
    this.runSave(
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
    this.partForm = { part_number: part.part_number, summary_id: part.summary_id, part_type_id: part.part_type_id, teeth: part.teeth };
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

  togglePartEnabled(part: PartRow, confirmed = false): void {
    const enabled = !part.enabled;
    if (!enabled && !confirmed) { this.askDisable(`part ${part.part_number}`, 'It can no longer be chosen for new work until it is enabled again.', () => this.togglePartEnabled(part, true)); return; }
    this.runSave(this.api.updatePart(part.id, { enabled, active: enabled }), `Part ${part.part_number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadParts());
  }

  get filteredParts(): PartRow[] {
    return this.parts.filter((part) =>
      this.matches(this.partSearch, [
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

  private resetPartForm(): void {
    this.editingPartId = null;
    this.partForm = { part_number: '', summary_id: '', part_type_id: '', teeth: null };
  }
}
