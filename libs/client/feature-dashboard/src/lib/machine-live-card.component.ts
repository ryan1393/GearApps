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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FanucVariablesApi, ScannerApi, ScannerDetailsApi } from '@gearapps/client/core';
import { StatusBadgeComponent, ValueFieldComponent } from '@gearapps/client/ui';
import { Machine, MachineFanucVariable, ScannerDetail } from '@gearapps/shared/domain';
import {
  catchError,
  filter,
  forkJoin,
  fromEvent,
  interval,
  map,
  merge,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { ScannerControlsComponent } from './scanner-controls.component';

/**
 * Live tile for one machine: scanner capture, serial-number slots and Fanuc I/O.
 * Polls while the tab is visible; stops when hidden or destroyed and frees blob URLs.
 */
@Component({
  selector: 'gear-machine-live-card',
  imports: [StatusBadgeComponent, ValueFieldComponent, ScannerControlsComponent],
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
        <div class="gear-live-image">
          @if (imageUrl()) {
            <img [src]="imageUrl()" alt="Latest scanner capture for {{ machine().number }}" />
          } @else if (!scanner()) {
            <div class="gear-live-placeholder">No scanner assigned</div>
          } @else if (imageError()) {
            <div class="gear-live-placeholder is-error">Image unavailable</div>
          } @else {
            <div class="gear-live-placeholder">Loading…</div>
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
            </div>
            @if (fanucError()) {
              <p class="gear-field-help">No I/O snapshot recorded for this machine yet.</p>
            }
          </div>
        </div>
      </div>

      @if (scanner(); as s) {
        <footer class="gear-live-foot">
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
      margin-top: 4px;
      font-size: 12px;
    }
    .gear-live-status {
      display: grid;
      justify-items: end;
      gap: 4px;
      font-size: 12px;
    }
    .gear-live-body {
      display: grid;
      grid-template-columns: minmax(200px, 1.1fr) 1fr;
      gap: 14px;
    }
    .gear-live-image {
      aspect-ratio: 1;
      background: #0f1b2c;
      border-radius: var(--dana-radius-md);
      overflow: hidden;
      display: grid;
      place-items: center;
    }
    .gear-live-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
    .gear-live-placeholder {
      color: #9fb0c6;
      font-size: 13px;
      font-weight: 700;
    }
    .gear-live-placeholder.is-error {
      color: #f3b48f;
    }
    .gear-live-data {
      display: grid;
      gap: 12px;
      align-content: start;
    }
    .gear-live-fields {
      display: grid;
      gap: 8px;
    }
    .dana-section-title {
      margin-bottom: 10px;
    }
    .gear-live-foot {
      display: grid;
      gap: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--dana-border);
    }
    @media (max-width: 640px) {
      .gear-live-body {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class MachineLiveCardComponent implements OnDestroy {
  private readonly scannerApi = inject(ScannerApi);
  private readonly scannerDetails = inject(ScannerDetailsApi);
  private readonly fanucApi = inject(FanucVariablesApi);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly machine = input.required<Machine>();
  /** Refresh period in ms. */
  readonly pollMs = input(2000);

  protected readonly scanner = signal<ScannerDetail | null>(null);
  protected readonly fanuc = signal<MachineFanucVariable | null>(null);
  protected readonly imageUrl = signal<string | null>(null);
  protected readonly imageError = signal(false);
  protected readonly fanucError = signal(false);
  protected readonly lastUpdate = signal<string | null>(null);
  protected readonly controlsOpen = signal(false);
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
      const period = this.pollMs();
      untracked(() => {
        this.revokeImage();
        this.scanner.set(machine.scanner ?? null);
        this.imageError.set(false);
      });

      const sub = visible$
        .pipe(
          switchMap((visible) => (visible ? interval(period).pipe(startWith(0)) : of())),
          filter(() => this.doc.visibilityState === 'visible'),
          switchMap(() =>
            forkJoin({
              image: scannerId
                ? this.scannerApi.image(scannerId).pipe(catchError(() => of(null)))
                : of(undefined),
              scanner: scannerId
                ? this.scannerDetails.get(scannerId).pipe(catchError(() => of(null)))
                : of(undefined),
              fanuc: this.fanucApi.byMachine(machine.id).pipe(catchError(() => of(null))),
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
          this.fanuc.set(fanuc);
          this.fanucError.set(fanuc === null);
          this.lastUpdate.set(new Date().toLocaleTimeString());
        });

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
