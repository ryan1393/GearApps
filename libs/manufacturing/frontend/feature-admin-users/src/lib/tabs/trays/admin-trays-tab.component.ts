import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaToneDirective } from '@dana/ui';
import { GearLabelPrinterPickerComponent } from '@meshforge/manufacturing/frontend/util-common';

import { AdminTrayRow } from '../../admin-api.service';
import { allPages } from '../../shared/admin-data';
import { AdminFeedbackComponent } from '../../shared/admin-feedback.component';
import { normalizeSequentialAssetSerial } from '../../shared/admin-labels';
import { AdminListStateComponent } from '../../shared/admin-list-state.component';
import { AdminTabBase } from '../../shared/admin-tab-base';

/** Admin > Trays: create trays, print their tags, enable and disable them. */
@Component({
  selector: 'gear-admin-trays-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaToneDirective, GearLabelPrinterPickerComponent, AdminFeedbackComponent, AdminListStateComponent],
  templateUrl: './admin-trays-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
})
export class AdminTraysTabComponent extends AdminTabBase implements OnInit {
  readonly traysList = this.list<AdminTrayRow[]>([]);
  get trays(): AdminTrayRow[] { return this.traysList.value(); }
  traySearch = '';
  trayForm = { serial_number: '' };

  ngOnInit(): void { this.loadTrays(); }

  retryChoices(): void { this.loadTrays(); }

  loadTrays(): void { this.traysList.load(allPages((page) => this.api.listTrays(page, 50))); }

  get traySerialPreview(): string {
    return normalizeSequentialAssetSerial('T', this.trayForm.serial_number);
  }

  createTray(): void {
    const input = this.trayForm.serial_number.trim();
    const serial = normalizeSequentialAssetSerial('T', input);
    if (!serial) {
      this.error = 'Tray serial must be T followed by digits, for example T0301 or 301.';
      return;
    }
    this.runSave(
      this.api.createTray({ serial_number: input, blade_count: 0, enabled: true }),
      `Tray ${serial} created.`,
      () => {
        this.trayForm = { serial_number: '' };
        this.loadTrays();
      },
    );
  }

  toggleTrayEnabled(tray: AdminTrayRow, confirmed = false): void {
    const enabled = !tray.enabled;
    if (!enabled && !confirmed) { this.askDisable(`tray ${tray.serial_number}`, 'Scans of it are refused until it is enabled again.', () => this.toggleTrayEnabled(tray, true)); return; }
    this.runSave(this.api.updateTray(tray.id, { enabled }), `Tray ${tray.serial_number} ${enabled ? 'enabled' : 'disabled'}.`, () => this.loadTrays());
  }

  get filteredTrays(): AdminTrayRow[] {
    return this.trays.filter((tray) =>
      this.matches(this.traySearch, [
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
}
