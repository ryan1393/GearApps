# MeshForge UI Design System

> **Superseded in 70.2.0.** MeshForge styling now lives in @dana/ui (Dana UI). The paths below
> (`libs/shared/ui-tailwind`, `libs/gear/ui`) no longer exist; see the "Styling (Dana UI)" section
> of the README. This file is kept for history.


## Public style entry point

All Angular frontends load exactly one MeshForge stylesheet from their Nx build configuration:

```text
libs/shared/ui-tailwind/src/styles/gear-apps.css
```

That file is intentionally an **import-only entry point**. It owns module order but does not own declarations. Blade Tracking, Cutter Builder, Greenshed, Admin, and feature components must not import private modules directly.

## Current canonical module layout

The public entry point currently loads 22 ordered modules. The shared component area includes the canonical workflow layout and semantic icon system:

```text
libs/shared/ui-tailwind/src/styles/
├── gear-apps.css
└── gear-apps/
    ├── foundation/
    │   ├── tokens.css
    │   ├── base.css
    │   └── responsive.css
    ├── layout/
    │   ├── app-shell.css
    │   ├── navigation-shell.css
    │   └── brand.css
    ├── components/
    │   ├── primitives.css
    │   ├── workflow-layout.css
    │   ├── data-display.css
    │   ├── icons.css
    │   ├── login.css
    │   ├── access-states.css
    │   └── toast.css
    └── features/
        ├── admin-core.css
        ├── blade-dashboard.css
        ├── cutter-builder.css
        ├── dashboard.css
        ├── greenshed-running-machines.css
        ├── inventory-core.css
        ├── inventory-relations.css
        ├── scrap-blades.css
        └── typography.css
```

`features/design-tokens.css` and `features/ui-cleanup.css` remain only as declaration-free retirement notes. They are not loaded by `gear-apps.css` and must not regain active ownership.

## Ownership rules

Use the smallest shared layer that accurately owns a rule:

