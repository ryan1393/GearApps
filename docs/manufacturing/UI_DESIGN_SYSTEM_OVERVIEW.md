> **Superseded in 70.2.0.** Gear Apps styling now lives in @dana/ui (Dana UI). The paths below
> (`libs/shared/ui-tailwind`, `libs/gear/ui`) no longer exist; see the "Styling (Dana UI)" section
> of the README. This file is kept for history.


## Parent → Child drill-down pattern

Gear Apps detail and inventory surfaces should let operators inspect real child records when a parent naturally owns/contains them and that detail helps answer what is physically inside/on the parent.

Canonical relationships:

```text
Tray → Blades
Container → Trays → Blades
Location → Trays → Blades
Cutter Build → Blade records
```

Use the existing shared detail buttons/chips/tables and reveal children inline beneath the selected parent. Keep the parent visible while expanded so context is never lost. Child rows should use readable manufacturing identifiers (serial, Summary, Part Type, status, service cycle, position) rather than UUIDs. Raw JSON is never an acceptable drill-down UI.

Transaction screens can remain scan-first and concise when child inspection does not help verify the transaction. Where inspection does help (coater load/receive, cutter build/teardown), expose it without making it mandatory to complete the workflow.

Tray Contents is the richer blade-detail surface and may continue one level deeper from Blade → Blade History.

## Large shop-floor displays

The normal body readability scale remains 11/12/14/16px. At 1500px and wider, `foundation/responsive.css` raises body content to 13/15/17/20px and expands table row padding, controls, KPI values, headings, drilldown spacing, and the page width ceiling to 1840px.

The same breakpoint applies a modest proportional shell scale: the desktop sidebar becomes 296px, the topbar 76px, sidebar links 13px, and global search/user controls grow slightly. This is not a navigation redesign; grouping, colors, active states, responsive drawer behavior, and desktop information architecture remain unchanged.

When adding new body or shell components, use the shared typography/geometry tokens and responsive layer rather than hard-coded tiny sizing so new UI participates in the normal and large-display scales.


## Sidebar navigation hierarchy

The desktop/mobile shell uses one app identity in the brand area and one combined dashboard row beneath it. Do not render the app name as a separate primary row and then repeat a second generic Dashboard row.

Canonical labels:

```text
Blade Tracking brand -> Blade Dashboard
Cutter Builder brand -> Cutter Dashboard
Greenshed brand -> Greenshed Dashboard
```

After the combined dashboard row, navigation moves directly into the app-specific grouped sections such as OPERATIONS, INVENTORY, REFERENCE, SHARED APPS, and ADMINISTRATION. Do not reintroduce a redundant WORKSPACE heading solely to contain Dashboard.
## MeshForge brand mark

The shared application shell uses the MeshForge mark (ring gear, drive pinion and anvil) as the product brand mark in Blade Tracking, Cutter Builder, Greenshed, and Lapper. The mark is a local shared file at `assets/brand/meshforge-mark.svg`, copied into every frontend build, so the shop-floor UI has no external image/network dependency. Keep `MESHFORGE` and the current application name beside the mark; do not restore the old `GA` placeholder badge or create app-local logo copies. Branding remains owned by the shared navigation-shell styles.


## Global toast notifications

Use the shared Gear Apps toast system for short-lived transaction outcomes and failures. The host is mounted once in each application root and renders a fixed upper-right stack, so notifications never consume layout space or shift the current workflow.

Canonical tones:

```text
success -> green
warning -> amber
error   -> red
info    -> blue
```

Toasts auto-dismiss, can be manually dismissed, cap at four visible notices, and respect reduced-motion preference. Keep persistent/actionable workflow guidance inline when the operator still needs it to complete the current task; do not replace scan context, validation instructions, or result detail panels with transient notifications.

## MeshForge brand mark sizing

The MeshForge mark is the single shared local SVG brand asset at `assets/brand/meshforge-mark.svg`. Its shell footprint is intentionally modest but readable:

```text
normal/laptop: 40 x 48 px
1500px+:       46 x 56 px
```

Do not enlarge the rest of the brand row or alter the navigation hierarchy just to accommodate the mark.


## Shared workflow icon system

Gear Apps uses one semantic SVG icon set under `assets/icons/` for the application sidebars, global search, dashboard KPI cards, and dashboard operation cards. Do not use random Unicode symbols for those surfaces and do not fork icons into app-local asset folders.

Use the semantic `gear-glyph-*` classes from `libs/shared/ui-tailwind/src/styles/gear-apps/components/icons.css`. The icon name should describe the operator action or object, for example `move`, `container`, `receive`, `tray`, `intake`, `build-cutter`, `teardown`, `grinding`, `machine`, `quality-check`, `pull`, `shelf`, `location`, and `search`.

All three frontend `project.json` files publish the root `assets/` folder to `/assets`, which also makes the brand asset consistent across Blade Tracking, Cutter Builder, Greenshed, Admin, and the shared login experience.

### Replacing the MeshForge logo

Replace these files and keep the same filenames (see `libs/manufacturing/assets/brand/README.md` for the full set and the colour palette):

```text
assets/brand/meshforge-mark.svg
assets/brand/meshforge-mark-light.svg
```

Use a transparent, self-contained SVG with a tight viewBox and no external web/font dependencies. Rebuild/restart the apps after replacement.

## V69 shared UI completion

V69.0 completed and passed the shared foundation phase: global tokens are canonical in `foundation/tokens.css`, Dana table/filter ownership lives in `components/data-display.css`, inactive cleanup/token declaration sources are retired, and shared search/sort/close controls use semantic SVG icons.

V69.2 builds on that confirmed baseline:

- all 23 frontend tables use `danaTable`;
- relationship tables mark parents/details with `data-dana-table-group` and `data-dana-table-detail` so sorting/filtering moves the complete group together;
- non-sortable action/detail columns use `data-dana-table-static`;
- Inventory Control Center search is server-side and searches the full database, while table column controls remain current-page tools;
- Cutter Builder and Greenshed operational pages use the shared `gear-workflow-*` vocabulary rather than page-local box-heavy Tailwind composition.

Do not reintroduce page-local table behavior, raw Unicode controls, or bespoke workflow-card grids after this migration.

## Inventory Control Center search standard

Inventory Control Center maintains independent search state for Trays, Containers, Locations, and Blades. Search requests go through the paginated API and therefore search the complete database for the active inventory type, not only the rendered page. Switching tabs preserves each tab's applied query. Clear resets that tab to normal browsing.

Use table column filters for current-page inspection and the inventory browser toolbar for full-database lookup. Do not replace the server-side search with client-only array filtering.

## Relationship-safe shared table standard

Every frontend data table uses the shared Dana table system. Tables with expandable child/detail rows must assign the same `data-dana-table-group` value to the parent row and its detail row, with `data-dana-table-detail="true"` on the detail. The directive sorts and filters groups through their parent row and never separates an expanded detail from its owner.

Action, tag, history, contents, and similar operational columns should use `data-dana-table-static` when automatic sort/filter controls would be misleading.

## Shared workflow layout standard

Cutter Builder and Greenshed forms/results use `components/workflow-layout.css`. Canonical classes include `gear-workflow-page`, `gear-workflow-grid`, `gear-workflow-section`, `gear-workflow-section-header`, `gear-workflow-section-body`, `gear-workflow-form-grid`, `gear-workflow-scan-row`, `gear-workflow-detail-grid`, `gear-workflow-actions`, and `gear-workflow-result`.

Use these classes to create clear sections without nesting multiple decorative cards. Feature CSS may still describe real domain-specific state, but must not recreate generic panel/form/result geometry or add another late override layer.
