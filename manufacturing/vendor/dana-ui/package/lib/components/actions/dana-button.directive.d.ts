import * as i0 from "@angular/core";
export type DanaButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'dark';
export declare class DanaButtonDirective {
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
