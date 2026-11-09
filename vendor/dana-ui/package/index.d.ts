import * as i0 from '@angular/core';
import { AfterViewInit, OnDestroy, ElementRef, Renderer2, OnChanges, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { ControlValueAccessor } from '@angular/forms';
import * as rxjs from 'rxjs';

declare class DanaDashboardGridComponent {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaDashboardGridComponent, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<DanaDashboardGridComponent, "[danaDashboardGrid]", never, {}, {}, never, ["*"], true, never>;
}

declare class DanaDashboardPanelComponent {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaDashboardPanelComponent, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<DanaDashboardPanelComponent, "[danaDashboardPanel]", never, {}, {}, never, ["*"], true, never>;
}

declare class DanaKpiGridDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaKpiGridDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaKpiGridDirective, "[danaKpiGrid]", never, {}, {}, never, never, true, never>;
}

declare class DanaKpiCardDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaKpiCardDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaKpiCardDirective, "[danaKpiCard]", never, {}, {}, never, never, true, never>;
}

declare class DanaPanelHeaderDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaPanelHeaderDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaPanelHeaderDirective, "[danaPanelHeader]", never, {}, {}, never, never, true, never>;
}

declare class DanaPanelActionDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaPanelActionDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaPanelActionDirective, "[danaPanelAction]", never, {}, {}, never, never, true, never>;
}

declare class DanaTableShellDirective {
    readonly hostClass = true;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaTableShellDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaTableShellDirective, "[danaTableShell]", never, {}, {}, never, never, true, never>;
}

declare class DanaTableDirective implements AfterViewInit, OnDestroy {
    private readonly host;
    private readonly renderer;
    private readonly filters;
    private sortColumn;
    private sortDirection;
    private observer?;
    private destroyed;
    private updateScheduled;
    private readonly popovers;
    private readonly cleanups;
    private applying;
    private openPopover?;
    private openTrigger?;
    constructor(host: ElementRef<HTMLTableElement>, renderer: Renderer2);
    ngAfterViewInit(): void;
    ngOnDestroy(): void;
    private listen;
    private danaTableConnectObserver;
    private danaTableInitialize;
    private danaTableCreatePopover;
    private danaTablePositionOpenPopover;
    private danaTableClosePopover;
    private danaTableUpdateSortIndicators;
    private danaTableApplyFilters;
    private danaTableBuildRowGroups;
    private danaTableSyncNoMatchState;
    private danaTableCompare;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaTableDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaTableDirective, "table[danaTable]", never, {}, {}, never, never, true, never>;
}

declare class DanaCountBadgeDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaCountBadgeDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaCountBadgeDirective, "[danaCountBadge]", never, {}, {}, never, never, true, never>;
}

declare class DanaStatusBadgeDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaStatusBadgeDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaStatusBadgeDirective, "[danaStatusBadge]", never, {}, {}, never, never, true, never>;
}

declare class DanaLoadingStateDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaLoadingStateDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaLoadingStateDirective, "[danaLoadingState]", never, {}, {}, never, never, true, never>;
}

declare class DanaEmptyStateDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaEmptyStateDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaEmptyStateDirective, "[danaEmptyState]", never, {}, {}, never, never, true, never>;
}

declare class DanaTableEmptyDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaTableEmptyDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaTableEmptyDirective, "td[danaTableEmpty]", never, {}, {}, never, never, true, never>;
}

declare class DanaSummaryGridDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaSummaryGridDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaSummaryGridDirective, "[danaSummaryGrid]", never, {}, {}, never, never, true, never>;
}

declare class DanaSummaryCardDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaSummaryCardDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaSummaryCardDirective, "[danaSummaryCard]", never, {}, {}, never, never, true, never>;
}

declare class DanaPageHeaderComponent {
    eyebrow: string;
    heading: string;
    description: string;
    dashboard: boolean;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaPageHeaderComponent, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<DanaPageHeaderComponent, "[danaPageHeader]", never, { "eyebrow": { "alias": "eyebrow"; "required": false; }; "heading": { "alias": "heading"; "required": false; }; "description": { "alias": "description"; "required": false; }; "dashboard": { "alias": "dashboard"; "required": false; }; }, {}, never, ["[danaPageHeaderAction]"], true, never>;
}

type DanaOperationTone = 'blue' | 'green' | 'purple' | 'orange' | 'teal' | 'gray';
declare class DanaOperationCardComponent {
    icon: string;
    tone: DanaOperationTone;
    heading: string;
    description: string;
    get resolvedIcon(): string;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaOperationCardComponent, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<DanaOperationCardComponent, "a[danaOperationCard]", never, { "icon": { "alias": "icon"; "required": false; }; "tone": { "alias": "tone"; "required": false; }; "heading": { "alias": "heading"; "required": false; }; "description": { "alias": "description"; "required": false; }; }, {}, never, never, true, never>;
}

