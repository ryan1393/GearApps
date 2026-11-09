import * as i0 from "@angular/core";
export type DanaOperationTone = 'blue' | 'green' | 'purple' | 'orange' | 'teal' | 'gray';
export declare class DanaOperationCardComponent {
    icon: string;
    tone: DanaOperationTone;
    heading: string;
    description: string;
    get resolvedIcon(): string;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaOperationCardComponent, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<DanaOperationCardComponent, "a[danaOperationCard]", never, { "icon": { "alias": "icon"; "required": false; }; "tone": { "alias": "tone"; "required": false; }; "heading": { "alias": "heading"; "required": false; }; "description": { "alias": "description"; "required": false; }; }, {}, never, never, true, never>;
}
