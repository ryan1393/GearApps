import { ChangeDetectorRef, ElementRef, EventEmitter, OnChanges, OnDestroy } from '@angular/core';
import { ControlValueAccessor } from '@angular/forms';
import * as i0 from "@angular/core";
/** One column in the dropdown list. `value` returns the text shown in that cell. */
export interface DanaComboboxColumn<T = any> {
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
export declare class DanaComboboxComponent<T = any> implements ControlValueAccessor, OnChanges, OnDestroy {
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
    readonly picked: EventEmitter<T>;
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
