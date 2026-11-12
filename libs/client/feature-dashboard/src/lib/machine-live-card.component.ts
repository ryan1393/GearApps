import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnDestroy,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  FanucVariablesApi,
  LapperAccess,
  ScannerApi,
  ScannerDetailsApi,
} from '@meshforge/client/core';
import { LiveCycleTimerComponent, StatusBadgeComponent, ValueFieldComponent } from '@meshforge/client/ui';
import { Machine, MachineFanucVariable, resolveScannerImagePath, ScannerDetail } from '@meshforge/shared/domain';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  exhaustMap,
  filter,
  forkJoin,
  fromEvent,
  interval,
  map,
  merge,
  of,
  startWith,
  switchMap,
  timeout,
} from 'rxjs';
import { ScannerControlsComponent } from './scanner-controls.component';

/** How long one live request (image, scanner slots, machine I/O) may take before it counts as failed. */
export const LIVE_REQUEST_TIMEOUT_MS = 6_000;
const NOT_REFRESHED = 'not-refreshed' as const;
/**
 * Refresh period while the scanner's photoeye is on. The API keeps each capture for its 1 s cache,
 * and the scanner uploads one image per read, so refreshing faster would show nothing new.
 */
export const LIVE_FEED_MS = 1_000;

/**
 * Live tile for one machine: scanner capture, serial-number slots and Fanuc I/O.
 * Polls while the tab is visible; stops when hidden or destroyed and frees blob URLs.
 */
