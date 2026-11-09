import * as i0 from "@angular/core";
export type DanaAlertTone = 'info' | 'success' | 'warning' | 'danger';
export declare class DanaAlertDirective {
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
