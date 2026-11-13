import { Directive, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';
import { DanaComboboxComponent } from '@dana/ui';

const normalized = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase();

/**
 * Enter in a Check-In combobox picks a row only when that is clearly what the guard meant.
 *
 * The Dana combobox highlights the first partial match on every keystroke and Enter picks the
 * highlighted row. A wedge scanner types a load number and sends Enter, so scanning `70412`
 * could pick an earlier `170412` (or a load whose trailer contains the digits) and check the
 * truck in against the wrong shipment; typing a new carrier "ABC" + Enter would become
 * "ABC Logistics". With this directive, Enter after typing picks only a row whose text or key
 * equals what was typed. Otherwise free-text fields keep the typed text and pick fields leave
 * the list open. Choosing a row with the arrow keys and Enter works as before.
 */
@Directive({ selector: 'dana-combobox[tlExactEnter]', standalone: true })
export class ComboboxExactEnterDirective implements OnInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly combobox = inject(DanaComboboxComponent);
  /** The guard moved the highlight with the keyboard since typing: Enter takes that row. */
  private navigated = false;

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { this.navigated = true; return; }
    if (event.key !== 'Enter' || this.navigated) return;
    const box = this.combobox;
    if (!box.open || box.activeIndex < 0) return;
    const typed = normalized(box.query);
    if (!typed) return;
    const exact = box.filtered.findIndex((row) =>
      normalized(box.textOf ? box.textOf(row) : '') === typed || normalized(box.keyOf(row)) === typed);
    if (exact >= 0) { box.activeIndex = exact; return; }
    // Capture phase on the host: the combobox's own Enter handler never sees this key.
    event.preventDefault();
    event.stopPropagation();
    if (box.freeText) box.close();
  };

  private readonly onInput = () => { this.navigated = false; };

  ngOnInit() {
    this.host.nativeElement.addEventListener('keydown', this.onKeydown, true);
    this.host.nativeElement.addEventListener('input', this.onInput, true);
  }

  ngOnDestroy() {
    this.host.nativeElement.removeEventListener('keydown', this.onKeydown, true);
    this.host.nativeElement.removeEventListener('input', this.onInput, true);
  }
}
