import * as i0 from "@angular/core";
export declare class DanaResponsiveGridDirective {
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
