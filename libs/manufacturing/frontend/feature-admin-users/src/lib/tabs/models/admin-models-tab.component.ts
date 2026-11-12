import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaToneDirective } from '@dana/ui';

import { ModelRow } from '../../admin-api.service';
import { AdminFeedbackComponent } from '../../shared/admin-feedback.component';
import { AdminListStateComponent } from '../../shared/admin-list-state.component';
import { AdminTabBase } from '../../shared/admin-tab-base';
import { modelLabel } from '../../shared/admin-labels';

/** Admin > Models: gear models a Part Summary belongs to. */
@Component({
  selector: 'gear-admin-models-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaToneDirective, AdminFeedbackComponent, AdminListStateComponent],
  templateUrl: './admin-models-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
})
export class AdminModelsTabComponent extends AdminTabBase implements OnInit {
  readonly modelsList = this.list<ModelRow[]>([]);
  get models(): ModelRow[] { return this.modelsList.value(); }
  readonly modelLabel = modelLabel;
  modelSearch = '';
  modelForm: { model_number: string; model_type: string } = { model_number: '', model_type: '' };

  ngOnInit(): void { this.loadModels(); }

  retryChoices(): void { this.loadModels(); }

  loadModels(): void { this.modelsList.load(this.api.listModels()); }

  /** Two enabled models with one number are usually the same model entered with and without a type. */
  modelSharesNumber(model: { id: string; model_number?: string | null; enabled?: boolean }): boolean {
    const key = (value?: string | null) => (value ?? '').trim().toUpperCase();
    return !!key(model.model_number) && model.enabled !== false
      && this.models.some(other => other.id !== model.id && other.enabled !== false && key(other.model_number) === key(model.model_number));
  }

  createModel(): void {
    if (!this.modelForm.model_number.trim() && !this.modelForm.model_type.trim()) {
      this.error = 'Model number or model type is required.';
      return;
    }
    this.runSave(
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
    this.runSave(this.api.updateModel(model.id, { enabled, active: enabled }), `Model ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadModels());
  }

  get filteredModels(): ModelRow[] {
    return this.models.filter((model) =>
      this.matches(this.modelSearch, [
        model.model_number,
        model.model_type,
        model.active ? 'active' : 'inactive',
        model.enabled ? 'enabled' : 'disabled',
      ]),
    );
  }
}