declare class DanaOperationGridDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaOperationGridDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaOperationGridDirective, "[danaOperationGrid]", never, {}, {}, never, never, true, never>;
}

type DanaButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'dark';
declare class DanaButtonDirective {
    danaButton: DanaButtonVariant;
    get danaPrimary(): boolean;
    get gearPrimary(): boolean;
    get danaSecondary(): boolean;
    get gearSecondary(): boolean;
    get danaSuccess(): boolean;
    get gearSuccess(): boolean;
    get danaDanger(): boolean;
    get gearDanger(): boolean;
    get danaDark(): boolean;
    get gearDark(): boolean;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaButtonDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaButtonDirective, "button[danaButton], a[danaButton]", never, { "danaButton": { "alias": "danaButton"; "required": false; }; }, {}, never, never, true, never>;
}

declare class DanaIconButtonDirective {
    danaIconButton: 'default' | 'danger';
    get danger(): boolean;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaIconButtonDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaIconButtonDirective, "button[danaIconButton], a[danaIconButton]", never, { "danaIconButton": { "alias": "danaIconButton"; "required": false; }; }, {}, never, never, true, never>;
}

declare class DanaToolbarDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaToolbarDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaToolbarDirective, "[danaToolbar]", never, {}, {}, never, never, true, never>;
}

type DanaAlertTone = 'info' | 'success' | 'warning' | 'danger';
declare class DanaAlertDirective {
    danaAlert: DanaAlertTone;
    get info(): boolean;
    get success(): boolean;
    get gearSuccess(): boolean;
    get warning(): boolean;
    get gearWarning(): boolean;
    get danger(): boolean;
    get gearDanger(): boolean;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaAlertDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaAlertDirective, "[danaAlert]", never, { "danaAlert": { "alias": "danaAlert"; "required": false; }; }, {}, never, never, true, never>;
}

declare class DanaDetailGridDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaDetailGridDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaDetailGridDirective, "[danaDetailGrid]", never, {}, {}, never, never, true, never>;
}

declare class DanaDetailItemComponent {
    label: string;
    value: string;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaDetailItemComponent, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<DanaDetailItemComponent, "dana-detail-item", never, { "label": { "alias": "label"; "required": false; }; "value": { "alias": "value"; "required": false; }; }, {}, never, ["*"], true, never>;
}

declare class DanaTabsDirective {
    private readonly host;
    constructor(host: ElementRef<HTMLElement>);
    onKeydown(event: KeyboardEvent): void;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaTabsDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaTabsDirective, "[danaTabs]", never, {}, {}, never, never, true, never>;
}

declare class DanaTabDirective {
    active: boolean;
    get isActive(): boolean;
    get ariaSelected(): string;
    get tabIndex(): 0 | -1;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaTabDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaTabDirective, "button[danaTab], a[danaTab]", never, { "active": { "alias": "active"; "required": false; }; }, {}, never, never, true, never>;
}

type DanaToastTone = 'success' | 'warning' | 'error' | 'info';
interface DanaToastNotice {
    id: number;
    tone: DanaToastTone;
    title: string;
    message: string;
    durationMs: number;
}
declare class DanaToastService {
    private nextId;
    private readonly noticesSubject;
    readonly notices$: rxjs.Observable<DanaToastNotice[]>;
    success(message: string, title?: string, durationMs?: number): void;
    warning(message: string, title?: string, durationMs?: number): void;
    error(message: string, title?: string, durationMs?: number): void;
    info(message: string, title?: string, durationMs?: number): void;
    dismiss(id: number): void;
    private show;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaToastService, never>;
    static ɵprov: i0.ɵɵInjectableDeclaration<DanaToastService>;
}

declare class DanaToastHostComponent {
    readonly toast: DanaToastService;
    constructor(toast: DanaToastService);
    trackById(_i: number, n: DanaToastNotice): number;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaToastHostComponent, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<DanaToastHostComponent, "dana-toast-host, gear-toast-host", never, {}, {}, never, never, true, never>;
}

