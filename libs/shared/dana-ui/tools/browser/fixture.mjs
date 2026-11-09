import '@angular/compiler';
import { CommonModule } from '@angular/common';
import { Component, createComponent, VERSION } from '@angular/core';
import * as angularCore from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import {
  DanaComboboxComponent, DanaConfirmDialogComponent, DanaTableDirective,
  DanaKpiGridDirective, DanaKpiCardDirective, DanaOperationGridDirective,
  DanaOperationCardComponent, DanaDashboardGridComponent, DanaDashboardPanelComponent, DanaMobileNavDirective,
} from '../../../../../dist/libs/shared/dana-ui/fesm2022/dana-ui.mjs';

class Fixture {
  disabled = false;
  value = '';
  control = new FormControl('');
  showTable = true;
  showSecondTable = false;
  open = false;
  showDialog = true;
  cancelCount = 0;
  columns = [{ label: 'Name', value: row => row }];
  options = ['Alpha', 'Beta'];
  cancel() { this.cancelCount++; this.open = false; }
}
Component({
  selector: 'dana-test-fixture', standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, DanaComboboxComponent,
    DanaConfirmDialogComponent, DanaTableDirective, DanaKpiGridDirective,
    DanaKpiCardDirective, DanaOperationGridDirective, DanaOperationCardComponent,
    DanaDashboardGridComponent, DanaDashboardPanelComponent, DanaMobileNavDirective],
  template: `
    <nav danaMobileNav #defaultNav="danaMobileNav"><button id="default-nav-toggle" (click)="defaultNav.toggle()">{{ defaultNav.open }}</button></nav>
    <nav danaMobileNav [desktopMinWidth]="1024" #gearNav="danaMobileNav"><button id="gear-nav-toggle" (click)="gearNav.toggle()">{{ gearNav.open }}</button></nav>
    <button id="launch" (click)="open = true">Open confirmation</button>
    <button id="background">Background action</button>
    <dana-confirm-dialog *ngIf="showDialog" [open]="open" title="Delete entry?" message="Confirm this action."
      [danger]="true" (cancel)="cancel()" (confirm)="open = false">
      <table *ngIf="open" danaTable id="modal-table"><thead><tr><th>Modal row</th></tr></thead><tbody><tr><td>Alpha</td></tr></tbody></table>
    </dana-confirm-dialog>
    <div danaKpiGrid><div danaKpiCard>First KPI</div><div danaKpiCard>Second KPI</div></div>
    <div danaOperationGrid><a danaOperationCard href="#operation" heading="Operation" description="Description" icon="search"></a></div>
    <div danaDashboardGrid><section danaDashboardPanel>Panel</section></div>
    <div id="overflow" style="overflow: auto; height: 120px; margin-top: 20px;">
      <div style="height: 30px;"></div>
      <dana-combobox id="direct" [options]="options" [columns]="columns" ariaLabel="Direct selection"
        [(ngModel)]="value" [disabled]="disabled"></dana-combobox>
      <div style="height: 300px;"></div>
    </div>
    <dana-combobox id="reactive" [options]="options" [columns]="columns" ariaLabel="Reactive selection" [formControl]="control"></dana-combobox>
    <table *ngIf="showTable" danaTable id="table">
      <thead><tr><th>Name</th><th>Load</th></tr></thead>
      <tbody><tr><td>Beta</td><td>2</td></tr><tr><td>Alpha</td><td>1</td></tr></tbody>
    </table>
    <table *ngIf="showSecondTable" danaTable id="table2"><thead><tr><th>Other</th></tr></thead><tbody></tbody></table>
  `,
})(Fixture);

(async () => {
  const provideZoneless = Reflect.get(angularCore, VERSION.major === '19' ? 'provideExperimentalZonelessChangeDetection' : 'provideZonelessChangeDetection');
  const app = await createApplication({ providers: [provideZoneless()] });
  const ref = createComponent(Fixture, {
    hostElement: document.querySelector('dana-test-fixture'), environmentInjector: app.injector,
  });
  app.attachView(ref.hostView);
  ref.changeDetectorRef.detectChanges();
  window.fixture = ref;
})().catch(error => { window.fixtureError = String(error); });
