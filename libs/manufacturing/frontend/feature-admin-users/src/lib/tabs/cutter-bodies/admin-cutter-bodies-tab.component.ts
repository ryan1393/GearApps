import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaToneDirective } from '@dana/ui';
import { CutterBodyRuleResolution, resolveCutterBodyRule } from '@meshforge/manufacturing/shared/util-constants';

import { CutterBodyDefinitionRow, CutterBodyRow } from '../../admin-api.service';
import { AdminFeedbackComponent } from '../../shared/admin-feedback.component';
import { AdminListStateComponent } from '../../shared/admin-list-state.component';
import { AdminTabBase } from '../../shared/admin-tab-base';

/** Admin > Cutter Bodies: bodies by MF and Dana serial, their definition and decoded body rule. */
@Component({
  selector: 'gear-admin-cutter-bodies-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaToneDirective, AdminFeedbackComponent, AdminListStateComponent],
  templateUrl: './admin-cutter-bodies-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
})
export class AdminCutterBodiesTabComponent extends AdminTabBase implements OnInit {
  readonly cutterBodiesList = this.list<CutterBodyRow[]>([]);
  readonly cutterBodyDefinitionsList = this.list<CutterBodyDefinitionRow[]>([]);
  get cutterBodies(): CutterBodyRow[] { return this.cutterBodiesList.value(); }
  get cutterBodyDefinitions(): CutterBodyDefinitionRow[] { return this.cutterBodyDefinitionsList.value(); }

  cutterBodySearch = '';
  editingCutterBodyId: string | null = null;
  danaAssignments: Record<string, string | undefined> = {};
  cutterBodyForm = { mf_serial_number: '', dana_serial_number: '', description: '', definition_id: '' };

  ngOnInit(): void {
    this.choiceLists = { 'cutter body definitions': this.cutterBodyDefinitionsList };
    this.loadCutterBodies();
    this.loadCutterBodyDefinitions();
  }

  retryChoices(): void { this.loadCutterBodyDefinitions(); }

  loadCutterBodies(): void { this.cutterBodiesList.load(this.api.listCutterBodies()); }
  loadCutterBodyDefinitions(): void { this.cutterBodyDefinitionsList.load(this.api.listCutterBodyDefinitions()); }

  /** Read-only decode of a cutter body's Dana S/N (never its MF serial). */
  cutterBodyDecode(body: CutterBodyRow): CutterBodyRuleResolution {
    return resolveCutterBodyRule(body);
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
    this.runSave(request, this.editingCutterBodyId ? 'Cutter body updated.' : 'Cutter body created.', () => {
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
    this.runSave(this.api.updateCutterBody(body.id, { enabled }), `Cutter body ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadCutterBodies());
  }

  assignDanaSerial(body: CutterBodyRow): void {
    if (body.dana_serial_number) return;
    const dana = (this.danaAssignments[body.id] || '').trim().toUpperCase();
    if (!dana) {
      this.error = 'Enter the etched Dana serial number.';
      return;
    }
    this.runSave(
      this.api.assignCutterBodyDanaSerial(body.id, dana),
      `Dana serial ${dana} assigned.`,
      () => {
        delete this.danaAssignments[body.id];
        this.loadCutterBodies();
      },
    );
  }

  get filteredCutterBodies(): CutterBodyRow[] {
    return this.cutterBodies.filter((body) =>
      this.matches(this.cutterBodySearch, [
        body.mf_serial_number,
        body.dana_serial_number,
        body.description,
        body.enabled ? 'enabled' : 'disabled',
      ]),
    );
  }

  private resetCutterBodyForm(): void {
    this.editingCutterBodyId = null;
    this.cutterBodyForm = { mf_serial_number: '', dana_serial_number: '', description: '', definition_id: '' };
  }
}
