import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DanaConfirmDialogComponent,
  DanaCountBadgeDirective,
  DanaPageHeaderComponent,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';
import { apiErrorMessage, CollectorTokensApi, loadable, ToastService } from '@meshforge/client/core';
import { DialogComponent, StatusBadgeComponent } from '@meshforge/client/ui';
import { CollectorToken, CreatedCollectorToken, DockerCollectorConnection } from '@meshforge/shared/domain';

@Component({
  selector: 'gear-collector-tokens-page',
  imports: [
    DatePipe,
    FormsModule,
    DanaConfirmDialogComponent,
    DanaCountBadgeDirective,
    DanaPageHeaderComponent,
    DanaTableDirective,
    DanaTableEmptyDirective,
    DanaTableShellDirective,
    DialogComponent,
    StatusBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .lapper-token-secret {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }
    .lapper-token-secret input {
      flex: 1;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .lapper-token-steps {
      margin: 16px 0 0;
      padding-left: 20px;
      line-height: 1.6;
    }
  `,
  template: `
    <div class="gear-page gear-workflow-page">
      <section
        danaPageHeader
        eyebrow="LAPPER / CONFIGURATION"
        heading="Collector Tokens"
        description="Lapper Read signs in with a collector token. Tokens never expire, only send machine data, and can be revoked here."
      >
        <div danaPageHeaderAction class="dana-toolbar">
          <button
            type="button"
            class="gear-btn gear-btn-secondary"
            (click)="reload()"
            [disabled]="tokens.loading()"
           data-icon="refresh" title="Refresh">
            ↻ {{ tokens.loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
          <button type="button" class="gear-btn gear-btn-primary" (click)="openCreate()">
            + Create token
          </button>
        </div>
      </section>

      <section class="gear-workflow-section">
        <div class="gear-workflow-section-header gear-workflow-status-row">
          <div>
            <h2>Docker collector</h2>
            @if (docker.loading()) {
              <p>Checking…</p>
            } @else if (docker.error()) {
              <p class="gear-alert gear-alert-danger" role="alert">
                Could not check the Docker collector: {{ dockerError() }}
                <button type="button" class="gear-btn gear-btn-secondary gear-btn-sm" (click)="reload()">
                  Retry
                </button>
              </p>
            } @else if (!docker.value().available) {
              <p>
                This API is not running in the Docker stack. For the Docker collector, deploy with
                <code>compose.yml</code>; for any other collector, create a token below.
              </p>
            } @else if (docker.value().token; as t) {
              <p>
                Connected with <span class="mono">glr_…{{ t.hint }}</span> since
                {{ t.created_at | date: 'MMM d, h:mm a' }} · last used
                {{ t.last_used_at ? (t.last_used_at | date: 'MMM d, h:mm a') : 'not yet' }}.
                Reconnecting issues a new token and revokes this one; the collector switches over
                by itself.
              </p>
            } @else {
              <p>
                Not connected. Connecting hands the Docker collector its own token on a private
                volume, so nothing goes in <code>.env</code> and the token is never shown.
              </p>
            }
          </div>
          @if (docker.value().available && !docker.error()) {
            <div class="dana-toolbar">
              <gear-status-badge
                [tone]="docker.value().token ? 'success' : 'neutral'"
                [text]="docker.value().token ? 'Connected' : 'Not connected'"
              />
              <button
                type="button"
                class="gear-btn gear-btn-primary"
                (click)="connectDocker()"
                [disabled]="connecting() || docker.loading()"
              >
                {{
                  connecting()
                    ? 'Connecting…'
                    : docker.value().token
                      ? 'Reconnect (new token)'
                      : 'Connect Docker collector'
                }}
              </button>
            </div>
          }
        </div>
      </section>

      <section class="gear-workflow-table-panel">
        <div class="gear-workflow-table-heading gear-workflow-status-row">
          <div>
            <h2>Tokens</h2>
            <p>{{ activeCount() }} active. The token itself is shown once, when it is created.</p>
          </div>
          <span danaCountBadge class="gear-count-badge count-chip">{{
            tokens.value().length
          }}</span>
        </div>
        <div danaTableShell class="table-wrap">
          <table danaTable class="gear-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Token</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th data-dana-table-static aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              @for (t of tokens.value(); track t.id) {
                <tr>
                  <td class="strong">
                    {{ t.name }}
                    @if (t.purpose === 'docker') {
                      <span class="gear-muted">· issued to the Docker collector</span>
                    }
                  </td>
                  <td class="mono nowrap">glr_…{{ t.hint }}</td>
                  <td class="nowrap">
                    {{ t.created_at | date: 'MMM d, y' }}
                    <span class="gear-muted">· {{ t.created_by_email || 'unknown' }}</span>
                  </td>
                  <td class="nowrap">
                    {{ t.last_used_at ? (t.last_used_at | date: 'MMM d, h:mm a') : 'Never' }}
                  </td>
                  <td>
                    <gear-status-badge
                      [tone]="t.revoked_at ? 'neutral' : 'success'"
                      [text]="t.revoked_at ? 'Revoked ' + (t.revoked_at | date: 'MMM d') : 'Active'"
                    />
                  </td>
                  <td class="right">
                    @if (!t.revoked_at) {
                      <div class="gear-actions">
                        <button
                          type="button"
                          class="gear-btn gear-btn-danger gear-btn-sm"
                          (click)="pendingRevoke.set(t)"
                          [attr.aria-label]="'Revoke ' + t.name"
                        >
                          Revoke
                        </button>
                      </div>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td danaTableEmpty colspan="6" class="empty-row">
                    {{
                      tokens.loading()
                        ? 'Loading tokens…'
                        : 'No collector tokens yet. Connect the Docker collector above, or create one for another Lapper Read installation.'
                    }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <gear-dialog
      [open]="createOpen()"
      (openChange)="createOpen.set($event)"
      title="Create collector token"
      description="Name it after where it will run, so you know which one to revoke later."
      width="520px"
    >
      <form (ngSubmit)="create()" id="tokenForm" class="gear-form-grid">
        <label class="gear-field dana-field-full">
          Name
          <input
            class="gear-input"
            name="name"
            [(ngModel)]="name"
            maxlength="80"
            placeholder="Lapper Read – Plant 1"
            required
          />
        </label>
        @if (error()) {
          <p class="gear-alert gear-alert-danger dana-field-full" role="alert">{{ error() }}</p>
        }
      </form>
      <ng-container dialogActions>
        <button type="button" class="gear-btn gear-btn-secondary" (click)="createOpen.set(false)">
          Cancel
        </button>
        <button
          type="submit"
          form="tokenForm"
          class="gear-btn gear-btn-primary"
          [disabled]="!name.trim() || busy()"
        >
          {{ busy() ? 'Creating…' : 'Create token' }}
        </button>
      </ng-container>
    </gear-dialog>

    <gear-dialog
      [open]="!!created()"
      (openChange)="$event || created.set(null)"
      [title]="'Token for ' + (created()?.name ?? '')"
      description="Copy it now. It is not stored and can't be shown again."
      width="600px"
    >
      <div class="lapper-token-secret">
        <input
          class="gear-input"
          readonly
          [value]="created()?.token ?? ''"
          aria-label="Collector token"
          #secret
          (focus)="secret.select()"
        />
        <button type="button" class="gear-btn gear-btn-primary" (click)="copy()">
          {{ copied() ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <ol class="lapper-token-steps">
        <li>
          Give it to the Lapper Read installation it is for (for example the Windows service's
          <code>MeshForgeApi</code> settings).
        </li>
        <li>
          The Docker collector does not need this: use
          <strong>Connect Docker collector</strong> instead.
        </li>
      </ol>
      <ng-container dialogActions>
        <button type="button" class="gear-btn gear-btn-primary" (click)="created.set(null)">
          Done
        </button>
      </ng-container>
    </gear-dialog>

    <dana-confirm-dialog
      [open]="!!pendingRevoke()"
      title="Revoke collector token"
      [message]="
        'Revoke ' +
        (pendingRevoke()?.name ?? '') +
        '? Collectors using it stop sending data immediately. Runs they have not sent yet stay on their machine until they get a new token.'
      "
      confirmLabel="Revoke"
      [danger]="true"
      (confirm)="revokeConfirmed()"
      (cancel)="pendingRevoke.set(null)"
    />
  `,
})
export class CollectorTokensPageComponent implements OnInit {
  private readonly api = inject(CollectorTokensApi);
  private readonly toast = inject(ToastService);

  protected readonly tokens = loadable<CollectorToken[]>([]);
  protected readonly docker = loadable<DockerCollectorConnection>({ available: false, token: null });
  protected readonly connecting = signal(false);
  protected readonly dockerError = computed(() => {
    const error = this.docker.error();
    return error ? apiErrorMessage(error) : '';
  });
  protected readonly activeCount = computed(
    () => this.tokens.value().filter((t) => !t.revoked_at).length,
  );
  protected readonly createOpen = signal(false);
  protected readonly created = signal<CreatedCollectorToken | null>(null);
  protected readonly pendingRevoke = signal<CollectorToken | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected name = '';

  ngOnInit() {
    this.reload();
  }

  protected reload() {
    this.tokens.load(this.api.list());
    this.docker.load(this.api.dockerConnection());
  }

  protected connectDocker() {
    if (this.connecting()) return;
    this.connecting.set(true);
    this.api.connectDocker().subscribe({
      next: () => {
        this.connecting.set(false);
        this.toast.success(
          'Docker collector connected',
          'It picks up the new token on its next call; start it with the collectors profile if it is not running.',
        );
        this.reload();
      },
      error: (err) => {
        this.connecting.set(false);
        this.toast.error(err, 'Could not connect the Docker collector');
      },
    });
  }

  protected openCreate() {
    this.name = '';
    this.error.set(null);
    this.createOpen.set(true);
  }

  protected create() {
    if (this.busy() || !this.name.trim()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.create(this.name.trim()).subscribe({
      next: (token) => {
        this.busy.set(false);
        this.createOpen.set(false);
        this.copied.set(false);
        this.created.set(token);
        this.reload();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }

  protected async copy() {
    const token = this.created()?.token;
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      this.copied.set(true);
    } catch {
      this.toast.info('Select the token and copy it', 'The browser blocked clipboard access');
    }
  }

  protected revokeConfirmed() {
    const t = this.pendingRevoke();
    if (!t) return;
    this.pendingRevoke.set(null);
    this.api.revoke(t.id).subscribe({
      next: () => {
        this.toast.success('Token revoked', t.name);
        this.reload();
      },
      error: (err) => this.toast.error(err, 'Could not revoke token'),
    });
  }
}
