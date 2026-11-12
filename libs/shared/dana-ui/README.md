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

## Disabled actions

Disabled primary and secondary buttons (`:disabled` or `aria-disabled="true"`) use one neutral style in both themes: a grey surface (`--dana-disabled-bg`), a label that keeps at least 4.5:1 contrast (`--dana-disabled-text`) and a not-allowed cursor. They never fade the brand colour.

When a user may wonder why an action is unavailable, say so. `danaButton` accepts an optional reason that is shown next to the button, and linked to it with `aria-describedby`, only while the button is disabled:

```html
<button danaButton="primary" type="submit" [disabled]="!tray" danaDisabledReason="Scan a tray first.">Save</button>
```

Without the directive, use the same helper class and wire it yourself:

```html
<button class="gear-btn gear-btn-primary" type="submit" disabled aria-describedby="save-reason">Save</button>
<span id="save-reason" class="dana-disabled-reason">Scan a tray first.</span>
```

Keep the reason short and actionable. A disabled button is skipped by the Tab key, so put anything essential in visible text, not only in the description.

## Sortable tables

`danaTable` moves each sortable header's own text into a real `<button type="button" class="dana-table-sort-button">` and keeps `aria-sort` on the `<th>`; it does not rename the header or make the cell itself focusable. Controls the application puts in a header stay outside that button. Header controls are rebuilt only when the header row changes; body edits are coalesced for 50 ms before rows are re-sorted and re-filtered. Document and window listeners exist only while a filter popover is open.

## Toasts

`dana-toast-host` (also `gear-toast-host`) renders two sibling live regions, never nested and announcing additions only: a polite one for info, success and warning notices, and an assertive one for errors. `DanaToastService.error()` and `danger()` (and `notify('error' | 'danger', …)`) are the same tone; error notices stay until the user dismisses them. Other notices dismiss themselves after their duration, but the countdown pauses while the pointer or keyboard focus is on the notice. Timers are cleared when a notice is dismissed, pushed out of the four-notice stack, or the service is destroyed.

## Theme picker

Place `<dana-theme-toggle class="dana-theme-toggle-inline" />` in the application's top bar or user menu; the inline variant drops the card styling and hides its visible "Theme" word on narrow screens (the select keeps its "Color theme" name). Without the class it renders as a standalone card in the page flow; it is never fixed over content. The choice is stored under the `dana-theme` key in `localStorage` and applied as `data-dana-theme` on `<html>`. Each application's `index.html` applies the stored value before Angular starts, so a dark preference does not flash light first.
