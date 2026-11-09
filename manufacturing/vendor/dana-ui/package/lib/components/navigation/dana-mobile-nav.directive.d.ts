import * as i0 from "@angular/core";
export declare class DanaMobileNavDirective {
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
