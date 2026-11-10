import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, Input, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { LabelPrinterChoice, LabelPrinterChoiceService, LabelType } from './label-printer-choice.service';

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
        <p class="gear-printer-picker-note" role="status" *ngIf="!loading">
          <ng-container *ngIf="failed">Printers could not be loaded. The default printer is used.</ng-container>
          <ng-container *ngIf="!failed && defaultName">{{ label }}: {{ defaultName }}</ng-container>
          <ng-container *ngIf="!failed && !defaultName">No {{ noun }} printer is set up, so {{ noun }}s download as files. An administrator can add one in Admin › Label Printers.</ng-container>
        </p>
      </ng-template>
    </div>
  `,
  styles: [`
    /* Layout only. Colours, type and controls come from Dana UI. */
    .gear-printer-picker { display: flex; align-items: flex-end; min-width: 0; }
    .gear-printer-picker .gear-field { display: grid; gap: .25rem; min-width: 16rem; max-width: 26rem; margin: 0; }
    .gear-printer-picker-note { margin: 0; font-size: .875rem; opacity: .8; max-width: 34rem; }
  `],
})
export class GearLabelPrinterPickerComponent implements OnInit {
  private readonly choice = inject(LabelPrinterChoiceService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  @Input() labelType: LabelType = 'ASSET_TAG';
  @Input() label = 'Print tags to';

  printers: LabelPrinterChoice[] = [];
  defaultName: string | null = null;
  selectedId = '';
  loading = true;
  failed = false;

  get noun(): string {
    return this.labelType === 'CUTTER_CARD' ? 'cutter card' : 'tag';
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
