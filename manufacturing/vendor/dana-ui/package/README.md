# Dana UI

Standalone shared UI package for Dana applications.

Package: `@dana/ui`
Version: see `package.json`

Gear Apps and Truck Log remain separate products and deployments.

## First setup

Use Node 20.19+, Node 22.12+, or Node 24+. Run `SETUP-DANA-UI.cmd` on Windows. It installs the locked dependencies and Chromium, then builds and checks the package.

On Linux/macOS:

```sh
npm ci
npx playwright install chromium
npm run check
```

The library supports Angular 19.2 and 20. Its build uses Angular 20.3.34, TypeScript 5.9, and partial compilation. Strict AOT consuming-template checks and browser interactions have been verified with Angular 19.2.25 and 20.3.34.

## Build
Run `BUILD-DANA-UI.cmd`.

## Create local package
Run `PACKAGE-DANA-UI.cmd`.

The installable `.tgz` is written under `artifacts\`.

Canonical stylesheet:
`@dana/ui/styles/dana-ui.css`

## Fixes in 0.3.1

- Canonical styles cover table sorting/filtering, dashboard panels, KPI grids, operation cards, and packaged icons. No Gear compatibility import or icon-copy rule is needed.
- Disabling an open combobox closes its list and prevents selection changes. Dropdowns follow scrolling overflow panels.
- Tables remove every generated popup and listener on destruction, including deferred initialization. Escape closes filters and returns focus to the trigger.
- Confirmation dialogs use native modality: background controls are inert, focus starts on Cancel, and closing returns focus to the launcher. Existing `open`, `confirm`, and `cancel` bindings are preserved.
- Legacy component class aliases remain for migration. The canonical stylesheet contains only Dana-neutral selectors and tokens.

## Components
Apps build screens from these; they add only layout (grids, ordering, spacing) of their own.

- **Searchable dropdown with column headers:** `<dana-combobox>` (`DanaComboboxComponent`). Set `options`, `columns` (`label`, `value(row)`, optional `width`, `align`), `keyOf` and `textOf`. Use `freeText` to allow typed values; `picked` fires on a selection. Works with `ngModel`/reactive forms and the keyboard, and the list stays visible inside panels.
- **Form fields:** `.dana-field` with `.dana-field-head` and `.dana-field-tag` (`.is-required`, or `data-tone="info"` for "From RXO"-style notes); `.dana-field-hint`, `.dana-field-error`, `.dana-field-static`.
- **Segmented buttons:** `.dana-segmented` with `aria-pressed` on each button.
- **Numbered form sections:** `.dana-form-section` and `.dana-step-number`.
- **File drop box and list:** `.dana-dropzone` (a label around a file input) and `.dana-file-list`.
- **Work queue rows:** `.dana-action-list` / `.dana-action-row` with `.dana-action-main` and `.dana-action-meta`.
- **Cards:** `.dana-card` with `data-tone="warning|danger|success"` for aging and overdue items, plus `-header`, `-eyebrow`, `-title`, `-subtitle` and `-section`.
- **Small indicators:** `.dana-progress`, `.dana-chip-list` / `.dana-chip`, `.dana-pill-button[data-tone]`.
- **Tones:** `data-tone="success|warning|danger|info|neutral"` on status badges, count badges, KPI cards, table rows and cards.
- **Tables:** `.dana-table-actions`, `.dana-cell-sub`, and `.dana-table-shell.is-sticky-head` so headers stay in view on long tables.
- **Dialogs and toasts:** `.dana-dialog` with header, body and actions; `.dana-toast` with an icon.
- **Shell:** slide-in sidebar below 1024px (`.dana-menu-button`, `.dana-sidebar.is-open`, `.dana-sidebar-backdrop`), `.dana-sidebar-identity`, `.dana-sidebar-version`, and `.dana-app-shell.is-fullscreen` for kiosk and TV pages.
- **Sign-in page:** `.login-page` with the brand panel and `.login-card` (shared by Truck Log and Gear Apps).
- **Wall display for TVs:** `.dana-wall` with `-header`, `-title`, `-controls`, `-clock`, `-status[data-tone]`, `-kpis`/`-kpi`, `-panel`/`-panel-title`, `-grid` (set `--dana-wall-columns`), `-card[data-tone]` (also `.is-compact`, `.is-summary`), `-badge`, `-headline`, `-subline`, `-detail`, `-facts`/`-fact`, `-age`/`-age-part` for elapsed times, `-table` (rows take `data-tone`, cells take `data-label` for phones), `-empty`, `-loading` and `-footer`. Text scales with the screen so it reads across a room.


## Behavioral checks

`npm run check` runs the source contracts, Angular package build, strict AOT consumer-template compilation, and Chromium regressions. `npm run test:browser` exercises the built package against only the canonical stylesheet. `CHROMIUM_EXECUTABLE` can select an existing Chromium binary.

To repeat the compatibility checks with another Angular installation, set `DANA_TEST_ANGULAR_ROOT` to a directory containing its `node_modules`, then run `npm run test:consumer` and `npm run test:browser`. That installation needs matching Angular core, common, forms, platform-browser, compiler, and compiler-cli packages, plus a compatible TypeScript version. The package under test still comes from this project's `dist/`.

### Navigation breakpoint

`DanaMobileNavDirective` defaults to a desktop minimum width of 1025 pixels. Apps whose CSS switches to desktop navigation at 1024 pixels should bind `[desktopMinWidth]="1024"` on the element with `danaMobileNav`. Keep the input aligned with the app's stylesheet breakpoint; invalid widths use the default.
