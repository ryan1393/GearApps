import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaToneDirective } from '@dana/ui';
import { CUTTER_BODY_RULES, KNOWN_BLADE_LABELS, normalizeBladeLabel } from '@meshforge/manufacturing/shared/util-constants';
import { IPartSummarySettings, ISavePartSummaryRequest, ISummaryBodyRuleRow, ISummaryPartTypeSettings } from '@meshforge/manufacturing/shared/util-types';
import { map } from 'rxjs';

import { adminApiErrorText, ModelRow, PartSummaryRow } from '../../admin-api.service';
import { allPages } from '../../shared/admin-data';
import { AdminFeedbackComponent } from '../../shared/admin-feedback.component';
import { AdminListStateComponent } from '../../shared/admin-list-state.component';
import { AdminTabBase } from '../../shared/admin-tab-base';
import { modelLabel } from '../../shared/admin-labels';

type SummaryTypeForm = Record<'RING' | 'PINION', { hos: string; inner_blade: string; outer_blade: string }>;
type SummaryFields = { number: string; revision: string; model_id: string | null; hos: string | null };

/** Admin > Part Summaries: Summary numbers, their RING/PINION blade settings and Body Size rule. */
@Component({
  selector: 'gear-admin-part-summaries-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaToneDirective, AdminFeedbackComponent, AdminListStateComponent],
  templateUrl: './admin-part-summaries-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
})
export class AdminPartSummariesTabComponent extends AdminTabBase implements OnInit {
  readonly partSummariesList = this.list<PartSummaryRow[]>([]);
  readonly modelsList = this.list<ModelRow[]>([]);
  /** Summary Body Size Rules keyed by Summary id; the rule controls the read-only Required Blades. */
  readonly summaryBodyRulesList = this.list(new Map<string, ISummaryBodyRuleRow>());
  /** RING/PINION HOS, Inner blade and Outer blade of each Summary (blank when not set). */
  readonly summarySettingsList = this.list(new Map<string, IPartSummarySettings>());
  get partSummaries(): PartSummaryRow[] { return this.partSummariesList.value(); }
  get models(): ModelRow[] { return this.modelsList.value(); }
  get summaryBodyRules(): Map<string, ISummaryBodyRuleRow> { return this.summaryBodyRulesList.value(); }
  get summarySettings(): Map<string, IPartSummarySettings> { return this.summarySettingsList.value(); }

  readonly summaryPartTypes = ['RING', 'PINION'] as const;
  readonly knownBladeLabels: readonly string[] = KNOWN_BLADE_LABELS;
  readonly cutterBodyRules = CUTTER_BODY_RULES;
  readonly modelLabel = modelLabel;
  /** Edit Part Summary draft: both Part Type groups and the Body Size choice ('KEEP' keeps the mapping). */
  summaryTypeForm: SummaryTypeForm = this.emptySummaryTypeForm();
  summaryBodyRuleChoice = 'KEEP';
  partSummarySearch = '';
  editingPartSummaryId: string | null = null;
  summaryForm = { number: '', revision: '', model_id: '', hos: '' };

  ngOnInit(): void {
    this.choiceLists = { models: this.modelsList, 'Body Size Rules': this.summaryBodyRulesList, 'Part Summary settings': this.summarySettingsList };
    this.loadPartSummaries();
    this.loadModels();
    this.loadSummaryBodyRules();
    this.loadSummarySettings();
  }

  retryChoices(): void {
    if (this.modelsList.error() !== null) this.loadModels();
    if (this.summaryBodyRulesList.error() !== null) this.loadSummaryBodyRules();
    if (this.summarySettingsList.error() !== null) this.loadSummarySettings();
  }

  loadPartSummaries(): void {
    this.partSummariesList.load(allPages((page) => this.api.listPartSummaries(page, 50)));
  }

  loadModels(): void { this.modelsList.load(this.api.listModels()); }

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

  createPartSummary(): void {
    const number = this.summaryForm.number.trim();
    if (!number) { this.error = 'Part Summary number is required.'; return; }
    const payload = {
      number, revision: this.summaryForm.revision.trim(), model_id: this.summaryForm.model_id || null,
      hos: this.summaryForm.hos.trim() || null,
    };
    if (this.editingPartSummaryId) { this.savePartSummary(this.editingPartSummaryId, payload); return; }
    // Active/enabled are set on create only; an edit must not silently re-enable a disabled record.
    this.runSave(this.api.createPartSummary({ ...payload, active: true, enabled: true }), 'Part Summary created.', () => {
      this.resetPartSummaryForm(); this.loadPartSummaries(); this.loadSummaryBodyRules(); this.loadSummarySettings();
    });
  }

  /**
   * Save Part Summary: Summary fields, both RING/PINION groups and any Body Size change go in ONE
   * request and one transaction. On failure nothing is saved and the draft stays in the form.
   */
  private savePartSummary(summaryId: string, summaryFields: SummaryFields, confirmed = false): void {
    if (this.busy) return;
    const body: ISavePartSummaryRequest = { ...summaryFields, part_types: {} };
    const partTypes: NonNullable<ISavePartSummaryRequest['part_types']> = {};
    for (const code of this.summaryPartTypes) {
      const group = this.summaryTypeForm[code];
      // Every field is sent: an untouched field resends its current value; a blank clears it.
      partTypes[code] = { hos: group.hos || null, inner_blade: normalizeBladeLabel(group.inner_blade), outer_blade: normalizeBladeLabel(group.outer_blade) };
    }
    body.part_types = partTypes;
    const current = this.summaryBodyRules.get(summaryId) ?? null;
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
      error: (error: HttpErrorResponse) => { this.busy = false; this.error = `Nothing was changed. ${adminApiErrorText(error)}`; this.cdr.markForCheck(); },
    });
  }

  private emptySummaryTypeForm(): SummaryTypeForm {
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
    const current = this.summaryBodyRules.get(this.editingPartSummaryId) ?? null;
    if (this.summaryBodyRuleChoice === 'KEEP') {
      return current?.required_total_blades != null ? `${current.required_total_blades} blades (${current.required_blade_sets} sets) — current` : 'Unchanged';
    }
    const rule = CUTTER_BODY_RULES.find((r) => r.code === this.summaryBodyRuleChoice);
    return rule ? `${rule.total_blades} blades (${rule.blade_sets} sets) — ${rule.label}` : 'Rule removed; quantities stay as they are';
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

  togglePartSummaryEnabled(summary: PartSummaryRow, confirmed = false): void {
    const enabled = !summary.enabled;
    if (!enabled && !confirmed) { this.askDisable(`Part Summary ${summary.number}`, 'Parts, locations and new work can no longer choose it until it is enabled again.', () => this.togglePartSummaryEnabled(summary, true)); return; }
    this.runSave(this.api.updatePartSummary(summary.id, { enabled, active: enabled }), `Part Summary ${summary.number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadPartSummaries());
  }

  /** The part-summary list returns model_id only; look the model up in the loaded Models list. */
  summaryModel(summary: PartSummaryRow): ModelRow | undefined {
    return summary.model ?? this.models.find((model) => model.id === summary.model_id);
  }

  get filteredPartSummaries(): PartSummaryRow[] {
    return this.partSummaries.filter((summary) =>
      this.matches(this.partSummarySearch, [
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

  private resetPartSummaryForm(): void {
    this.editingPartSummaryId = null;
    this.summaryForm = { number: '', revision: '', model_id: '', hos: '' };
    this.summaryTypeForm = this.emptySummaryTypeForm();
    this.summaryBodyRuleChoice = 'KEEP';
  }
}
