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
import { LiveCycleTimerComponent, StatusBadgeComponent } from '@meshforge/client/ui';
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
  imports: [DatePipe, StatusBadgeComponent, ScannerControlsComponent, LiveCycleTimerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="dana-card gear-live-card"
      [class.gear-live-focused]="focused()"
      [class.gear-live-fit]="fit()"
      [attr.data-tone]="isOn(fanuc()?.y03_2_stack_inCycle) ? 'success' : null"
    >
      <header class="gear-live-head">
        <div class="gear-live-ident">
          <span class="dana-card-title">{{ machine().number || machine().ip }}</span>
          <span class="gear-muted gear-live-meta"
            ><code>{{ machine().ip }}</code>
            @if (machine().builder) {
              <span class="gear-live-builder">&nbsp;· {{ machine().builder }}</span>
            }
          </span>
        </div>
        <div class="gear-live-corner">
          @if (live()) {
            <span class="gear-live-feed dana-status-badge" data-tone="success" role="status">Live · {{ periodLabel() }}</span>
          }
          <gear-status-badge [status]="machine().status" />
          @if (lastUpdate()) {
            <small class="gear-muted gear-live-updated" title="Last refresh">{{ lastUpdate() }}</small>
          }
          @if (!focused()) {
            <button
              type="button"
              class="gear-btn gear-btn-secondary gear-btn-sm"
              (click)="focusMachine.emit()"
              [attr.aria-label]="'Show only ' + (machine().number || machine().ip)"
              title="Show only this machine"
            >
              ⤢
            </button>
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
              [title]="'FTP ' + p.folder + '/' + p.file + (p.defaultFolder ? ' (default folder: none set on this scanner)' : '')"
              >FTP <code>{{ p.folder }}/{{ p.file }}</code>{{ p.defaultFolder ? ' (default)' : '' }}</small
            >
          }
        </div>

        <div class="gear-live-data">
          <section class="gear-live-group" aria-label="Serial numbers">
            <div class="dana-section-title">Serials</div>
            <dl class="gear-kv">
              <dt class="dana-detail-label">In scanner</dt>
              <dd class="dana-detail-value mono">{{ scanner()?.sn_scanner || '—' }}</dd>
              <dt class="dana-detail-label">In queue</dt>
              <dd class="dana-detail-value mono">{{ scanner()?.sn_queue || '—' }}</dd>
              <dt class="dana-detail-label">In process</dt>
              <dd class="dana-detail-value mono">{{ scanner()?.sn_procces || '—' }}</dd>
            </dl>
          </section>

          <section class="gear-live-group" aria-label="Machine I/O">
            <div class="dana-section-title">Machine I/O</div>
            <dl class="gear-io">
              <div>
                <dt class="dana-detail-label" title="Front door closed"><span class="gear-long">Front door closed</span><span class="gear-short" aria-hidden="true">Door</span></dt>
                <dd><span class="dana-status-badge" [attr.data-tone]="tone(fanuc()?.x06_7_frt_dr_closed)">{{ onOff(fanuc()?.x06_7_frt_dr_closed) }}</span></dd>
              </div>
              <div>
                <dt class="dana-detail-label">In cycle</dt>
                <dd><span class="dana-status-badge" [attr.data-tone]="tone(fanuc()?.y03_2_stack_inCycle)">{{ onOff(fanuc()?.y03_2_stack_inCycle) }}</span></dd>
              </div>
              <div>
                <dt class="dana-detail-label" title="Cycle start"><span class="gear-long">Cycle start</span><span class="gear-short" aria-hidden="true">Start</span></dt>
                <dd><span class="dana-status-badge" [attr.data-tone]="tone(fanuc()?.x01_2_start_cycle)">{{ onOff(fanuc()?.x01_2_start_cycle) }}</span></dd>
              </div>
              <div>
                <dt class="dana-detail-label" title="Cycle time"><span class="gear-long">Cycle time</span><span class="gear-short" aria-hidden="true">Time</span></dt>
                <dd><gear-live-cycle-timer [snapshot]="fanuc()" [receivedAt]="fanucAt()" /></dd>
              </div>
            </dl>
            @if (fanucStale()) {
              <small class="gear-field-help" data-tone="warning">Did not refresh; showing the last values.</small>
            } @else if (fanucError()) {
              <small class="gear-field-help">No I/O recorded for this machine yet.</small>
            }
          </section>

          @if (scanner()) {
            <section class="gear-live-group" aria-label="Scanner I/O">
              <div class="dana-section-title" title="Outputs marked * show the state last set from MeshForge: the scanner cannot report its outputs">
                Scanner I/O <small class="gear-muted">· * last set here</small>
              </div>
              <dl class="gear-io">
                <div>
                  <dt class="dana-detail-label" title="Input 1: the photoeye"><span class="gear-long">Photoeye</span><span class="gear-short" aria-hidden="true">Eye</span></dt>
                  <dd><span class="dana-status-badge" [attr.data-tone]="tone(scannerInput(1))">{{ onOff(scannerInput(1)) }}</span></dd>
                </div>
                <div>
                  <dt class="dana-detail-label" title="Input 2"><span class="gear-long">Input 2</span><span class="gear-short" aria-hidden="true">In 2</span></dt>
                  <dd><span class="dana-status-badge" [attr.data-tone]="tone(scannerInput(2))">{{ onOff(scannerInput(2)) }}</span></dd>
                </div>
                @for (o of [1, 2]; track o) {
                  <div title="Output {{ o }} as last set from MeshForge; the scanner cannot report its outputs">
                    <dt class="dana-detail-label"><span class="gear-long">Output {{ o }}*</span><span class="gear-short" aria-hidden="true">Out {{ o }}*</span></dt>
                    <dd><span class="dana-status-badge" [attr.data-tone]="tone(scannerOutput(o))">{{ onOff(scannerOutput(o)) }}</span></dd>
                  </div>
                }
              </dl>
            </section>
          }
        </div>
      </div>

      <section class="gear-live-panel" [style.--gear-live-rows]="recentCount()" [attr.aria-label]="panel() === 'controls' ? 'Scanner controls' : 'Recent cycles'">
        @if (canControl()) {
          <div class="dana-tabs" role="tablist" aria-label="Card panel">
            <button type="button" class="dana-tab" role="tab" [class.is-active]="panel() === 'cycles'" [attr.aria-selected]="panel() === 'cycles'" (click)="panel.set('cycles')">
              Recent cycles
            </button>
            <button type="button" class="dana-tab" role="tab" [class.is-active]="panel() === 'controls'" [attr.aria-selected]="panel() === 'controls'" (click)="panel.set('controls')">
              Scanner controls
            </button>
          </div>
        } @else {
          <div class="dana-section-title">Recent cycles</div>
        }
        <div class="gear-live-panel-body" role="tabpanel">
          @if (panel() === 'controls' && canControl()) {
            <gear-scanner-controls [scannerId]="scanner()!.id" [io]="collector()" [compact]="fit()" />
          } @else if (recentCycles(); as cycles) {
            @if (cycles.length) {
              <table class="dana-table dana-table-compact gear-live-cycles">
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
        </div>
      </section>
    </article>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .gear-live-card {
      container-type: inline-size;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: var(--dana-space-2);
    }
    /* Sized by the page to fill the screen: every row shares the card's fixed height. */
    .gear-live-fit {
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .gear-live-head {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--dana-space-2);
    }
    .gear-live-ident {
      display: flex;
      align-items: baseline;
      gap: var(--dana-space-2);
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
    }
    .gear-live-meta {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .gear-live-corner {
      display: flex;
      flex: none;
      flex-wrap: nowrap;
      align-items: center;
      justify-content: end;
      gap: var(--dana-space-2);
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
    .gear-live-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(13rem, 1fr);
      gap: var(--dana-space-3);
      min-height: 0;
    }
    .gear-live-media {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      gap: var(--dana-space-1);
      min-height: 0;
      min-width: 0;
    }
    .gear-live-image {
      aspect-ratio: 1;
      overflow: hidden;
      display: grid;
      place-items: center;
      position: relative;
    }
    /* On a fitted screen the image takes whatever height is left instead of a fixed square. */
    .gear-live-fit .gear-live-image {
      aspect-ratio: auto;
      height: 100%;
      min-height: 0;
    }
    .gear-live-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
    /* Pinned to the frame, so the whole capture shows at any frame shape. */
    .gear-live-fit .gear-live-image img {
      position: absolute;
      inset: 0;
    }
    .gear-live-stale {
      position: absolute;
      inset: auto 0 0 0;
      text-align: center;
    }
    .gear-live-path {
      display: block;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .gear-live-data {
      display: grid;
      align-content: start;
      gap: var(--dana-space-3);
      min-height: 0;
      overflow-y: auto;
    }
    .gear-live-group {
      display: grid;
      gap: var(--dana-space-1);
    }
    .gear-live-group .dana-section-title {
      margin: 0;
    }
    /* Label left, value right: one line per value. */
    .gear-kv {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      column-gap: var(--dana-space-2);
      row-gap: 2px;
      margin: 0;
    }
    .gear-kv dt {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .gear-kv dd {
      margin: 0;
      justify-self: end;
      white-space: nowrap;
    }
    /* Label + state pairs that wrap to the card's width. */
    .gear-io {
      display: flex;
      flex-wrap: wrap;
      gap: var(--dana-space-1) var(--dana-space-3);
      margin: 0;
    }
    .gear-io > div {
      display: flex;
      align-items: center;
      gap: var(--dana-space-1);
      white-space: nowrap;
    }
    .gear-io dd {
      margin: 0;
    }
    .gear-live-panel {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: var(--dana-space-2);
      min-height: 0;
    }
    /* One height for both panels (the header row plus one row per cycle), so switching never moves the card. */
    .gear-live-fit .gear-live-panel-body {
      height: max(calc((var(--gear-live-rows, 5) + 1) * 1.75rem + 2px), 7.75rem);
      overflow: hidden;
    }
    .gear-live-panel .dana-tab {
      min-height: 2rem;
      padding-block: var(--dana-space-1);
    }
    .gear-live-cycles {
      width: 100%;
      table-layout: fixed;
    }
    .gear-live-cycles :is(th, td) {
      height: 1.75rem;
      padding-block: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .gear-live-cycles :is(th, td):nth-child(1) {
      width: 26%;
    }
    .gear-live-cycles :is(th, td):nth-child(2) {
      width: 34%;
    }
    .gear-live-cycles :is(th, td):nth-child(4) {
      width: 16%;
    }
    .gear-live-focused .gear-live-body {
      grid-template-columns: minmax(0, 2fr) minmax(18rem, 1fr);
    }
    .gear-short {
      display: none;
    }
    /* A narrow card keeps the machine number, IP, badges and Focus; the builder and clock go. */
    @container (max-width: 36rem) {
      .gear-live-builder,
      .gear-live-updated {
        display: none;
      }
      .gear-live-data {
        gap: var(--dana-space-1);
      }
      .gear-io {
        row-gap: 2px;
      }
      .gear-long {
        display: none;
      }
      .gear-short {
        display: inline;
      }
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
  /** The page sized this card to the screen: the image takes the height left over. */
  readonly fit = input(false);
  /** How many recent cycles to list. */
  readonly recentCount = input(RECENT_CYCLES);
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
  /** The bottom panel: recent cycles, or the scanner controls for those who may use them. */
  protected readonly panel = signal<'cycles' | 'controls'>('cycles');
  protected readonly canControl = computed(() => this.access.canEditSetup() && !!this.scanner());
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
      const count = this.recentCount();
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
              this.cyclesApi.recent(machineId, count).pipe(
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

  /** A FANUC or scanner flag: true, 1 and -1 (FANUC) are on; null or undefined is unknown. */
  protected isOn(value: unknown): boolean {
    return value === true || value === 1 || value === -1 || value === '1' || value === 'true';
  }
  protected onOff(value: unknown): string {
    return value == null ? '—' : this.isOn(value) ? 'ON' : 'OFF';
  }
  protected tone(value: unknown): string {
    return this.isOn(value) ? 'success' : 'neutral';
  }
  protected scannerInput(terminal: number): boolean | null {
    return this.collector()?.scanner_inputs?.[String(terminal)] ?? null;
  }
  /** As last switched from MeshForge (the scanner cannot report its outputs). */
  protected scannerOutput(terminal: number): boolean | null {
    return this.collector()?.scanner_outputs?.[String(terminal)] ?? null;
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
