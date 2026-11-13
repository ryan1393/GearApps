import { DatePipe, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  CollectorMachine,
  FanucVariablesApi,
  MachineCyclesApi,
  LapperAccess,
  ScannerApi,
  ScannerDetailsApi,
} from '@meshforge/client/core';
import { LiveCycleTimerComponent, StatusBadgeComponent, ValueFieldComponent } from '@meshforge/client/ui';
import { Machine, MachineCycle, MachineFanucVariable, resolveScannerImagePath, ScannerDetail } from '@meshforge/shared/domain';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  exhaustMap,
  filter,
  forkJoin,
  fromEvent,
  pairwise,
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
 * Refresh period while the scanner's photoeye is on. The API keeps each capture for less than this
 * (ScannerClientService.IMAGE_TTL_MS), so every live refresh reads the newest upload.
 */
export const LIVE_FEED_MS = 500;
/** How many recent cycles a card lists, and how often it re-reads them (also right after a cycle ends). */
export const RECENT_CYCLES = 5;
export const RECENT_CYCLES_MS = 10_000;

/**
 * Live tile for one machine: scanner capture, serial-number slots and Fanuc I/O.
 * Polls while the tab is visible; stops when hidden or destroyed and frees blob URLs.
 */
@Component({
  selector: 'gear-machine-live-card',
  imports: [DatePipe, StatusBadgeComponent, ValueFieldComponent, ScannerControlsComponent, LiveCycleTimerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="dana-card"
      [class.gear-live-focused]="focused()"
      [attr.data-tone]="fanuc()?.y03_2_stack_inCycle ? 'success' : null"
    >
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
          @if (live()) {
            <span class="gear-live-feed dana-status-badge" data-tone="success" role="status"
              >Live · every {{ periodLabel() }}</span
            >
          }
          <div class="gear-live-corner">
            <gear-status-badge [status]="machine().status" />
            @if (!focused()) {
              <button
                type="button"
                class="gear-btn gear-btn-secondary gear-btn-sm"
                (click)="focusMachine.emit()"
                [attr.aria-label]="'Show only ' + (machine().number || machine().ip)"
                title="Show only this machine"
              >
                ⤢ Focus
              </button>
            }
          </div>
          @if (lastUpdate()) {
            <small class="gear-muted" title="Last refresh">Updated {{ lastUpdate() }}</small>
          }
        </div>
      </header>

      <div class="gear-live-body">
        <div class="gear-live-media">
          <div class="dana-media-frame gear-live-image">
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

        <section class="dana-card-section gear-live-cycles" aria-label="Recent cycles">
          <div class="dana-section-title">Recent cycles</div>
          @if (recentCycles(); as cycles) {
            @if (cycles.length) {
              <table class="gear-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Serial</th>
                    <th>Gearset</th>
                    <th class="right">Cycle</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of cycles; track c.id) {
                    <tr>
                      <td class="nowrap">{{ c.timestamp | date: 'shortTime' }}</td>
                      <td class="mono nowrap">
                        @if (c.serial_number) {
                          {{ c.serial_number }}
                        } @else {
                          <span class="gear-muted">no serial</span>
                        }
                      </td>
                      <td class="mono nowrap">{{ c.gearset?.number ?? '—' }}</td>
                      <td class="mono nowrap right">{{ cycleTime(c.cycle_time_s) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            } @else {
              <p class="gear-field-help">No cycles recorded yet.</p>
            }
          } @else if (cyclesError()) {
            <p class="gear-field-help" data-tone="warning">Recent cycles could not be loaded.</p>
          } @else {
            <p class="gear-field-help">Loading cycles…</p>
          }
        </section>

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
            <gear-scanner-controls [scannerId]="s.id" [io]="collector()" />
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
    .gear-live-corner {
      display: flex;
      flex-wrap: wrap;
      justify-content: end;
      align-items: center;
      gap: var(--dana-space-1);
    }
    /* One machine on its own: a larger image beside its data. */
    .gear-live-focused .gear-live-body {
      grid-template-columns: minmax(280px, 2fr) minmax(240px, 1fr);
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
    .gear-live-cycles {
      display: grid;
      gap: var(--dana-field-gap);
      margin-top: var(--dana-form-gap);
      overflow-x: auto;
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
      .gear-live-body,
      .gear-live-focused .gear-live-body {
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
  private readonly cyclesApi = inject(MachineCyclesApi);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly machine = input.required<Machine>();
  /** Refresh period in ms. */
  readonly pollMs = input(2000);
  /** The scanner's photoeye is on: the image refreshes now and every LIVE_FEED_MS until it clears. */
  readonly photoeye = input(false);
  /** Lapper Read's row for this machine: scanner inputs and outputs for the scanner controls. */
  readonly collector = input<CollectorMachine | null>(null);
  /** Shown on its own, larger; hides the Focus button. */
  readonly focused = input(false);
  /** Focus was pressed: the page shows only this machine. */
  readonly focusMachine = output<void>();
  protected readonly live = computed(() => this.photoeye() && !!this.scannerId());
  private readonly period = computed(() => (this.live() ? Math.min(LIVE_FEED_MS, this.pollMs()) : this.pollMs()));
  /** The refresh period as shown on the Live badge, e.g. "0.5 s". */
  protected readonly periodLabel = computed(() => `${this.period() / 1000} s`);
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
  /** The machine's newest cycles; null until the first read. */
  protected readonly recentCycles = signal<MachineCycle[] | null>(null);
  protected readonly cyclesError = signal(false);
  private readonly inCycle$ = toObservable(computed(() => this.fanuc()?.y03_2_stack_inCycle ?? null));
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

    // Recent cycles: every RECENT_CYCLES_MS, and as soon as a cycle ends (in cycle goes off).
    effect((onCleanup) => {
      const machineId = this.machine().id;
      untracked(() => {
        this.recentCycles.set(null);
        this.cyclesError.set(false);
      });
      const cycleEnded$ = this.inCycle$.pipe(
        pairwise(),
        filter(([before, now]) => before === true && now === false),
      );
      const sub = untracked(() =>
        merge(interval(RECENT_CYCLES_MS).pipe(startWith(0)), cycleEnded$)
          .pipe(
            filter(() => this.doc.visibilityState === 'visible'),
            exhaustMap(() =>
              this.cyclesApi.recent(machineId, RECENT_CYCLES).pipe(
                timeout(LIVE_REQUEST_TIMEOUT_MS),
                catchError(() => of(null)),
              ),
            ),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe((cycles) => {
            if (cycles) {
              this.recentCycles.set(cycles);
              this.cyclesError.set(false);
            } else {
              this.cyclesError.set(true);
            }
          }),
      );
      onCleanup(() => sub.unsubscribe());
    });
  }

  /** Cycle time as m:ss, or a dash when Lapper Read could not time it. */
  protected cycleTime(seconds: number | null | undefined): string {
    if (seconds == null || !Number.isFinite(seconds)) return '—';
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
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
