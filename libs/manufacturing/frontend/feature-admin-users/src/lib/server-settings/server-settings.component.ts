import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';

import { adminApiErrorText } from '../admin-api.service';

export interface ServerSetting {
  key: string;
  label: string;
  help: string | null;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiline';
  options: string[] | null;
  secret: boolean;
  editable: boolean;
  locked_reason: string | null;
  /** Null for a secret: the server never sends one. */
  value: string | null;
  is_set: boolean;
  source: 'ADMIN' | 'ENVIRONMENT';
  environment_value: string | null;
  environment_is_set: boolean;
  pending: boolean;
  unreadable: boolean;
  updated_at: string | null;
}
export interface ServerSettingGroup {
  id: string;
  title: string;
  description: string;
  settings: ServerSetting[];
}
export interface ServerSettingsBoard {
  format: string;
  available: boolean;
  can_restart: boolean;
  restart_required: boolean;
  groups: ServerSettingGroup[];
}

const API = '/api/v1/admin/environment-settings';
const RESTART_CHECK_MS = 3000;
const RESTART_CHECKS = 40;

/**
 * Admin > Server Settings: every server environment setting on one page. A value saved here is
 * kept in the database and used in place of the server environment (.env) value the next time
 * the API starts.
 */
@Component({
  selector: 'gear-admin-server-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './server-settings.component.html',
  styleUrls: ['./server-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerSettingsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(GearToastService);

  loading = false; saving = false; restarting = false; error = '';
  board: ServerSettingsBoard | null = null;
  search = '';
  selectedGroup = '';
  pendingOnly = false;
  /** What is typed for each setting. */
  draft: Record<string, string> = {};
  /** Secrets whose replacement box is open. */
  private readonly replacing = new Set<string>();
  /** Saved settings that will go back to the server environment value. */
  private readonly resetting = new Set<string>();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => { if (this.restartTimer) clearTimeout(this.restartTimer); });
  }

  ngOnInit(): void { this.refresh(); }

  refresh(): void {
    if (this.loading || this.restarting) return;
    this.loading = true; this.error = ''; this.cdr.markForCheck();
    this.http.get<ServerSettingsBoard>(API).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (board) => { this.loading = false; this.accept(board); },
      error: (error: HttpErrorResponse) => { this.loading = false; this.error = adminApiErrorText(error) || 'Could not load the server settings.'; this.cdr.markForCheck(); },
    });
  }

  get visibleGroups(): ServerSettingGroup[] {
    const term = this.search.trim().toLowerCase();
    if (!this.board) return [];
    return this.board.groups
      .filter(group => !this.selectedGroup || group.id === this.selectedGroup)
      .map((group) => ({
        ...group,
        settings: group.settings.filter(setting => (!this.pendingOnly || setting.pending || this.isChanged(setting)) && (!term || group.title.toLowerCase().includes(term) || `${setting.label} ${setting.key} ${setting.help ?? ''}`.toLowerCase().includes(term))),
      }))
      .filter((group) => group.settings.length);
  }

  get changedCount(): number {
    return this.allSettings().filter((setting) => this.isChanged(setting)).length;
  }

  isReplacing(setting: ServerSetting): boolean { return this.replacing.has(setting.key); }
  isResetting(setting: ServerSetting): boolean { return this.resetting.has(setting.key); }

  isChanged(setting: ServerSetting): boolean {
    if (!setting.editable) return false;
    if (this.resetting.has(setting.key)) return true;
    return setting.secret ? this.replacing.has(setting.key) : (this.draft[setting.key] ?? '') !== (setting.value ?? '');
  }

  /** What the setting goes back to when the saved value is removed. */
  environmentText(setting: ServerSetting): string {
    if (setting.secret) return setting.environment_is_set ? 'a value set on the server' : 'not set';
    return setting.environment_value ? setting.environment_value : 'blank';
  }

  startReplacing(setting: ServerSetting): void {
    this.replacing.add(setting.key); this.resetting.delete(setting.key); this.draft[setting.key] = '';
  }

  cancelReplacing(setting: ServerSetting): void {
    this.replacing.delete(setting.key); this.draft[setting.key] = '';
  }

  /** Marks a saved setting to go back to the server environment value, or undoes that. */
  toggleReset(setting: ServerSetting): void {
    if (this.resetting.delete(setting.key)) return;
    this.resetting.add(setting.key); this.replacing.delete(setting.key);
    this.draft[setting.key] = setting.secret ? '' : setting.value ?? '';
  }

  discard(): void {
    if (this.board) this.accept(this.board);
  }

  save(): void {
    if (this.saving || !this.board?.available) return;
    const changes = this.allSettings()
      .filter((setting) => this.isChanged(setting))
      .map((setting) => ({ key: setting.key, value: this.resetting.has(setting.key) ? null : String(this.draft[setting.key] ?? '') }));
    if (!changes.length) return;
    this.saving = true; this.error = ''; this.cdr.markForCheck();
    this.http.put<ServerSettingsBoard>(API, { changes }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (board) => {
        this.saving = false; this.accept(board);
        this.toast.success(
          board.restart_required ? 'Saved. The changes are used after the API restarts.' : 'Saved.',
          changes.length === 1 ? 'Setting saved' : `${changes.length} settings saved`,
        );
      },
      error: (error: HttpErrorResponse) => { this.saving = false; this.error = adminApiErrorText(error) || 'Could not save the settings.'; this.cdr.markForCheck(); },
    });
  }

  restart(): void {
    if (this.restarting || !this.board?.can_restart) return;
    if (!globalThis.confirm('Restart the API now? Every MeshForge screen and collector is disconnected for about a minute while it starts again.')) return;
    this.restarting = true; this.error = ''; this.cdr.markForCheck();
    this.http.post(`${API}/restart`, {}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.waitForRestart(RESTART_CHECKS),
      error: (error: HttpErrorResponse) => { this.restarting = false; this.error = adminApiErrorText(error) || 'Could not restart the API.'; this.cdr.markForCheck(); },
    });
  }

  trackGroup(_: number, group: ServerSettingGroup): string { return group.id; }
  trackSetting(_: number, setting: ServerSetting): string { return setting.key; }

  /** Asks for the settings until the restarted API answers with nothing left waiting. */
  private waitForRestart(checksLeft: number): void {
    this.restartTimer = setTimeout(() => {
      this.http.get<ServerSettingsBoard>(API).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (board) => {
          if (board.restart_required && checksLeft > 1) { this.waitForRestart(checksLeft - 1); return; }
          this.restarting = false; this.accept(board);
          if (board.restart_required) this.error = 'The API answered but has not restarted. Restart it on the server.';
          else this.toast.success('The API restarted and is using the saved settings.', 'API restarted');
        },
        error: () => {
          if (checksLeft > 1) { this.waitForRestart(checksLeft - 1); return; }
          this.restarting = false; this.error = 'The API has not come back yet. Wait a moment, then refresh. If it stays down, check it on the server.';
          this.cdr.markForCheck();
        },
      });
    }, RESTART_CHECK_MS);
  }

  private accept(board: ServerSettingsBoard): void {
    if (board?.format !== 'GEARENVSETTINGS1' || !Array.isArray(board.groups)) {
      this.error = 'Unexpected server settings response.'; this.cdr.markForCheck(); return;
    }
    this.board = board;
    this.replacing.clear(); this.resetting.clear();
    this.draft = {};
    for (const setting of this.allSettings()) this.draft[setting.key] = setting.secret ? '' : setting.value ?? '';
    this.cdr.markForCheck();
  }

  private allSettings(): ServerSetting[] {
    return this.board?.groups.flatMap((group) => group.settings) ?? [];
  }
}
