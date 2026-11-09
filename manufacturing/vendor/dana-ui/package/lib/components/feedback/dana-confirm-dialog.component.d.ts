import { AfterViewInit, EventEmitter, OnChanges, OnDestroy } from '@angular/core';
import * as i0 from "@angular/core";
export declare class DanaConfirmDialogComponent implements OnChanges, AfterViewInit, OnDestroy {
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