declare class DanaConfirmDialogComponent implements OnChanges, AfterViewInit, OnDestroy {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    danger: boolean;
    readonly confirm: EventEmitter<void>;
    readonly cancel: EventEmitter<void>;
    private dialogRef?;
    private cancelButton?;
    readonly messageId: string;
    private previouslyFocused?;
    private destroyed;
    ngOnChanges(): void;
    ngAfterViewInit(): void;
    ngOnDestroy(): void;
    onCancel(event: Event): void;
    onClose(): void;
    onBackdropClick(event: MouseEvent): void;
    private syncOpen;
    private close;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaConfirmDialogComponent, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<DanaConfirmDialogComponent, "dana-confirm-dialog", never, { "open": { "alias": "open"; "required": false; }; "title": { "alias": "title"; "required": false; }; "message": { "alias": "message"; "required": false; }; "confirmLabel": { "alias": "confirmLabel"; "required": false; }; "cancelLabel": { "alias": "cancelLabel"; "required": false; }; "danger": { "alias": "danger"; "required": false; }; }, { "confirm": "confirm"; "cancel": "cancel"; }, never, ["*"], true, never>;
}

declare class DanaMobileNavDirective {
    /** Match the consuming app's CSS desktop breakpoint. */
    desktopMinWidth: number;
    open: boolean;
    private isDesktop;
    toggle(): void;
    close(): void;
    onEscape(): void;
    onResize(): void;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaMobileNavDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaMobileNavDirective, "[danaMobileNav]", ["danaMobileNav"], { "desktopMinWidth": { "alias": "desktopMinWidth"; "required": false; }; }, {}, never, never, true, never>;
}

declare class DanaResponsiveGridDirective {
    readonly hostClass = true;
    danaColumns: number | string;
    danaCompactColumns: number | string;
    danaMobileColumns: number | string;
    danaGridGap: string;
    get columns(): string;
    get compactColumns(): string;
    get mobileColumns(): string;
    get gap(): string;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaResponsiveGridDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaResponsiveGridDirective, "[danaResponsiveGrid]", never, { "danaColumns": { "alias": "danaColumns"; "required": false; }; "danaCompactColumns": { "alias": "danaCompactColumns"; "required": false; }; "danaMobileColumns": { "alias": "danaMobileColumns"; "required": false; }; "danaGridGap": { "alias": "danaGridGap"; "required": false; }; }, {}, never, never, true, never>;
}

declare class DanaStackDirective {
    readonly hostClass = true;
    danaStackGap: string;
    danaStackAlign: string;
    danaStackJustify: string;
    danaStackMobile: boolean;
    get mobile(): boolean;
    get gap(): string;
    get align(): string;
    get justify(): string;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaStackDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<DanaStackDirective, "[danaStack]", never, { "danaStackGap": { "alias": "danaStackGap"; "required": false; }; "danaStackAlign": { "alias": "danaStackAlign"; "required": false; }; "danaStackJustify": { "alias": "danaStackJustify"; "required": false; }; "danaStackMobile": { "alias": "danaStackMobile"; "required": false; }; }, {}, never, never, true, never>;
}

/** One column in the dropdown list. `value` returns the text shown in that cell. */
interface DanaComboboxColumn<T = any> {
    label: string;
    value: (row: T) => string | number | null | undefined;
    /** CSS grid track, for example '1.4fr' or '120px'. Defaults to '1fr'. */
    width?: string;
    /** Right-align numbers and times. */
    align?: 'start' | 'end';
}
/**
 * Searchable dropdown that lists rows under column headers.
 *
 * - Pick mode (default): the bound value is the chosen row's key; typing only filters.
 * - Free-text mode (`freeText`): the bound value is the typed text; rows are suggestions,
 *   and choosing one fills in the text from `textOf` and emits `picked`.
 *
 * Keyboard: Down/Up move, Enter picks, Escape closes, Home/End jump. Works with ngModel
 * and reactive forms.
 */
