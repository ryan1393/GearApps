import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { RxoControlStatusData } from '@truck-log/shared/contracts';
import { TruckLogAdminAuth } from '@truck-log/web/auth/admin';
import { TruckLogApi } from '@truck-log/web/data-access';
import { ToastService } from '@truck-log/web/ui';

/** Edited values live with the Control Center so switching tabs keeps unsaved edits. */
export interface RxoSettingsForm {
  settingsInterval: number;
  settingsMaxScanDuration: number;
  settingsNoProgressTimeout: number;
  credentialUsername: string;
  credentialPassword: string;
  /** False until the saved settings have been read once: Save stays off so the defaults below cannot overwrite them. */
  loaded: boolean;
  /** The values last copied from (or saved to) the server; a form that differs has unsaved edits. */
  appliedKey: string;
}

export function emptyRxoSettingsForm(): RxoSettingsForm {
  return {
    settingsInterval: 30,
    settingsMaxScanDuration: 30,
    settingsNoProgressTimeout: 15,
    credentialUsername: '',
    credentialPassword: '',
    loaded: false,
    appliedKey: '',
  };
}

export function rxoSettingsKey(form: RxoSettingsForm): string {
  return [form.settingsInterval, form.settingsMaxScanDuration, form.settingsNoProgressTimeout, form.credentialUsername.trim()].join('|');
}

/** Copy the saved RXO settings and username into the form. */
export function applyRxoSettings(form: RxoSettingsForm, control: RxoControlStatusData) {
  // A refresh never discards edits the administrator has not saved yet.
  if (form.loaded && rxoSettingsKey(form) !== form.appliedKey) return;
  form.settingsInterval = control.settings?.syncIntervalMinutes ?? 30;
  form.settingsMaxScanDuration = control.settings?.maxScanDurationMinutes ?? 30;
  form.settingsNoProgressTimeout = control.settings?.noProgressTimeoutMinutes ?? 15;
  form.credentialUsername = control.credentials?.username ?? '';
  form.appliedKey = rxoSettingsKey(form);
  form.loaded = true;
}

/** RXO Settings & Login: scan schedule and RXO credentials (administrators only). */
@Component({
  selector: 'div[tlRxoSettingsPanel]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rxo-settings-panel.component.html',
})
export class RxoSettingsPanelComponent {
  @Input({ required: true }) form!: RxoSettingsForm;
  @Input() control: RxoControlStatusData | null = null;
  @Input() busy = false;
  @Output() readonly busyChange = new EventEmitter<boolean>();
  /** A save was confirmed; the Control Center refreshes its status. */
  @Output() readonly saved = new EventEmitter<void>();

  constructor(private readonly api: TruckLogApi, private readonly toast: ToastService, private readonly adminAuth: TruckLogAdminAuth) {}

  get settingsValid() {
    const f = this.form;
    return f.settingsInterval >= 1 && f.settingsInterval <= 1440
      && f.settingsMaxScanDuration >= 5 && f.settingsMaxScanDuration <= 240
      && f.settingsNoProgressTimeout >= 2 && f.settingsNoProgressTimeout <= 120
      && f.settingsNoProgressTimeout <= f.settingsMaxScanDuration;
  }

  private setBusy(value: boolean) {
    this.busy = value;
    this.busyChange.emit(value);
  }

  saveSettings() {
    if (!this.adminAuth.canWrite()) { this.toast.error('Sign in to Truck Log Admin before changing RXO settings or starting a scan.'); return; }
    if (!this.settingsValid || !this.form.loaded) return;
    const f = this.form;
    this.setBusy(true);
    this.api.updateRxoSettings({
      syncIntervalMinutes: Number(f.settingsInterval), maxScanDurationMinutes: Number(f.settingsMaxScanDuration), noProgressTimeoutMinutes: Number(f.settingsNoProgressTimeout),
    }).subscribe({
      next: () => { this.setBusy(false); f.appliedKey = rxoSettingsKey(f); this.toast.success('RXO scan settings saved.'); this.saved.emit(); },
      error: (error) => { this.setBusy(false); this.toast.error(error?.error?.message || 'Could not save RXO settings.'); },
    });
  }

  saveCredentials() {
    if (!this.adminAuth.canWrite()) { this.toast.error('Sign in to Truck Log Admin before changing RXO settings or starting a scan.'); return; }
    const username = this.form.credentialUsername.trim();
    if (!username) return;
    this.setBusy(true);
    this.api.updateRxoCredentials({ username, password: this.form.credentialPassword || undefined }).subscribe({
      next: (result) => {
        this.setBusy(false);
        this.form.credentialPassword = '';
        this.form.appliedKey = rxoSettingsKey(this.form);
        this.toast.success(result.passwordUpdated ? 'RXO username and password updated.' : 'RXO username saved; existing password kept.');
        this.saved.emit();
      },
      error: (error) => { this.setBusy(false); this.form.credentialPassword = ''; this.toast.error(error?.error?.message || 'Could not save RXO credentials.'); },
    });
  }
}
