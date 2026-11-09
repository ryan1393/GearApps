import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This fixture tests the generated public package, not an internal relative source import.
import {
  DanaComboboxComponent, DanaConfirmDialogComponent, DanaKpiGridDirective,
  DanaKpiCardDirective, DanaOperationGridDirective, DanaOperationCardComponent,
  DanaTableDirective,
} from '@dana/ui';

@Component({
  selector: 'dana-aot-consumer',
  standalone: true,
  imports: [FormsModule, DanaComboboxComponent, DanaConfirmDialogComponent,
    DanaKpiGridDirective, DanaKpiCardDirective, DanaOperationGridDirective,
    DanaOperationCardComponent, DanaTableDirective],
  template: `
    <dana-combobox [options]="rows" [columns]="columns" [disabled]="disabled" [(ngModel)]="value"></dana-combobox>
    <dana-confirm-dialog [open]="open" (cancel)="open = false"></dana-confirm-dialog>
    <div danaKpiGrid><div danaKpiCard>KPI</div></div>
    <div danaOperationGrid><a danaOperationCard heading="Operation"></a></div>
    <table danaTable><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Alpha</td></tr></tbody></table>
  `,
})
export class Consumer {
  value = '';
  disabled = false;
  open = false;
  rows = ['Alpha'];
  columns = [{ label: 'Name', value: (row: string) => row }];
}
