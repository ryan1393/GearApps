import { DanaToastNotice, DanaToastService } from './dana-toast.service';
import * as i0 from "@angular/core";
export declare class DanaToastHostComponent {
    readonly toast: DanaToastService;
    constructor(toast: DanaToastService);
    trackById(_i: number, n: DanaToastNotice): number;
    static ɵfac: i0.ɵɵFactoryDeclaration<DanaToastHostComponent, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<DanaToastHostComponent, "dana-toast-host, gear-toast-host", never, {}, {}, never, never, true, never>;
}
