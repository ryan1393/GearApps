import { readFeatureSource } from './source-contract-utils.mjs';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(p,'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg);console.log(`[OK] ${msg}`)};
// Wording on Dana UI screens is sentence case; match operator text case-insensitively.
const has=(source,text)=>source.toLocaleLowerCase().includes(text.toLocaleLowerCase());

const app=read('apps/truck-log/src/app/app.component.ts');
const api=read('libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts');
const dashboard=read('libs/truck-log/web/feature/dashboard/src/lib/dashboard.component.ts');
const checkin=(read('libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts') + '\n' + read('libs/truck-log/web/feature/check-in/src/lib/check-in.component.html'));
const dock=read('libs/truck-log/web/feature/dock-board/src/lib/dock-board.component.ts');
const active=read('libs/truck-log/web/feature/active-trucks/src/lib/active-trucks.component.ts');
const history=read('libs/truck-log/web/feature/history/src/lib/history.component.ts');
const admin=(function adminFeatureSource(){const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(d+'/'+e.name):e.name.endsWith('.ts')?[d+'/'+e.name]:[]);return walk('libs/truck-log/web/feature/admin/src/lib').sort().map((f)=>fs.readFileSync(f,'utf8')).join('\n');})() /* admin.component.ts + one component per tab */;
const health=read('libs/truck-log/server/feature/health/src/lib/health.controller.ts');
// The visits lib splits TruckVisitsService into model/query/upload/RXO modules; read them together.
const service=readFeatureSource(process.cwd(), 'libs/truck-log/server/feature/visits/src/lib', ['.ts']);
const aging=read('libs/truck-log/web/domain/src/lib/dock-age.ts');
const settingsController=read('libs/truck-log/server/feature/settings/src/lib/app-settings.controller.ts');
const settingsService=read('libs/truck-log/server/feature/settings/src/lib/app-settings.service.ts');
const scheduledController=read('libs/truck-log/server/feature/scheduled-loads/src/lib/scheduled-loads.controller.ts');
const scheduledService=read('libs/truck-log/server/feature/scheduled-loads/src/lib/scheduled-loads.service.ts');
const toastService=read('libs/truck-log/web/ui/src/lib/toast.service.ts');
const checkoutDialog=read('libs/truck-log/web/ui/src/lib/final-checkout-dialog.component.ts');
const toastHost=read('libs/truck-log/web/ui/src/lib/toast-host.component.ts');

