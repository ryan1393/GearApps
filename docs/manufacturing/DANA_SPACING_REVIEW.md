# Dana spacing and presentation review

This pass reviews all 60 route/tab states used by the integrated UI audit across
Blade Tracking, Cutter Builder, Greenshed, Lapper and Plant Dashboard. It includes all
23 administration sections, nested tools/dialogs, shared login and recovery. The work
standardizes page rhythm and moves application presentation into the existing Dana UI
library while preserving actions, validation, authentication and inventory workflows.

## Shared spacing policy

The canonical tokens are in `libs/shared/dana-ui/src/styles/dana-core/tokens.css`;
`dana-core/spacing.css` applies them. The manufacturing compatibility styles consume
the same tokens. Desktop page padding retains the existing resolved Truck Log-derived
Dana value of **26px**.

| Measurement | Desktop/tablet above 767px | Phone at 767px or below |
| --- | --- | --- |
| Standard page gutters | 26px | 16px |
| Padded panel/body gutters | 20px | 16px |
| Panel-header horizontal gutters | 20px, matching its body | 16px, matching its body |
| Section gap | 24px | 16px |
| Form grid gap | 16px | 16px |
| Field gap | 8px | 8px |
| Action gap | 12px | 12px |

Panel headers use 16px vertical padding. `.dana-page-stack` and the shared workflow
page layout remove the header's extra bottom margin so their section gap is applied
once. First/last-child margin resets keep padded bodies aligned without an extra edge
gap. `.dana-panel-padded` covers a simple padded surface; `.dana-panel-body` covers the
body beneath a separate panel header. A surface uses one of those padding recipes.
Embedded Admin pages inherit the enclosing page width and gutters, with zero inner
page padding, preventing double gutters around nested tools.

The eight shared spacing steps are 4, 8, 12, 16, 20, 24, 32 and 40px. Components can
still arrange their domain content with grids, flex layout, wrapping and breakpoints.
The compact Operations Station and dense running-machine/board views retain their
own deliberate density through shared Dana recipes. Standard page gutters are not
imposed on the workstation profile. Running Machines keeps a native table on phones
inside a named, keyboard-focusable local scroll region, preserving aligned board
columns. Cycle history and Macros use local dense-table width recipes within their
table shells. Existing report, label and paper print layouts remain separate.

## Dana owns visual presentation

Application CSS/SCSS and inline component styles now contain layout only. At this
review, the ownership scan covers **52 application style sheets**, including inline
styles. Color, backgrounds, borders/radii, shadows, typography and focus appearance
belong to shared Dana styles. Neutral primitives live in `dana-core/content.css`;
manufacturing-specific presentation stays in Dana's compatibility styles. Legacy
`gear-*` classes remain valid Dana-owned compatibility APIs.

- Admin's nested role/badge, launch, bulk, coater, mapping, printer and settings panels
  use shared padding, headings, helpers, detail values and feedback. Its main component
  stylesheet remains comment-only, and login/recovery keep their centralized styling.
  Neutral Admin surfaces use theme tokens, including the dark-theme background.
- Blade Tracking uses shared panels, summaries, feedback, controls and workstation
  presentation. Find Inventory uses Dana's detail grid/items for placement and blade
  evidence. Intake fields respond to the available form-container width, stacking in
  narrow panels. Scan/picker/stepper layouts retain their workflow arrangements.
- Cutter Builder and Greenshed forms, requests, results, checks, lookups and running
  machines consume the same panel, field and action spacing.
- Lapper's machine cards, live media, summary details, compact tables, value changes
  and configuration dialogs use shared presentation variants with local layout.
- Plant Dashboard uses Dana navigation, page headers, KPI cards, machine cards,
  filters, alerts, tables and login controls. It retains its reporting layout and
  print behavior.

