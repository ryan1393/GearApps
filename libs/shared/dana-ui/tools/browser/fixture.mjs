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
  DanaButtonDirective, DanaToastHostComponent, DanaToastService, DanaTabsDirective, DanaTabDirective,
  DanaAlertDirective,
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
  submitCount = 0;
  headerActionCount = 0;
  alternateHeader = false;
  rowSuffix = '';
  staticHeader = false;
  headerLabel = 'Application heading';
  headerTabindex = 7;
  headerSort = 'other';
  saveBlocked = true;
  loads = [2, 1];
  activeTab = '';
  alertTone = 'info';
  columns = [{ label: 'Name', value: row => row }];
  options = ['Alpha', 'Beta'];
  cancel() { this.cancelCount++; this.open = false; }
}
Component({
  selector: 'dana-test-fixture', standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, DanaComboboxComponent,
    DanaConfirmDialogComponent, DanaTableDirective, DanaKpiGridDirective,
    DanaKpiCardDirective, DanaOperationGridDirective, DanaOperationCardComponent,
    DanaDashboardGridComponent, DanaDashboardPanelComponent, DanaMobileNavDirective, DanaButtonDirective, DanaToastHostComponent, DanaTabsDirective,
    DanaTabDirective, DanaAlertDirective],
  template: `
    <a class="dana-skip-link" id="skip-link" href="#fixture-main">Skip to content</a>
    <nav danaMobileNav #defaultNav="danaMobileNav"><button id="default-nav-toggle" (click)="defaultNav.toggle()">{{ defaultNav.open }}</button></nav>
    <nav danaMobileNav [desktopMinWidth]="1024" #gearNav="danaMobileNav"><button id="gear-nav-toggle" (click)="gearNav.toggle()">{{ gearNav.open }}</button></nav>
    <button id="launch" (click)="open = true">Open confirmation</button>
    <div danaTabs id="tabs" aria-label="Views"><button danaTab type="button" id="tab-a" [active]="activeTab === 'a'">First view</button><button danaTab type="button" id="tab-b" [active]="activeTab === 'b'">Second view</button></div>
    <div id="alert" [danaAlert]="alertTone">Alert text</div>
    <div id="save-row"><button id="save" type="button" danaButton="primary" [disabled]="saveBlocked" danaDisabledReason="Scan a tray first.">Save</button></div>
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
      <form id="pick-form" (ngSubmit)="submitCount = submitCount + 1">
      <dana-combobox id="direct" [options]="options" [columns]="columns" ariaLabel="Direct selection"
        name="directSelection" [(ngModel)]="value" [disabled]="disabled"></dana-combobox>
      </form>
      <div style="height: 300px;"></div>
    </div>
    <dana-combobox id="reactive" [options]="options" [columns]="columns" ariaLabel="Reactive selection" [formControl]="control"></dana-combobox>
    <table *ngIf="showTable" danaTable id="table">
      <thead *ngIf="!alternateHeader"><tr><th [attr.data-dana-table-static]="staticHeader ? '' : null"
        [attr.aria-label]="headerLabel" [attr.tabindex]="headerTabindex" [attr.aria-sort]="headerSort">Name <button id="header-action" type="button" (click)="headerActionCount = headerActionCount + 1">Refresh</button></th><th>Load</th></tr></thead>
      <thead *ngIf="alternateHeader"><tr><th>Replacement</th><th>Count</th></tr></thead>
      <tbody><tr><td>Beta</td><td>{{ loads[0] }}</td></tr><tr><td>Alpha <span>{{ rowSuffix }}</span><button id="row-action" type="button">Inspect</button></td><td>{{ loads[1] }}</td></tr></tbody>
    </table>
    <table *ngIf="showSecondTable" danaTable id="table2"><thead><tr><th>Other</th></tr></thead><tbody></tbody></table>
    <button id="drawer-opener" type="button" (click)="drawer.toggle()">Open navigation</button>
    <aside id="modal-nav" danaMobileNav [desktopMinWidth]="1024" [modal]="true" #drawer="danaMobileNav"
      [style.visibility]="drawer.open ? 'visible' : 'hidden'" [style.transform]="drawer.open ? 'none' : 'translateX(-105%)'"
      aria-label="Test navigation">
      <button id="drawer-close" type="button" (click)="drawer.close()">Close navigation</button>
      <button type="button" disabled>Disabled navigation action</button>
      <a href="#fixture-main">Navigation destination</a>
      <button id="drawer-last" type="button">Last navigation action</button>
    </aside>
    <main id="fixture-main" tabindex="-1"><h1>Fixture content</h1></main>
    <dana-toast-host></dana-toast-host>
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
  window.toast = ref.injector.get(DanaToastService);
})().catch(error => { window.fixtureError = String(error); });
