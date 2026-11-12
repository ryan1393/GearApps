import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaToneDirective } from '@dana/ui';
import { GearLabelPrinterPickerComponent } from '@meshforge/manufacturing/frontend/util-common';

import { AdminContainerRow } from '../../admin-api.service';
import { allPages } from '../../shared/admin-data';
import { AdminFeedbackComponent } from '../../shared/admin-feedback.component';
import { normalizeSequentialAssetSerial } from '../../shared/admin-labels';
import { AdminListStateComponent } from '../../shared/admin-list-state.component';
import { AdminTabBase } from '../../shared/admin-tab-base';

/** Admin > Containers: create coater containers, print their tags, enable and disable them. */
@Component({
  selector: 'gear-admin-containers-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaToneDirective, GearLabelPrinterPickerComponent, AdminFeedbackComponent, AdminListStateComponent],
  templateUrl: './admin-containers-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
})
export class AdminContainersTabComponent extends AdminTabBase implements OnInit {
  readonly containersList = this.list<AdminContainerRow[]>([]);
  get containers(): AdminContainerRow[] { return this.containersList.value(); }
  containerSearch = '';
  containerForm = { serial_number: '' };

  ngOnInit(): void { this.loadContainers(); }

  retryChoices(): void { this.loadContainers(); }

  loadContainers(): void { this.containersList.load(allPages((page) => this.api.listContainers(page, 50))); }

  get containerSerialPreview(): string {
    return normalizeSequentialAssetSerial('C', this.containerForm.serial_number);
  }

  createContainer(): void {
    const input = this.containerForm.serial_number.trim();
    const serial = normalizeSequentialAssetSerial('C', input);
    if (!serial) {
      this.error = 'Container serial must be C followed by digits, for example C0101 or 101.';
      return;
    }
    this.runSave(
      this.api.createContainer({ serial_number: input, enabled: true }),
      `Container ${serial} created.`,
      () => {
        this.containerForm = { serial_number: '' };
        this.loadContainers();
      },
    );
  }

  toggleContainerEnabled(container: AdminContainerRow, confirmed = false): void {
    const enabled = !container.enabled;
    if (!enabled && !confirmed) { this.askDisable(`container ${container.serial_number}`, 'Scans of it are refused until it is enabled again.', () => this.toggleContainerEnabled(container, true)); return; }
    this.runSave(this.api.updateContainer(container.id, { enabled }), `Container ${container.serial_number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadContainers());
  }

  get filteredContainers(): AdminContainerRow[] {
    return this.containers.filter((container) =>
      this.matches(this.containerSearch, [
        container.serial_number,
        container.tray_count,
        container.blade_count,
        container.enabled ? 'active' : 'inactive',
      ]),
    );
  }
}