declare class DanaComboboxComponent<T = any> implements ControlValueAccessor, OnChanges, OnDestroy {
    private readonly host;
    private readonly cdr;
    options: readonly T[];
    columns: DanaComboboxColumn<T>[];
    /** Stable key for a row (pick mode binds to this). */
    keyOf: (row: T) => string;
    /** Text put in the box when a row is chosen. Defaults to the first column. */
    textOf?: (row: T) => string;
    freeText: boolean;
    placeholder: string;
    ariaLabel: string;
    emptyText: string;
    loading: boolean;
    loadingText: string;
    /** Rows visible before the list scrolls. */
    maxRows: number;
    private disabledValue;
    get disabled(): boolean;
    set disabled(value: boolean);
    /** Upper-case typed text (load numbers, trailer IDs). */
    uppercase: boolean;
    readonly picked: EventEmitter<T | null>;
    readonly textChange: EventEmitter<string>;
    private inputRef;
    readonly inputId: string;
    readonly listId: string;
    open: boolean;
    query: string;
    inputText: string;
    selectedKey: string;
    activeIndex: number;
    filtered: T[];
    /** Fixed-position placement so a panel or table that clips overflow cannot cut the list off. */
    placement: {
        top: number | null;
        bottom: number | null;
        left: number;
        width: number;
        listMax: number;
        above: boolean;
    };
    private onChange;
    private onTouched;
    private scrollCleanup?;
    private destroyed;
    constructor(host: ElementRef<HTMLElement>, cdr: ChangeDetectorRef);
    get gridTemplate(): string;
    ngOnChanges(): void;
    writeValue(value: unknown): void;
    registerOnChange(fn: (value: string) => void): void;
    registerOnTouched(fn: () => void): void;
    setDisabledState(disabled: boolean): void;
    cell(column: DanaComboboxColumn<T>, row: T): string;
    describe(row: T): string;
    optionId(index: number): string;
    onFocus(): void;
    onInput(raw: string): void;
    onKeydown(event: KeyboardEvent): void;
    onBlur(): void;
    openList(showAll?: boolean): void;
    close(): void;
    clear(): void;
    pick(row: T): void;
    onViewportChange(): void;
    /** Below the input when there is room, otherwise above; never wider than the viewport. */
    private place;
    onDocumentMouseDown(event: MouseEvent): void;
    ngOnDestroy(): void;
    private move;
    private scrollActive;
    private refilter;
    private textFor;
    private labelFor;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaComboboxComponent<any>, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<DanaComboboxComponent<any>, "dana-combobox", never, { "options": { "alias": "options"; "required": false; }; "columns": { "alias": "columns"; "required": false; }; "keyOf": { "alias": "keyOf"; "required": false; }; "textOf": { "alias": "textOf"; "required": false; }; "freeText": { "alias": "freeText"; "required": false; }; "placeholder": { "alias": "placeholder"; "required": false; }; "ariaLabel": { "alias": "ariaLabel"; "required": false; }; "emptyText": { "alias": "emptyText"; "required": false; }; "loading": { "alias": "loading"; "required": false; }; "loadingText": { "alias": "loadingText"; "required": false; }; "maxRows": { "alias": "maxRows"; "required": false; }; "disabled": { "alias": "disabled"; "required": false; }; "uppercase": { "alias": "uppercase"; "required": false; }; }, { "picked": "picked"; "textChange": "textChange"; }, never, never, true, never>;
}

declare const DANA_UI_GEAR_COMPAT_FEATURES_STYLESHEET = "@dana/ui/styles/gear-compat-features.css";
declare const DANA_UI_GEAR_COMPAT_OVERRIDES_STYLESHEET = "@dana/ui/styles/gear-compat-overrides.css";
declare const DANA_UI_CORE_STYLESHEET = "@dana/ui/styles/dana-core.css";
declare const DANA_UI_GEAR_COMPAT_STYLESHEET = "@dana/ui/styles/gear-compat.css";
declare const DANA_UI_GLOBAL_STYLESHEET = "@dana/ui/styles/dana-ui.css";
declare const DANA_APPS_GLOBAL_STYLESHEET = "@dana/ui/styles/dana-ui.css";
declare const GEAR_APPS_GLOBAL_STYLESHEET = "@dana/ui/styles/dana-ui.css";

export { DANA_APPS_GLOBAL_STYLESHEET, DANA_UI_CORE_STYLESHEET, DANA_UI_GEAR_COMPAT_FEATURES_STYLESHEET, DANA_UI_GEAR_COMPAT_OVERRIDES_STYLESHEET, DANA_UI_GEAR_COMPAT_STYLESHEET, DANA_UI_GLOBAL_STYLESHEET, DanaAlertDirective, DanaButtonDirective, DanaComboboxComponent, DanaConfirmDialogComponent, DanaCountBadgeDirective, DanaDashboardGridComponent, DanaDashboardPanelComponent, DanaDetailGridDirective, DanaDetailItemComponent, DanaEmptyStateDirective, DanaIconButtonDirective, DanaKpiCardDirective, DanaKpiGridDirective, DanaLoadingStateDirective, DanaMobileNavDirective, DanaOperationCardComponent, DanaOperationGridDirective, DanaPageHeaderComponent, DanaPanelActionDirective, DanaPanelHeaderDirective, DanaResponsiveGridDirective, DanaStackDirective, DanaStatusBadgeDirective, DanaSummaryCardDirective, DanaSummaryGridDirective, DanaTabDirective, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective, DanaTabsDirective, DanaToastHostComponent, DanaToastService, DanaToolbarDirective, GEAR_APPS_GLOBAL_STYLESHEET };
export type { DanaAlertTone, DanaButtonVariant, DanaComboboxColumn, DanaToastNotice, DanaToastTone };
