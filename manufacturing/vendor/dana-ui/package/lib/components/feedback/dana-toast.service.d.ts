import * as i0 from "@angular/core";
export type DanaToastTone = 'success' | 'warning' | 'error' | 'info';
export interface DanaToastNotice {
    id: number;
    tone: DanaToastTone;
    title: string;
    message: string;
    durationMs: number;
}
export declare class DanaToastService {
    private nextId;
    private readonly noticesSubject;
    readonly notices$: import("rxjs").Observable<DanaToastNotice[]>;
    success(message: string, title?: string, durationMs?: number): void;
    warning(message: string, title?: string, durationMs?: number): void;
    error(message: string, title?: string, durationMs?: number): void;
    info(message: string, title?: string, durationMs?: number): void;
    dismiss(id: number): void;
    private show;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaToastService, never>;
    static ɵprov: i0.ɵɵInjectableDeclaration<DanaToastService>;
}