@Component({
  selector: 'gear-machine-live-card',
  imports: [StatusBadgeComponent, ValueFieldComponent, ScannerControlsComponent, LiveCycleTimerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="dana-card" [attr.data-tone]="fanuc()?.y03_2_stack_inCycle ? 'success' : null">
      <header class="dana-card-header">
        <div>
          <span class="dana-card-eyebrow">{{
            machine().description || machine().type || 'Machine'
          }}</span>
          <span class="dana-card-title">{{ machine().number || machine().ip }}</span>
          <span class="gear-muted gear-live-meta"
            ><code>{{ machine().ip }}</code>
            @if (machine().builder) {
              · {{ machine().builder }}
            }
          </span>
        </div>
        <div class="gear-live-status">
          <gear-status-badge [status]="machine().status" />
          @if (lastUpdate()) {
            <small class="gear-muted" title="Last refresh">{{ lastUpdate() }}</small>
          }
        </div>
      </header>

      <div class="gear-live-body">
        <div class="gear-live-media">
          <div class="dana-media-frame gear-live-image">
          @if (live()) {
            <span class="gear-live-feed dana-status-badge" data-tone="success" role="status">Live · photoeye on</span>
          }
          @if (imageUrl()) {
            <img [src]="imageUrl()" alt="Latest scanner capture for {{ machine().number }}" />
            @if (imageError()) {
              <small class="gear-live-stale gear-muted" data-tone="warning">Image did not refresh</small>
            }
          } @else if (!scanner()) {
            <div class="dana-media-placeholder">No scanner assigned</div>
          } @else if (imageError()) {
            <div class="dana-media-placeholder" data-tone="warning">Image unavailable</div>
          } @else {
            <div class="dana-media-placeholder">Loading…</div>
          }
          </div>
          @if (imagePath(); as p) {
            <small
              class="gear-live-path gear-muted"
              [title]="p.defaultFolder ? 'Default folder: no image folder is set on this scanner' : 'Image folder set on this scanner'"
            >
              FTP <code>{{ p.folder }}/{{ p.file }}</code>{{ p.defaultFolder ? ' (default)' : '' }}
            </small>
          }
        </div>

        <div class="gear-live-data">
          <div class="dana-card-section">
            <div class="dana-section-title">Serial numbers</div>
            <div class="gear-live-fields">
              <gear-value-field
                label="In scanner"
                [value]="scanner()?.sn_scanner"
                type="text"
                [compact]="true"
              />
              <gear-value-field
                label="In queue"
                [value]="scanner()?.sn_queue"
                type="text"
                [compact]="true"
              />
              <gear-value-field
                label="In process"
                [value]="scanner()?.sn_procces"
                type="text"
                [compact]="true"
              />
            </div>
          </div>
          <div
            class="dana-card-section"
            [attr.data-tone]="fanuc()?.y03_2_stack_inCycle ? 'success' : null"
          >
            <div class="dana-section-title">Machine I/O</div>
            <div class="gear-live-fields">
              <gear-value-field
                label="Front door closed"
                [value]="fanuc()?.x06_7_frt_dr_closed"
                type="flag"
                [compact]="true"
              />
              <gear-value-field
                label="In cycle"
                [value]="fanuc()?.y03_2_stack_inCycle"
                type="flag"
                [compact]="true"
              />
              <gear-value-field
                label="Cycle start"
                [value]="fanuc()?.x01_2_start_cycle"
                type="flag"
                [compact]="true"
              />
              <div class="dana-detail is-compact">
                <span class="dana-detail-label">Cycle time</span>
                <span class="dana-detail-value"
                  ><gear-live-cycle-timer [snapshot]="fanuc()" [receivedAt]="fanucAt()"
                /></span>
              </div>
            </div>
            @if (fanucStale()) {
              <p class="gear-field-help" data-tone="warning">Machine I/O did not refresh; showing the last values received.</p>
            } @else if (fanucError()) {
              <p class="gear-field-help">No I/O snapshot recorded for this machine yet.</p>
            }
          </div>
        </div>
      </div>

      @if (access.canEditSetup() && scanner(); as s) {
        <footer class="dana-divider-section gear-live-foot">
          <button
            type="button"
            class="gear-btn gear-btn-secondary gear-btn-sm"
            (click)="controlsOpen.set(!controlsOpen())"
          >
            {{ controlsOpen() ? 'Hide scanner controls' : 'Scanner controls' }}
          </button>
          @if (controlsOpen()) {
            <gear-scanner-controls [scannerId]="s.id" />
          }
        </footer>
      }
    </article>
  `,
  styles: `
    .gear-live-meta {
      display: block;
      margin-top: var(--dana-space-1);
    }
    .gear-live-status {
      display: grid;
      justify-items: end;
      gap: var(--dana-space-1);
    }
    .gear-live-body {
      display: grid;
      grid-template-columns: minmax(200px, 1.1fr) 1fr;
      gap: var(--dana-form-gap);
    }
    .gear-live-image {
      aspect-ratio: 1;
      overflow: hidden;
      display: grid;
      place-items: center;
      position: relative;
    }
    .gear-live-feed {
      position: absolute;
      inset: var(--dana-space-2) auto auto var(--dana-space-2);
      z-index: 1;
    }
    .gear-live-feed::before {
      animation: gear-live-pulse 1s ease-in-out infinite;
    }
    @keyframes gear-live-pulse {
      50% {
        opacity: 0.25;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .gear-live-feed::before {
        animation: none;
      }
    }
    .gear-live-stale {
      position: absolute;
      inset: auto 0 0 0;
      text-align: center;
    }
    .gear-live-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
    .gear-live-media {
      display: grid;
      gap: var(--dana-space-1);
      align-content: start;
    }
    .gear-live-path {
      display: block;
      overflow-wrap: anywhere;
    }
    .gear-live-data {
      display: grid;
      gap: var(--dana-form-gap);
      align-content: start;
    }
    .gear-live-fields {
      display: grid;
      gap: var(--dana-field-gap);
    }
    .gear-live-foot {
      display: grid;
      gap: var(--dana-form-gap);
    }
    @media (max-width: 640px) {
      .gear-live-body {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class MachineLiveCardComponent implements OnDestroy {
  protected readonly access = inject(LapperAccess);
  private readonly scannerApi = inject(ScannerApi);
  private readonly scannerDetails = inject(ScannerDetailsApi);
  private readonly fanucApi = inject(FanucVariablesApi);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly machine = input.required<Machine>();
  /** Refresh period in ms. */
  readonly pollMs = input(2000);
  /** The scanner's photoeye is on: the image refreshes now and every LIVE_FEED_MS until it clears. */
  readonly photoeye = input(false);
  protected readonly live = computed(() => this.photoeye() && !!this.scannerId());
  private readonly period = computed(() => (this.live() ? Math.min(LIVE_FEED_MS, this.pollMs()) : this.pollMs()));
  private readonly period$ = toObservable(this.period);

  protected readonly scanner = signal<ScannerDetail | null>(null);
  protected readonly fanuc = signal<MachineFanucVariable | null>(null);
  /** When the snapshot above was received, for the running cycle timer. */
  protected readonly fanucAt = signal(Date.now());
  protected readonly imageUrl = signal<string | null>(null);
  protected readonly imageError = signal(false);
  protected readonly fanucError = signal(false);
  /** The last machine I/O request failed or timed out; the values shown are the previous ones. */
  protected readonly fanucStale = signal(false);
  protected readonly lastUpdate = signal<string | null>(null);
  protected readonly controlsOpen = signal(false);
  private readonly imageDefaults = toSignal(
    this.scannerApi.imageDefaults().pipe(catchError(() => of(null))),
    { initialValue: null },
  );
  /** Where this card's image is read on the FTP drop, so a wrong folder is easy to spot. */
  protected readonly imagePath = computed(() => {
    const scanner = this.scanner();
    const defaults = this.imageDefaults();
    if (!scanner || !defaults) return null;
    const path = resolveScannerImagePath(scanner, defaults);
    return path.folder ? path : null;
  });
  private readonly scannerId = computed(
    () => this.machine().scanner?.id ?? this.machine().scanner_id ?? null,
  );

  constructor() {
    const visible$ = merge(fromEvent(this.doc, 'visibilitychange'), of(null)).pipe(
      map(() => this.doc.visibilityState === 'visible'),
    );

    effect((onCleanup) => {
      const machine = this.machine();
      const scannerId = this.scannerId();
      untracked(() => {
        this.revokeImage();
        this.scanner.set(machine.scanner ?? null);
        this.imageError.set(false);
      });

      // A new period (the photoeye tripping or clearing, or another refresh rate) refreshes at once
      // and restarts the timer, without clearing the image on screen. Subscribed untracked: a reply
      // that arrives synchronously must not make this effect depend on the signals it sets.
      const sub = untracked(() => combineLatest([visible$, this.period$.pipe(distinctUntilChanged())])
        .pipe(
          switchMap(([visible, period]) => (visible ? interval(period).pipe(startWith(0)) : of())),
          filter(() => this.doc.visibilityState === 'visible'),
          // exhaustMap, not switchMap: a scanner image slower than the poll period would be
          // cancelled by every tick, so the card (and its serials and machine I/O) never updated.
          // Each request gives up after LIVE_REQUEST_TIMEOUT_MS, so one that hangs shows as an
          // error on this poll instead of holding every later poll back.
          exhaustMap(() =>
            forkJoin({
              image: scannerId
                ? this.scannerApi.image(scannerId).pipe(timeout(LIVE_REQUEST_TIMEOUT_MS), catchError(() => of(null)))
                : of(undefined),
              scanner: scannerId
                ? this.scannerDetails.get(scannerId).pipe(timeout(LIVE_REQUEST_TIMEOUT_MS), catchError(() => of(null)))
                : of(undefined),
              // 404: the machine has no snapshot yet. Anything else (a timeout, an outage) keeps
              // the last values on screen, marked as not refreshed.
              fanuc: this.fanucApi.byMachine(machine.id).pipe(
                timeout(LIVE_REQUEST_TIMEOUT_MS),
                catchError((error: unknown) =>
                  of((error as { status?: number })?.status === 404 ? null : NOT_REFRESHED),
                ),
              ),
            }),
          ),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(({ image, scanner, fanuc }) => {
          if (image instanceof Blob) {
            this.revokeImage();
            this.imageUrl.set(URL.createObjectURL(image));
            this.imageError.set(false);
          } else if (image === null) {
            this.imageError.set(true);
          }
          if (scanner) this.scanner.set(scanner);
          this.fanucStale.set(fanuc === NOT_REFRESHED);
          if (fanuc !== NOT_REFRESHED) {
            this.fanuc.set(fanuc);
            this.fanucAt.set(Date.now());
            this.fanucError.set(fanuc === null);
          }
          this.lastUpdate.set(new Date().toLocaleTimeString());
        }));

      onCleanup(() => sub.unsubscribe());
    });
  }

  ngOnDestroy() {
    this.revokeImage();
  }

  private revokeImage() {
    const url = this.imageUrl();
    if (url) URL.revokeObjectURL(url);
    this.imageUrl.set(null);
  }
}