must(app.includes('api.health()') && app.includes('System Ready'), 'Topbar system badge uses real health endpoint');
must(app.includes("router.navigate(['/history']") && app.includes('global-search'), 'Global operator search routes to visit records');
must(dashboard.includes('createPoller({') && dashboard.includes('intervalMs: 15000') && dashboard.includes('Needs Guard Action'), 'Guard dashboard auto-refreshes (shared non-overlapping poller) and prioritizes final checkout');
must(dock.includes('setInterval') && dock.includes('Dock Complete — Send to Guard') && dock.includes('dockAgeMinutes') && has(dock,'At Dock'), 'Dock board auto-refreshes, sorts longest-at-dock first, and shows dock wait time');
must(active.includes('Ready for Final Guard Checkout') && active.includes('Record'), 'Active trucks separates guard action queue and record access');
must(checkin.includes('Check-In Details') && checkin.includes('Load &amp; Route') && checkin.includes('Driver &amp; Equipment') && checkin.includes('Dock Assignment') && checkin.includes('requiredComplete') && checkin.includes('dana-segmented'), 'Check-in groups required operator fields into three scan-friendly sections');
must(checkin.includes('missingRequiredItems') && checkin.includes('required item') && checkin.includes('aria-label="Required items still needed"') && checkin.includes('*ngFor="let item of visibleMissingRequiredItems"'), 'Check-in names the required items still missing instead of showing only a generic blocked state');
must(dock.includes("a missing PDF doesn't block completion") && dock.includes('Not attached (optional)') && dock.includes('[disabled]="busy || uploadingVisitId===visit.id" (click)="askComplete(visit)"') && !dock.includes('|| !packingSlip(visit)'), 'missing packing-slip PDF is a warning, not a Dock Complete block');
const requiredTags=(checkin.match(/dana-field-tag is-required">Required</g)??[]).length;
must(checkin.includes('{{requiredComplete}} of 10 required items complete') && checkin.includes('aria-valuemax="10"') && requiredTags===10 && /id="checkin-load-label">Load Number<\/label>\s*<span class="dana-field-tag is-required">Required<\/span>/.test(checkin) && /for="checkin-driver-phone">Driver Phone<\/label><span class="dana-field-tag is-required">Required<\/span>/.test(checkin) && checkin.includes("['Driver Phone', this.driverPhoneValid]") && checkin.includes('Tractor ID') && checkin.includes('Origin') && checkin.includes('Destination'), 'Check-in exposes ten required fields including Load Number and Driver Phone');
must(checkin.includes('form.isDropTrailer=false') && checkin.includes('form.isDropTrailer=true'), 'Drop Trailer defaults to No and can be switched to Yes when needed');
must(checkin.includes("setDirection('INBOUND')") && checkin.includes("setDirection('OUTBOUND')") && /<input \*ngIf="form\.direction==='OUTBOUND'"[^>]*aria-label="Origin"[^>]*\[value\]="plantLocationName" readonly>/.test(checkin) && /<input \*ngIf="form\.direction==='INBOUND'"[^>]*aria-label="Destination"[^>]*\[value\]="plantLocationName" readonly>/.test(checkin), 'Direction auto-fills and locks the Fort Wayne plant-side endpoint');
must(checkin.includes('counts as unscheduled') && checkin.includes('dana-field-static') && checkin.includes('lookupSchedule()') && !checkin.includes('type="datetime-local"'), 'Scheduled time is read-only and sourced from scheduled loads');
must(checkin.includes('retryPaperwork') && checkin.includes('removeFile'), 'Paperwork can be removed before save and retried after upload failure');
must(history.includes('All records') && history.includes('Add Paperwork') && history.includes('Visit Timeline'), 'Records page searches all visits and supports paperwork recovery');
must(service.includes("status = 'ALL'") && service.includes('loadRelationCountAndMap'), 'Records API supports all statuses and document counts');
must(health.includes('TRUCK_LOG_DOCUMENT_STORAGE_ROOT') && health.includes('constants.R_OK | constants.W_OK'), 'Health endpoint checks document storage read/write access');
must(dashboard.includes('[attr.data-tone]="ageTone(visit)"') && dock.includes('[attr.data-tone]="ageTone(visit)"') && active.includes('[attr.data-tone]="ageTone(v)"') && [dashboard,dock,active].every((s)=>s.includes('dockAgeTone(')), 'Dock aging colors apply across Dashboard, Dock Board, and Active Trucks');
must(aging.includes("visit.status !== 'DOCK_ASSIGNED'") && aging.includes('dockAssignedAt') && aging.includes('dock-age-warning') && aging.includes('dock-age-critical'), 'Dock aging is based on dock_assigned_at and only applies while still assigned to the dock');
must(has(admin,'Dock Time Alerts') && admin.includes('Yellow after (minutes)') && admin.includes('Red after (minutes)') && admin.includes('saveDockAging()'), 'Settings exposes editable yellow/red dock-time thresholds');
must(fs.readFileSync('libs/truck-log/web/feature/admin/src/lib/admin.component.ts','utf8').includes('Drivers') && fs.readFileSync('libs/truck-log/web/feature/admin/src/lib/admin.component.ts','utf8').includes('Carriers') && fs.readFileSync('libs/truck-log/web/feature/admin/src/lib/admin.component.ts','utf8').includes('Locations'), "Administration exposes reusable Drivers, Carriers, and Locations");
const freeTextCombobox=(label)=>new RegExp(`<dana-combobox[^>]*\\[freeText\\]="true"[^>]*ariaLabel="${label}"`).test(checkin);
must(['Driver name','Carrier','Origin','Destination'].every(freeTextCombobox) && checkin.includes('[options]="referenceDrivers"') && checkin.includes('[options]="referenceCarriers"') && checkin.includes('[options]="referenceLocations"'), 'Check-In offers reusable reference-data suggestions while retaining free-text inputs');
must(checkin.includes('driverSelectionChanged') && checkin.includes('form.driverPhone'), 'Selecting a known driver can reuse the saved phone number');
must(settingsController.includes("@Get('dock-aging')") && settingsController.includes("@Patch('dock-aging')"), 'Dock aging settings have read/update API endpoints');
must(settingsService.includes('dock_warning_minutes') && settingsService.includes('dock_critical_minutes') && settingsService.includes('criticalMinutes <= dto.warningMinutes'), 'Dock aging thresholds are database-backed and validated');

must(has(admin,'Scheduled Loads') && has(admin,'Download Excel Template') && has(admin,'Upload Schedule') && admin.includes('chooseScheduleFile'), 'Settings exposes Excel scheduled-load template/download/upload workflow');
must(api.includes('importScheduledLoads') && api.includes('scheduledLoadsTemplateUrl') && api.includes('scheduledLoads()'), 'Browser API exposes scheduled-load Excel import/list/template calls');
must(scheduledController.includes("@Post('import')") && scheduledController.includes("@Get('template')") && scheduledController.includes("@Get()"), 'Scheduled-load API exposes list/template/import endpoints');
must(scheduledService.includes('importWorkbook') && scheduledService.includes('templateWorkbook') && scheduledService.includes('MAX_IMPORT_ROWS'), 'Scheduled-load service validates/imports Excel workbooks and generates the template');

must(app.includes('ToastHostComponent') && app.includes('<truck-log-toast-host />'), 'Shared toast host is mounted once at the application shell');
must(toastService.includes('BehaviorSubject<ToastNotice[]>') && toastService.includes('success(') && toastService.includes('warning(') && toastService.includes('error(') && toastService.includes('window.setTimeout'), 'Shared toast service supports transient success/warning/error notices');
must(toastHost.includes('dana-toast-stack') && toastHost.includes('aria-live="polite"') && toastHost.includes('toast-success') && toastHost.includes('toast-warning') && toastHost.includes('toast-error'), 'Toast host renders success/warning/error notifications in a shared overlay');
must(active.includes('<tl-final-checkout-dialog') && checkoutDialog.includes('this.toast.success') && checkoutDialog.includes('Final checkout complete') && !active.includes('<div class="success" *ngIf="message">'), 'Active Trucks final checkout uses toast success instead of persistent green banner');
must(dashboard.includes('<tl-final-checkout-dialog') && checkoutDialog.includes('this.toast.success') && checkoutDialog.includes('Final checkout complete'), 'Guard Dashboard final checkout uses the shared success toast');
must(dock.includes('ToastService') && dock.includes('this.toast.success') && dock.includes('Dock complete') && !dock.includes('<div class="success" *ngIf="message">') && !dock.includes('<div class="error" *ngIf="error">'), 'Dock Board action notifications use shared toasts instead of page banners');
must(checkin.includes('ToastService') && checkin.includes('Truck checked in') && checkin.includes('Paperwork needs attention') && !checkin.includes('<div class="success" *ngIf="success">') && !checkin.includes('<div class="error" *ngIf="error">'), 'Check-In action notifications use shared toasts while retaining retry state');
must(history.includes('ToastService') && history.includes('Paperwork added') && history.includes('Paperwork upload failed') && !history.includes('<div class="success" *ngIf="message">') && !history.includes('<div class="error" *ngIf="error">'), 'Records and Paperwork action notifications use shared toasts');
must(admin.includes('ToastService') && admin.includes('Schedule import complete') && admin.includes('Dock alerts saved') && admin.includes('Dock added') && !admin.includes('<div class="success" *ngIf="message">'), 'Settings actions use shared toasts');
must(![dashboard,dock,active,history,admin,checkin].some((s)=>/<div class="(?:success|error)" \*ngIf="(?:message|error|success)"/.test(s)), 'Transient page-level success/error notification banners are removed from operator pages');

must(![dashboard,dock,active,admin].some((s)=>/\b(alert|confirm)\(/.test(s)), 'Operator pages do not use browser alert/confirm popups');
must(!admin.includes('Web Port') && !admin.includes('API Port'), 'Operator settings screen hides deployment-only port details');
must(api.includes("private readonly base = '/api/v1'"), 'Browser API remains same-origin');
console.log('[PASS] Truck Log operator flow contract.');
