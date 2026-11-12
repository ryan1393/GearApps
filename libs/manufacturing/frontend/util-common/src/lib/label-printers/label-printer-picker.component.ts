import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { LabelPrinterChoice, LabelPrinterChoiceService, LabelPrinterChoices, LabelType } from './label-printer-choice.service';

/**
 * "Print to" for one kind of label. Shows the default printer and lets this computer choose
 * another; the choice is remembered here and used by every Print button for that label.
 */
@Component({
  selector: 'gear-label-printer-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-printer-picker" [attr.aria-busy]="loading">
      <label class="gear-field" *ngIf="printers.length; else noChoice">
        <span>{{ label }}</span>
        <select class="gear-select" [ngModel]="selectedId" (ngModelChange)="choose($event)" [attr.aria-label]="label">
          <option value="">{{ defaultName ? 'Default: ' + defaultName : 'No default printer' }}</option>
          <option *ngFor="let printer of printers" [value]="printer.id">{{ printer.name }} ({{ printer.language }})</option>
        </select>
      </label>
      <ng-template #noChoice>
        <p class="gear-printer-picker-note dana-field-hint" role="status" *ngIf="!loading">
          <ng-container *ngIf="failed">Printers could not be loaded. The default printer is used.</ng-container>
          <ng-container *ngIf="!failed && defaultName">{{ label }}: {{ defaultName }}</ng-container>
          <ng-container *ngIf="!failed && !defaultName">{{ noPrinterNote || 'No ' + noun + ' printer is set up, so ' + noun + 's download as files. An administrator can add one in Admin › Label Printers.' }}</ng-container>
        </p>
      </ng-template>
    </div>
  `,
  styles: [`
    /* Layout only. Colours, type and controls come from Dana UI. */
    .gear-printer-picker { display: flex; align-items: flex-end; min-width: 0; }
    .gear-printer-picker .gear-field { display: grid; gap: var(--dana-field-gap); min-width: min(16rem,100%); max-width: 26rem; margin: 0; }
    .gear-printer-picker-note { margin: 0; max-width: 34rem; }
  `],
})
export class GearLabelPrinterPickerComponent implements OnInit {
  private readonly choice = inject(LabelPrinterChoiceService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  @Input() labelType: LabelType = 'ASSET_TAG';
  @Input() label = 'Print tags to';
  /** What this picker prints, when it is not the label type's usual name (e.g. location labels on card printers). */
  @Input() nounOverride: string | null = null;
  /** Shown when no printer of this type is set up; defaults to the "download as files" note. */
  @Input() noPrinterNote: string | null = null;
  /** The printers that were found, so a page can tell whether any is set up. */
  @Output() readonly choicesLoaded = new EventEmitter<LabelPrinterChoices>();

  printers: LabelPrinterChoice[] = [];
  defaultName: string | null = null;
  selectedId = '';
  loading = true;
  failed = false;

  get noun(): string {
    return this.nounOverride ?? (this.labelType === 'CUTTER_CARD' ? 'cutter card' : 'tag');
  }

  ngOnInit(): void {
    this.selectedId = this.choice.selectedId(this.labelType) ?? '';
    this.choice.choices(this.labelType).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (choices) => {
        this.printers = choices.printers;
        this.defaultName = choices.default_printer_name;
        // A printer that was removed or switched off is forgotten, so printing falls back to the default.
        if (this.selectedId && !choices.printers.some((printer) => printer.id === this.selectedId)) this.choose('');
        this.loading = false;
        this.choicesLoaded.emit(choices);
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.failed = true;
        this.cdr.markForCheck();
      },
    });
  }

  choose(printerId: string): void {
    this.selectedId = printerId;
    this.choice.select(this.labelType, printerId || null);
  }
}