- **foundation/tokens.css** — one canonical `:root` token set.
- **foundation/base.css** — global box sizing, document typography, and native baseline.
- **foundation/responsive.css** — cross-feature responsive policy only.
- **layout/app-shell.css** — application content shell and login-shell behavior.
- **layout/navigation-shell.css** — sidebar, topbar, navigation, page geometry, print shell.
- **components/primitives.css** — page headings, panels, fields, buttons, alerts, details.
- **components/workflow-layout.css** — reusable workflow sections, scan rows, forms, results, and detail composition.
- **components/data-display.css** — shared tables, sort/filter controls, badges/status pills, and domain links.
- **components/icons.css** — semantic shared SVG glyph mappings.
- **components/login.css / access-states.css** — specialized reusable component states.
- **features/** — workflow-specific presentation only.

Feature CSS must not redefine generic buttons, panels, page shells, shared tables, badges, or tokens. If a pattern is useful in more than one workflow, move it to the appropriate shared component/layout/foundation owner.

## Refactor history

### Pass 1 — visual-neutral modularization

The former monolithic stylesheet was split at stable cascade boundaries behind the same public entry point. The original 18-module concatenation reproduced the pre-refactor CSS byte-for-byte. This made the historical layering visible without changing the intended look.

That first audit reported:

```text
506 qualified CSS rules
419 unique selector strings
77 selector strings appearing more than once
```

The raw `77` count included both true same-cascade duplication and legitimate reuse of a selector in media/print contexts.

### Pass 2 — canonical standardization

The second pass removed the late override architecture and assigned each shared concern one canonical owner. It also made the CSS audit context-aware. Current reviewed result:

```text
502 qualified CSS rules
465 unique selector strings
0 same-cascade duplicate selectors
32 selector strings reused only across responsive/print contexts
17 ordered modules
```

Normal responsive rules such as a desktop `.gear-page` definition plus mobile `.gear-page` overrides are **not** design debt. The regression rule is now stricter where it matters: two definitions of the same selector in the same cascade context are not allowed.

Run:

```text
npm run audit:ui-styles
npm run test:ui-style-duplicates
```

## Standard reusable vocabulary

Prefer the existing MeshForge classes before inventing a page-specific equivalent. Current shared vocabulary includes:

```text
.gear-page
.gear-page-header
.gear-eyebrow
.gear-page-title
.gear-page-description
.gear-panel
.gear-field
.gear-input / .gear-select / .gear-textarea
.gear-actions
.gear-btn and variants
.gear-alert and variants
.gear-detail-grid / .gear-detail
.gear-table
.gear-badge / .status-pill
.build-link
```

Dashboard, inventory/location-browser, Admin/location-management, Green Shed running-machine, Blade dashboard, and scrap-history classes remain feature-owned when they describe a real workflow-specific layout rather than a generic primitive.

## Regression contracts

Primary contracts:

```text
npm run test:shared-ui-style-source
npm run test:ui-style-duplicates
npm run test:ui-consistency
npm run test:ui-deep-scan
npm run test:login-ui-consistency
```

The modular style contract verifies:

- `gear-apps.css` remains import-only;
- all 17 canonical modules exist in reviewed order;
- retired override-only modules do not return;
- applications load only the public entry point;
- no nested private module import graph is introduced;
- no module exceeds the maintainability ceiling;
- application/component-owned shell styling is not reintroduced;
- required shared UI markers remain available.

The duplicate contract verifies **zero same-cascade duplicate selectors** and separately budgets normal responsive/print selector reuse.

## Adding or changing styles

1. Reuse an existing shared class first.
2. Put tokens/reset/layout/component rules in their canonical shared owner.
3. Put only workflow-specific presentation in `features/`.
4. Do not create an override-only module just to restyle another shared module later in the import order.
5. Do not add large `<style>` blocks to Angular templates.
6. Do not add MeshForge shell/component rules to `apps/*/src/styles.css` or `app.component.css`.
7. Do not import a private module directly from an app.
8. Run the shared-style, duplicate, deep-UI, and no-raw-debug contracts before delivery.
9. For deliberate visual changes, review Blade Tracking, Cutter Builder, Greenshed, and Admin rather than only the page being edited.

## Long-term standard

The objective is one stable visual vocabulary, not simply smaller CSS files. Shared controls and data presentation should have one definition; feature styles should describe only the workflow-specific composition around those primitives.

## Body depth / visual polish standard

The post-standardization visual pass keeps the established dark navigation shell and gives the application body more hierarchy and depth. The goal is not a colorful redesign; it is to keep the enterprise shell while removing the flat-white/document feel from operational pages.

Current body direction:

```text
subtle cool page canvas
+ restrained blue/teal accents
+ light raised surfaces
+ clear page/section hierarchy
+ stronger tables and workflow steps
```

Use the shared primitives rather than reproducing this appearance page-by-page:

- `gear-page-header` for normal operational/Admin page heroes;
- `gear-panel` for primary grouped content;
- `gear-workflow-card` and `gear-workflow-step-number` for scan/step workflows;
- shared table/status classes for dense operational data;
- feature-specific surfaces only where the workflow genuinely needs a distinct composition.

Nineteen of the twenty operational page templates use `gear-page-header`. Greenshed Running Machines intentionally retains its specialized `running-machines-header` because it is a shop-floor monitoring surface rather than a conventional form/list page. It still follows the same body-depth palette.

Do not change `layout/navigation-shell.css` merely to make body content richer. The sidebar/topbar are a separate stable shell concern.

Current audited CSS state after the body-depth pass:

```text
510 qualified CSS rules
472 unique selector strings
0 same-cascade duplicate selectors
33 reviewed responsive/print selector reuses
17 ordered modules
```

Regression command:

```text
npm run test:ui-body-depth
```

The contract also prevents stale location helper wording from reappearing where the current workflow requires `CGFR-<summary>` / `CGFP-<summary>`.

## UX hardening standard

The shared shell now has a responsive interaction contract in addition to its visual contract.

- Desktop keeps the established fixed sidebar/topbar treatment.
- Below 1024 px, the topbar remains available and the sidebar becomes an off-canvas drawer with hamburger, overlay/click-away, and Escape close behavior.
- App content always reserves the topbar height outside the login route.
- Shared scan controls use associated labels and safe initial autofocus.
- Keyboard focus must remain visible with the shared `:focus-visible` treatment.
- Error feedback should use alert semantics; successful/status feedback should use a polite live status when it matters to the transaction.
- Primary commit controls should lock while a request is in flight and communicate progress when practical.
- Upstream scans must clear or revalidate dependent workflow selections so stale state cannot be committed accidentally.

Current audited CSS state after UX hardening:

```text
521 qualified CSS rules
476 unique selector strings
0 same-cascade duplicate selectors
39 reviewed responsive/print selector reuses
17 ordered modules
```

UX regression commands:

```text
npm run test:ux-responsive-nav
npm run test:ux-workflow-state
npm run test:ux-accessibility-feedback
```

## Physical location identity standard

Operator-facing placement uses the scannable location tag as the primary identity:

```text
Location / Current Location / From / To / Shelf -> location.serial_number
```

Do not substitute `location.number` for the physical placement. For Summary-derived shelves, `location.number` is the normalized Summary/reference key and can therefore look like `1.955FC` while the actual shelf tag is `CGDR-1.955FC`, `CGFP-...`, `GSR-...`, etc.

`location.number` may still appear where the UI explicitly labels it as **Location Number** in location master/reference views, and it remains valid for workflow Summary validation. When a workflow displays a physical shelf, show `serial_number` first and description second when available.

Regression command:

```text
npm run test:location-identity-display
```


## Parent → child drilldown styling standard

Parent/child inventory relationships use a shared visual vocabulary from:

```text
libs/shared/ui-tailwind/src/styles/gear-apps/features/inventory-relations.css
```

Canonical classes include:

```text
.inventory-child-section
.inventory-child-section-header
.inventory-child-stack / .inventory-child-grid
.inventory-child-card / .inventory-child-card-header
.inventory-child-stats
.inventory-child-table
.inventory-child-list / .inventory-child-row
.inventory-child-empty
.inventory-child-summary
.inventory-detail-button
```

Use these generic classes for Tray → Blade, Container → Tray → Blade, and Location → Tray → Blade surfaces outside a feature-specific browser. Do not reuse `blade-location-*` classes on Inventory Control Center or Find Inventory simply because the layouts look similar; those names belong to the Blade Locations feature. Do not recreate child cards with long page-local Tailwind utility strings when the shared parent/child vocabulary already covers the pattern.

Tray Contents may continue one level deeper from Blade → Blade History and should reuse the established `scrap-history-*` timeline classes rather than creating another history presentation.

Regression command:

```text
npm run test:parent-child-drilldown
```

The contract verifies both the relationship behavior and the shared style vocabulary.

## Shop-floor readability and child containment standard

MeshForge body content now uses a shared readability scale from `foundation/tokens.css`:

```text
--gear-font-xs: 11px
--gear-font-sm: 12px
--gear-font-md: 14px
--gear-font-lg: 16px
```

This scale applies to operational body content, tables, buttons, forms, dashboards, Admin, inventory relationships, blade history, Cutter Builder, and Greenshed monitoring surfaces. The stable desktop sidebar/topbar remains a separate shell concern and should not be enlarged merely because body content is being made easier to read.

Parent/child inventory rows must stay inside their parent card. Long blade serials and other identifiers must wrap safely instead of forcing the row wider than the card. Canonical rules include:

- child cards/lists/rows use `min-width: 0` and `max-width: 100%`;
- child cards and rows contain overflow;
- child row grid tracks use `minmax(0, ...)`, never fixed minimum column widths that can exceed the card;
- child row values use `overflow-wrap: anywhere` / safe word breaking for long serials;
- child list body text should not regress to 8px/9px sizes;
- shared table cells may wrap long values rather than forcing an operator page wider than its panel.

Regression command:

```text
npm run test:shop-floor-readability
```

## V69 shared UI completion sequence

V69.0 completed and passed live on Windows. It established canonical token, table/filter, and semantic-icon ownership. V69.2 completes the next two phases as one combined package because the user requested no intermediate V69.1 command.

### Inventory and table phase
- Inventory Control Center searches the full database through paginated server queries for Trays, Containers, Locations, and Blades.
- All 23 frontend tables use `danaTable`.
- Parent/detail rows use shared group attributes so sorting/filtering preserves relationship context.
- Static action/detail columns opt out of generated controls.

### Workflow consolidation phase
- Cutter Builder Build, Teardown, and Lookup use the shared workflow layout.
- Greenshed Setup, Pull, Check, and Lookup use the same shared vocabulary.
- Generic geometry belongs in `components/workflow-layout.css`; feature modules retain only domain-specific presentation.

### Required regression commands
```text
node tools/manufacturing/test-inventory-control-center-search-contract.mjs
node tools/manufacturing/test-shared-table-migration-contract.mjs
node tools/manufacturing/test-workflow-surface-consolidation-contract.mjs
npm run audit:ui-styles
npm run test:gear-apps
```

V69.2 must not be called a live baseline until the final Windows authoritative regression passes.
