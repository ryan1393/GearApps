# Shared Dana UI

This is the single `@dana/ui` source library used by Lapper, Blade Tracking, Cutter Builder, and Green Shed. It uses the repository's Angular 20, TypeScript, Nx, and ng-packagr installation. It has no separate dependency installation or lockfile.

Run these commands from the repository root:

```sh
npx nx build dana-ui
npx nx test dana-ui
npx playwright install chromium
npx nx run dana-ui:test-browser
npx nx run dana-ui:pack
```

The root TypeScript alias resolves `@dana/ui` to `src/index.ts` in this project, so applications and tests compile the same source with the same Angular version. Nx builds the library before its consumers. The build produces the publishable package in `dist/libs/shared/dana-ui` (used by `pack` and the consumer/browser checks). This source is the only copy: applications import `@dana/ui` through the path alias and load the stylesheets from `src/styles`, so nothing is vendored or installed.

The canonical stylesheet is `libs/shared/dana-ui/src/styles/dana-ui.css`. The original manufacturing compatibility layers remain alongside it as `gear-compat.css`, `gear-compat-features.css`, and `gear-compat-overrides.css`; only the manufacturing applications load those layers. All four applications use this same UI version.

Standard tests verify source boundaries, canonical visual contracts, and strict AOT consumer templates against the root Angular compiler. The browser target verifies real Angular controls, table sorting/filtering/cleanup, Escape and focus behavior, native modal behavior, navigation breakpoints, and mobile layouts using Chromium.

`DanaMobileNavDirective` defaults to a desktop minimum width of 1025 pixels. Manufacturing navigation binds `[desktopMinWidth]="1024"` to match its maintained CSS breakpoint. Invalid widths use the default.

Overlay drawers with a separate opener can opt into `[modal]="true"`. On mobile, opening moves focus into the drawer, Tab stays within its visible controls, and closing or Escape restores the opener. Desktop navigation keeps its usual keyboard behavior. Give the host an accessible name and include a visible close button inside the drawer.
