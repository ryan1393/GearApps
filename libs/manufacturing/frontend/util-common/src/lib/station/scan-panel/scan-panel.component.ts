import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { expectedScanInput } from '../focus-expected-scan';
import { heldScanIgnoredText } from '../status-line';

/** Every live scan panel by its host element, so a held scan can be handed to the step that is now expected. */
const panels = new WeakMap<Element, ScanPanelComponent>();

@Component({
  selector: 'gear-scan-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scan-panel.component.html',
  styles: [`.gear-scan-step { padding: var(--dana-panel-padding); gap: var(--dana-space-4); }`],
  host: { '[attr.data-state]': 'state' },
})
export class ScanPanelComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() step = 1;
  @Input() label = 'Scan';
  @Input() help = '';
  @Input() placeholder = 'Scan barcode...';
  @Input() buttonText = 'Scan';
  /** Not usable yet (an earlier step is missing). The box cannot take the cursor. */
  @Input() disabled = false;
  /**
   * The station is working on a request. The box stays focused but read-only, and a scan made now is
   * held (one at most) and given to the expected step when the work finishes.
   */
  @Input() busy = false;
  @Input() autoFocus = true;
  /** The value this step has locked in. While set, the step shows it with a Change button instead of the scan box. */
  @Input() doneValue: string | null = null;
  @Input() changeText = 'Change';
  @Output() scanned = new EventEmitter<string>();
  /** The operator tapped Change on a completed step. */
  @Output() reopen = new EventEmitter<void>();
  /** A scan held while busy could not be used, because the step it followed did not move on. */
  @Output() heldScanIgnored = new EventEmitter<string>();
  @ViewChild('input') input?: ElementRef<HTMLInputElement>;

  private static nextId = 1;
  readonly inputId = `gear-scan-${ScanPanelComponent.nextId++}`;
  private readonly host: ElementRef<HTMLElement> | null = inject(ElementRef, { optional: true });

  value = '';
  /** What the scanner is typing while the station is busy. */
  private typed = '';
  /** A complete scan made while busy, waiting for the current step to finish. */
  held: string | null = null;
  /** Where the held scan will go, or why it was not used. Shown under the box. */
  note = '';
  /** The station area the held scan belongs to, kept so it can still be handed on if this step closes. */
  private heldArea: HTMLElement | null = null;

  constructor() {
    if (this.host) panels.set(this.host.nativeElement, this);
  }

  get describedBy(): string | null {
    const ids = [this.help ? this.inputId + '-help' : '', this.note ? this.inputId + '-note' : ''].filter(Boolean);
    return ids.length ? ids.join(' ') : null;
  }

  ngAfterViewInit(): void {
    this.claimFocus();
  }

  ngOnDestroy(): void {
    if (this.host) panels.delete(this.host.nativeElement);
    // The step closed (e.g. its shelf was scanned and the tray is done): the held scan still goes on.
    if (this.held) this.releaseHeld(true);
  }

  /** done: value locked in · disabled: not usable yet · ready: waiting for a scan. Styled by the operations station. */
  get state(): 'done' | 'disabled' | 'ready' {
    return this.doneValue ? 'done' : this.disabled ? 'disabled' : 'ready';
  }

  /**
   * A panel is disabled until an earlier step is done. When it becomes usable again it is the next
   * expected scan. A step reopened with Change is where the operator is about to scan, so it takes the
   * cursor. When the station stops being busy, a held scan is handed on.
   */
  ngOnChanges(changes: SimpleChanges): void {
    const disabled = changes['disabled'];
    const done = changes['doneValue'];
    const busy = changes['busy'];
    if (busy && !busy.firstChange && busy.previousValue && !this.busy) {
      // A scan still arriving when the work finished carries on in the box.
      if (this.typed) this.value = this.typed;
      this.typed = '';
      if (this.held) this.releaseHeld(false);
    }
    if (done && !done.firstChange && done.previousValue && !this.doneValue) {
      this.value = '';
      this.focus();
      return;
    }
    if (disabled && !disabled.firstChange && !this.disabled) this.claimFocus();
    if (busy && !busy.firstChange && !this.busy) this.claimFocus();
  }

  /**
   * Enter submits. While the station is busy the box is read-only, so the keys a scanner types are
   * collected here instead, and its Enter holds the scan for when the current step finishes.
   */
  onKeydown(event: KeyboardEvent): void {
    if (!this.busy) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.submit();
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const scan = this.typed.trim();
      this.typed = '';
      if (scan) this.hold(scan);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.typed += event.key;
    }
  }

  /** Keep one scan for later; a newer scan replaces it. */
  hold(scan: string): void {
    const replaced = this.held;
    this.held = scan;
    this.heldArea = this.area();
    this.note = replaced && replaced !== scan
      ? `Scan ${scan} is waiting (it replaces ${replaced}). It runs when this step finishes.`
      : `Scan ${scan} is waiting. It runs when this step finishes.`;
  }

  /**
   * Give the held scan to the scan box the station now expects. If that is still this box and the step
   * has not moved on (it failed, or the same scan is expected again), the scan is not guessed at: the
   * operator is told to scan it again.
   */
  private releaseHeld(closing: boolean): void {
    const scan = this.held;
    const area = this.heldArea ?? this.area();
    this.held = null;
    this.heldArea = null;
    if (!scan) return;
    const startedReady = !closing && this.state === 'ready';
    // After the station has rendered whatever the finished step opened.
    setTimeout(() => {
      const input = expectedScanInput(area);
      const target = input ? panels.get(input.closest('gear-scan-panel') as Element) : undefined;
      if (target && target !== this) {
        this.note = '';
        target.acceptScan(scan);
        return;
      }
      // Not used: say so beside this box when it is still showing, and tell the page (for its status line).
      if (!closing && startedReady) {
        this.note = heldScanIgnoredText(scan);
        this.select();
      }
      this.heldScanIgnored.emit(scan);
    });
  }

  /** A scan handed on from another step: as if it had been scanned here. */
  acceptScan(scan: string): void {
    if (this.disabled || this.doneValue) return;
    this.value = scan;
    this.note = '';
    this.input?.nativeElement.focus();
    this.submit();
  }

  private area(): HTMLElement | null {
    const host = this.host?.nativeElement;
    return host?.closest<HTMLElement>('.op-page') ?? host?.parentElement ?? null;
  }

  /**
   * Take the cursor when nothing else has it, or when it is still sitting in an earlier
   * scan step. Never take it from a field or button the operator chose (except a yielding one).
   */
  private claimFocus(): void {
    if (!this.autoFocus || this.disabled || this.doneValue) return;
    this.whenInputReady((input) => {
      const active = document.activeElement as HTMLElement | null;
      // Controls marked data-gear-yield-focus (the station's operation tabs) never keep a scan.
      const idle = !active || active === document.body || Boolean(active.closest('[data-gear-yield-focus]'));
      const earlierStep = Number(active?.dataset?.['gearScanStep']);
      if (idle || (Number.isFinite(earlierStep) && earlierStep < this.step)) {
        input.focus();
        input.select();
      }
    });
  }

  /**
   * Run after the current change-detection pass. ngModel applies [disabled] to the element
   * one microtask late, so a microtask here would still see a disabled input that cannot
   * take focus; a timer runs after both.
   */
  private whenInputReady(action: (input: HTMLInputElement) => void): void {
    setTimeout(() => {
      const input = this.input?.nativeElement;
      if (input && !input.disabled) action(input);
    });
  }

  submit() {
    const value = this.value.trim();
    if (!value || this.disabled || this.busy) return;
    this.note = '';
    // Leave the scanned value visible but selected, so the next scan replaces it instead of appending to it.
    this.input?.nativeElement.select();
    this.scanned.emit(value);
  }

  /** A tap into the box selects what is there, so the next scan replaces an old value instead of appending to it. */
  selectOnFocus() {
    setTimeout(() => {
      const input = this.input?.nativeElement;
      if (input && document.activeElement === input) input.select();
    });
  }

  clearAndFocus() {
    this.value = '';
    this.whenInputReady((input) => input.focus());
  }

  select() {
    this.whenInputReady((input) => {
      input.focus();
      input.select();
    });
  }

  focus() {
    this.whenInputReady((input) => {
      input.focus();
      input.select();
    });
  }
}