Private palette utilities such as raw red/blue/slate background or text classes are
replaced by semantic Dana classes and tones. Shared helpers cover warning/success
text, selected/changed surfaces, dividers, fieldsets, media, deltas and action links.
The theme selector sits in normal document flow at every width, aligned to the page
gutter, so it does not cover bottom-right content or actions.

## Visual findings beyond numeric checks

An earlier 184-case numeric sweep passed before manual screenshot review found two
remaining visual issues. The Blade Tracking Availability By Part Summary section now
has its visible Dana panel header and separate padded body. Plant KPI cards now use
the child structure expected by the shared KPI recipe, including the icon and
value/title/note grouping. The final sweep adds panel-header gutter assertions and
runs against fresh builds containing these and the qualitative corrections above.
Its outcome belongs in the
final verification record below.

## Repeatable checks

Use the pinned root Node/npm versions and preserve the existing `.env`. The new source
contract runs directly or as part of the normal contract suite:

```sh
node tools/manufacturing/test-dana-page-spacing-contract.mjs
npm run test:contracts
```

The contract parses application CSS and inline styles, rejects private visual paint
and palette utilities, verifies the spacing/content modules are registered, and keeps
neutral Dana core independent of manufacturing selectors.

For the browser check, start the local API on 3333 and serve the current production
frontends with SPA fallback and their usual `/api` proxy: Blade Tracking 4200, Cutter
Builder 4201, Greenshed 4202, Lapper 4203 and Plant Dashboard 4204. Supply the local
administrator password through `SEED_ADMIN_PASSWORD` or `MESHFORGE_ADMIN_PASSWORD`;
`MESHFORGE_ADMIN_EMAIL` overrides `admin@example.com`. The target reads the root `.env`.
`MESHFORGE_BASE_URL` may override the loopback API, and `CHROMIUM_PATH` overrides
`/usr/bin/chromium`.

```sh
npx nx run manufacturing-tools:test-dana-spacing
```

This invokes `test-ui-ux-review.mjs --spacing`: 60 route/tab states at 1920, 1024 and
390px, plus four authentication states at 320px, for 184 route/viewport checks. It
checks standard page and panel/header gutters, stacked-header margins, document
overflow, names, landmarks, duplicate IDs, browser exceptions and failed API responses.
Interactive navigation and Plant filter/report checks also run. Every spacing state
gets a screenshot. Reports and snapshots are in `tmp/dana-spacing-review/`, with the
final JSON at `tmp/dana-spacing-review/results.json`.

Run the normal `npm test`, `npm run lint` and `npm run build` checks as well. Numeric
assertions supplement screenshot inspection; they do not establish that every dialog,
role, theme and unusual data state has been visually reviewed. These are local checks
and do not claim production deployment or physical hardware verification.

## Final verification record

The fresh coordinated build passed all seven production targets. All **184**
route/viewport checks and **five** interaction groups passed with no spacing failures,
document overflow, unnamed controls, duplicate IDs, browser exceptions or API server
failures. All 50 workspace test targets, deployment tests and 58 lint targets passed.
Shared Dana's 72 Chromium assertion sites and four boundary/visual-source/consumer AOT
checks passed. All **84 source contracts**, including the new 52-sheet ownership and
spacing guard, passed after the final CSS change.

Targeted reviews exercised real loaded Intake/Find cards; synthetic populated Lapper
Cycle/Macros tables; Running Machines keyboard scrolling and native phone table;
Plant SVG responses, KPIs and narrow alerts; and Admin dialogs. Lapper fixtures
intercepted GET responses only. Dark Admin samples confirmed readable headers,
zero nested gutters and print padding reset. A final shared-style check passed 53
isolated assertions for selected/highlight/detail table backgrounds in light/dark,
through striping and hover, while preserving normal row colors. That last color-only
change was followed by a fresh production/shared-library build and four populated
application checks at 1024/390px in both themes, including hover; all passed.

All results are local; physical hardware and every possible data/theme/role
combination were not exercised. Existing environment, data and server workflows were
preserved. No deployment or environment publication was performed.
