# Gear Apps — Current AI Handoff
_Last updated: 2026-08-27 — V69.2 combined UI completion candidate_

## 1. CURRENT WORKING PROJECT / BASELINE

- Active Gear Apps workspace:
  `C:\Users\ryan.thompson\Downloads\gear-appsv0.1`
- Gear Apps is a Windows-hosted Nx monorepo.
- Frontends:
  - Blade Tracking — port 4200
  - Cutter Builder — port 4201
  - Greenshed / Green Shed — port 4202
- Shared NestJS API — port 3333.
- Stack: Angular, NestJS, Nx, TypeScript, PostgreSQL target DB, SQL Server legacy source, Excel supplemental data, TypeORM, PowerShell/CMD local tooling.
- Important root commands:
  - `SETUP-GEAR-APPS.cmd`
  - `START-GEAR-APPS.cmd`
  - `RESET-AND-REFRESH-ALL-DATA.cmd`
  - authoritative regression: `npm run test:gear-apps`
- Current patch target is always `gear-appsv0.1`.
- Source-only patches do NOT run `npm install`.
- If `package-lock.json` changes, setup/install is required.
- Confirmed live Windows known-good baseline: **V69.0 Shared UI Foundation**.
  - deep scans passed;
  - focused UI contracts passed;
  - authoritative `npm run test:gear-apps` passed;
  - Gear Apps restarted successfully;
  - `package-lock.json` remained unchanged and no npm install was required.
- Current source package under review: **V69.2 combined Inventory/Table/Workflow completion**.
  - It is statically validated against V69.0, but must still pass the live Windows authoritative regression before becoming the new baseline.

---

## 2. ABSOLUTE PATCH DELIVERY RULES

These are now standing Gear Apps rules.

1. Every completed Gear Apps change must be delivered as an actual user-facing patch/code artifact, normally a double-clickable `.cmd`, plus a concise written summary.
2. Do not give the user only a prose summary and say code will come later.
3. Do not generate pictures/infographics unless the user explicitly asks for an image.
4. Patches must:
   - verify the exact project path;
   - back up every file before replacing it under `_patch_backups`;
   - write files to exact explicit paths;
   - verify feature markers/files after writing;
   - run the focused relevant tests;
   - run the authoritative maintained regression path;
   - clearly state whether `npm install` is required;
   - roll back the complete patch batch when validation fails.
5. Do NOT calculate patch paths with fragile substring-relative math. An earlier patch wrote into an unintended `tch\...` path.
6. Do NOT generate nontrivial PowerShell line-by-line with CMD `echo`.
   - Use an embedded Base64 PowerShell payload.
   - Verify the payload SHA-256.
   - Parse the PowerShell payload for syntax errors before execution.
   - This avoids CMD corruption of `>`, `<`, `|`, `&`, parentheses, braces, quotes, and PowerShell variable syntax.
7. Avoid PowerShell strings like `$app:` unless `${app}:` or equivalent delimiting is used. This previously caused `InvalidVariableReferenceWithDrive`.
8. Generated PowerShell arrays must not contain a trailing comma before `)`.
9. Future patch validation must inspect maintained contract expectations BEFORE mutation. Do not assume semantically equivalent markup will satisfy a strict contract.
10. Do not execute every `tools\manufacturing\test-*.mjs` directly just because it exists.
    - `npm run test:gear-apps` / `tools\manufacturing\run-all-tests.ps1` is the authoritative orchestration.
    - Some tests require fixtures, DB state, ordering, environment setup, or the normal harness.
    - Only contracts already proven independently runnable should be invoked directly.
11. When a patch fails after modifying source, rollback must restore the whole patch batch, not leave a partially applied UI cleanup.

---

## 3. UI / DESIGN SYSTEM DIRECTION

The user wants Gear Apps visually simplified and de-hardened.

Primary goals:
- cleaner shared styling;
- fewer nested boxes/cards;
- consistent app/table/admin/component treatment;
- shared CSS variables/tokens instead of repeated hardcoded values;
- Cutter Builder tables aligned with Blade Tracking and Greenshed;
- table headers should have more breathing room;
- table sort should be triggered by clicking the column header, not a separate sort button;
- shared table filter/search/header behavior across apps;
- remove weird/floating/symbol artifacts in header/search controls;
- maintain professional Dana enterprise visual language.

Shared styling source:
`libs\shared\ui-tailwind\src\styles\gear-apps.css`

Supporting shared style area:
`libs\shared\ui-tailwind\src\styles\gear-apps\...`

Known design goals:
- desktop 1500px+ shop-floor scale;
- 296px desktop sidebar;
- 76px topbar;
- shared type scale around 13 / 15 / 17 / 20px;
- shared CSS variables for spacing, typography, radii, table header/cell padding, colors, shadows, panel rhythm;
- do not keep appending numbered CSS override blocks;
- use managed zones such as:
  - `GEAR APPS MANAGED PROFESSIONAL UI`
  - `GEAR APPS MANAGED ADMIN LIST TOOLBAR`
- keep style modules under the existing contract ceiling (currently <=520 lines/module).

The user does NOT want a separate picture/mockup instead of code.

---

## 4. MESHFORGE BRANDING / ICON RULES

The suite is branded MeshForge ("by Dana Gear Apps Suite"). This replaced the earlier Dana Diamond / Truck Log
branding direction; older notes below that mention the Dana Diamond describe history.

- Brand assets and the palette are documented in `libs/manufacturing/assets/brand/README.md`.
- Gear Apps assets:
  - `assets/brand/meshforge-mark.svg` for app/sidebar and login branding;
  - `assets/branding/meshforge-favicon.png` for browser tabs.
- App top/tab bar direction: MeshForge mark plus `page | app`.
- Every app-nav must use the maintained shared file-backed MeshForge mark.
- Palette: charcoal shell, orange actions. Informational blue, success, danger and Greenshed machine-state
  colours are operational signals and stay as they are.
- Shared semantic icon contracts are intentional; current known example:
  - Blade Tracking Receive workflow expects `gear-glyph-receive`.

---

## 5. TABLE / COMPONENT CLEANUP STATUS

### Completed and confirmed live in V69.0
- Blade Tracking, Cutter Builder, and Greenshed dashboard tables use the shared `danaTable` system.
- Column-header click sorting and shared current-page column filtering are established.
- `foundation/tokens.css` is the canonical shared token source.
- Dead/conflicting `design-tokens.css` and `ui-cleanup.css` declaration ownership is retired.
- Shared table/filter rhythm is owned by `components/data-display.css`.
- The old V53/V65 table override debt and retired V35.3 Admin marker were removed/consolidated.
- Topbar and table sort/filter/close controls use shared semantic SVG icons instead of Unicode controls.
- V69.0 deep scans, focused contracts, and authoritative `npm run test:gear-apps` passed on Windows.

### Implemented in the V69.2 combined candidate
- Inventory Control Center has full-database server-side browsing search on Trays, Containers, Locations, and Blades.
- All **23/23** frontend tables use the shared `danaTable` system.
- Relationship tables use `data-dana-table-group` / `data-dana-table-detail` so parent and expanded child/detail rows remain together while sorting and filtering.
- Static/action/detail columns are explicitly protected with `data-dana-table-static`.
- A canonical `components/workflow-layout.css` module now owns reusable workflow/forms/results composition.
- Cutter Builder Build, Teardown, and Lookup are migrated away from page-local box-heavy Tailwind composition.
- Greenshed Setup, Pull, Check, and Lookup are migrated to the same shared workflow vocabulary.
- New maintained contracts cover full-database Inventory Control Center search, complete table migration, grouped-row safety, and workflow-surface consolidation.

### Remaining after V69.2
- Live shop-floor visual acceptance on real scanners/large displays.
- Production/data-migration acceptance tasks tracked in `TODO.md`.
- Do not reopen token/table/workflow ownership as unfinished after V69.2 passes the live authoritative regression.

The user wants coherent shared-design-system packages, not another chain of page-local micro-overrides.

---

## 6. SCRAP / DISCARDED BLADES PAGE — CURRENT FINDINGS

Confirmed active template:
`libs\manufacturing\frontend\feature-blade-tracking\src\lib\pages\scrap-blades\scrap-blades.component.html`

Maintained canonical title:
`<h1 class="gear-page-title">Scrap / Discarded Blades</h1>`

The Scrap Blade contract expects:
- SCRAPPED filtering/search;
- readable scrap-history drill-in;
- shared styling;
- current API contract preservation.

Important discovery:
- `tools\manufacturing\test-scrap-blade-history-contract.mjs` passed after the canonical title repair.
- `tools\manufacturing\test-ui-deep-scan-contract.mjs` is stricter about the canonical page shell than simple semantic equivalence.
- A prior attempt used `<section class="gear-page">`, but the maintained deep-scan contract expects the canonical Gear Apps form:
  `<div class="gear-page">`

Standing rule:
- Read the active contract before applying structural markup.
- Do not substitute `section`/`main` just because the class is the same.

---

## 7. TEST / CONTRACT CLEANUP HISTORY — HISTORICAL CONTEXT

> **Superseded status note:** The V67 stopping point below is retained only as history. V68.4.1 recovered the full baseline, and V69.0 later passed the authoritative suite. Do not treat the old unresolved-reference state as current.

A long sequence of V55–V67 patches exposed both real contract drift and mistakes in the patch/testing strategy.

### Key lessons from V55–V66
- Several old tests were stale after style ownership was moved into modular shared CSS.
- Duplicate-selector / style-source contracts exposed old selector debt.
- `gear-apps.css` is intended to remain an import-only public entry point.
- Style declarations belong in Gear Apps style modules.
- Historical contracts that no longer represent the maintained architecture should be archived/reconciled instead of repeatedly weakening new source to satisfy obsolete assumptions.

### V66.3 / V66.4
A safe test run exposed:
`tools\manufacturing\test-scrap-blade-history-contract.mjs`
complaining that Scrap Blade UI was missing:
`<h1 class="gear-page-title">Scrap / Discarded Blades</h1>`

A first repair patch failed because nontrivial PowerShell was assembled through CMD `echo`, producing an `Unexpected token '}'` parser error.

Standing solution:
- Base64-embedded verified PowerShell payloads only.

### V66.5 / V66.6 / V66.7 / V66.8
- V66.5 found the active Scrap Blade template but was too conservative to change it.
- V66.6 normalized the canonical H1.
- Deep-scan then exposed the shared `gear-page` shell requirement.
- V66.7 used `section.gear-page`; that did not satisfy the maintained contract.
- V66.8 corrected the strategy to inspect the contract and use canonical `div.gear-page`.
- The Scrap Blade focused contract and deep-scan path were then no longer the main blocker.

### V66.9
A no-source-change triage run isolated three unrelated baseline failures:
- `tools\manufacturing\test-dana-apps-premerge-contract.mjs`
- `tools\manufacturing\test-dana-diamond-brand-contract.mjs`
- `tools\manufacturing\test-shared-icon-assets-contract.mjs`

Specific reported findings:
- frontend production bundle still contained test passwords;
- Blade Tracking app-nav was not using the required shared file-backed Dana Diamond;
- Blade Tracking dashboard was missing `gear-glyph-receive`.

### V66.10
Attempted to repair those three in one patch, but broader test/harness state was still unstable.

### V67
Attempted a full baseline reconciliation plus shared UI variables.
This exposed a major validation mistake:
- V67 tried to discover and execute nearly every `tools\manufacturing\test-*.mjs` directly.
- Many tests are NOT standalone read-only contracts.
- Some depend on fixture setup, database state, ordering, or the authoritative harness.
- This generated a huge wall of misleading failures.
- V67 rolled its source/style batch back.

Standing rule:
- Never use filename discovery as the regression orchestration.
- Use the project’s authoritative test harness.

### V67.1
No-source-change baseline patch switched back to:
`npm run test:gear-apps`

This exposed the REAL authoritative harness blocker:
`tools\manufacturing\run-all-tests.ps1`
still required a missing historical contract:
`tools\manufacturing\test-ui-body-depth-contract.mjs`

### V67.2
Attempted to replace:
`test-ui-body-depth-contract.mjs`
with:
`test-ui-style-integrity-contract.mjs`

That change itself passed syntax/self-check, but the authoritative harness then stopped on another missing historical contract:
`tools\manufacturing\test-blade-inventory-overview-contract.mjs`

V67.2 restored the original harness after regression failure.

### V67.3
V67.3 was created specifically to reconcile ALL literal `test-*.mjs` references in `tools\manufacturing\run-all-tests.ps1` against actual files under `tools`.

Known stale mappings built into V67.3:
- `test-ui-body-depth-contract.mjs`
  -> `test-ui-style-integrity-contract.mjs`
- `test-blade-inventory-overview-contract.mjs`
  -> `test-global-professional-ui-contract.mjs`

V67.3 correctly refused to change the harness because it found three additional unresolved missing references:
- `test-fixtures.mjs`
- `test-ui-style-duplicate-budget-contract.mjs`
- `test-user.mjs`

This was the V67.3 stopping point and is no longer current.

Important:
- V67.3 did NOT modify the harness because unresolved references remained.
- The application source/UI/CSS was not changed by that reconciliation attempt.
- Do not blindly delete or replace these three files.
- Their usage inside `tools\manufacturing\run-all-tests.ps1` must be inspected first.
- `test-fixtures.mjs` and `test-user.mjs` may be helper/fixture references rather than standalone contracts.
- `test-ui-style-duplicate-budget-contract.mjs` may be a genuinely retired contract with a maintained successor, but the replacement must be proven from the current test/harness source, not guessed.

---

## 8. CURRENT NEXT STEP / V69.2 RELEASE GATE

The old V67 harness-reconciliation detour is complete. Do not return to it.

Current work is the combined V69.2 UI completion package:
1. preserve the confirmed green V69.0 foundation baseline;
2. deliver Inventory Control Center full-database browsing search;
3. complete all remaining `danaTable` migrations;
4. preserve parent/detail row groups during sorting/filtering;
5. de-box Cutter Builder and Greenshed workflow pages through the shared workflow-layout module;
6. run deep JSON, Node, PowerShell, CSS, template, and TypeScript checks;
7. run the focused V69.2 contracts;
8. run authoritative `npm run test:gear-apps`;
9. roll back the complete V69.2 source batch on any failure;
10. only mark V69.2 as the new baseline after the live Windows authoritative regression passes.

The user requested no intermediate V69.1 command. V69.1 and V69.2 are therefore delivered as one combined V69.2 package.

---

## 9. AUTHORITATIVE TESTING RULE GOING FORWARD

The authoritative regression command is:

`npm run test:gear-apps`

which calls the maintained test harness:

`tools\manufacturing\run-all-tests.ps1`

Do NOT run all `tools\manufacturing\test-*.mjs` individually as a substitute for the harness.

Independently runnable contracts may still be used as focused preflight checks when their standalone behavior has already been proven.

Current known useful standalone UI contracts include some of:
- `test-ui-style-integrity-contract.mjs`
- `test-shared-ui-style-source-contract.mjs`
- `test-ui-consistency-contract.mjs`
- `test-ui-deep-scan-contract.mjs`
- `test-global-professional-ui-contract.mjs`
- `test-angular-template-structure-contract.mjs`
- `test-scrap-blade-history-contract.mjs`

But the authoritative final gate remains `npm run test:gear-apps`.

---

## 10. DATABASE / ACCESS / INVENTORY RULES TO PRESERVE

PostgreSQL is the target database.
SQL Server is read-only legacy source.

Reset workflow intent:
1. export/validate source data before deletion;
2. destructive confirmation;
3. record `tools\manufacturing\data-import\work\pre-reset-target-manifest.json`;
4. truncate application rows while preserving schema;
5. bootstrap reference data;
6. import base data;
7. import/reconcile cutter history;
8. recreate local users;
9. seed inventory/mock data;
10. validate.

SQL Server source must never be mutated.

Reference values to preserve:
- cutter event types: `CB`, `CS`, `FC`, `CMM`, `CP`, `CC`, `TD`
- build statuses: `BUILDING`, `READY`, `RUNNING`, `SHELF`, `PULLED`, `CLOSED`
- part types: `RING`, `PINION`
- tray stages: `EMPTY`, `WAITING_FOR_GRINDING`, `GRINDING`, `READY_FOR_COATING`, `AT_COATER`, `READY_FOR_CUTTER`
- check results: `PASS`, `FAIL`, `HOLD`
- pull reasons: `DULL`, `DAMAGED`, `CHANGEOVER`, `QUALITY`, `OTHER`

Department/app rules:
- app keys:
  - `BLADE_TRACKING`
  - `CUTTER_BUILDER`
  - `GREENSHED`
- CUTTER GRIND code 45 edits Blade Tracking + Cutter Builder.
- GEAR QUALITY code 48 edits Greenshed.
- PINION CUTTING 132 / GEAR CUTTING 152 dashboard/view-only where not owner.
- MANAGEMENT 99 dashboard-only for normal users.
- admin bypass is role-based, not department-based.
- cross-department mutations should fail with 403.

---

## 11. CUTTER / TRAY / LOCATION RULES TO PRESERVE

Cutter bodies:
- physical asset identity persists from manufacturer/MF serial to Dana serial;
- only admin may create cutter bodies or assign Dana serials;
- operators may scan/use bodies;
- Admin > Cutter Bodies is master data.

Reset inventory:
- 300 trays;
- 100 containers;
- tray serial: `T0001`;
- container serial: `C0001`.

Empty tray canonical state:
- stage `EMPTY`;
- 0 blades;
- no active container;
- normally no active location;
- label: `Available / Ready to Use`.

Shelf tag conventions:
- Green Shed Ring: `GSR-<summary>`
- Green Shed Pinion: `GSP-<summary>`
- Cuttergrind Dull Ring: `CGDR-<summary>`
- Cuttergrind Dull Pinion: `CGDP-<summary>`
- Cuttergrind Finished Ring: `CGFR-<summary>`
- Cuttergrind Finished Pinion: `CGFP-<summary>`
- empty-tray Ring: `CGER-<summary>`
- empty-tray Pinion: `CGEP-<summary>`

Superseded current-tag patterns include generic `CGD-`, `CGF-`, `G<summary>`, and undashed old formats.

Operator-facing physical location identity must show:
`locations.serial_number`

`locations.number` remains a Summary/master reference, not the physical tag displayed to operators.

---

## 12. PRINTING RULES TO PRESERVE

Admin tag printing should use printer-native IPL or ZPL, not browser HTML.

Tray/container/location tags:
- 1-D Code 128 barcode;
- human-readable persisted serial only;
- examples: `T0001`, `C0001`, stored location serial;
- 2.25 in roll/web stock;
- 2.125 in label width x 0.625 in label height;
- 0.125 in top/bottom gap.

Cutter Build Card:
- authoritative export is IPL `.prn`;
- companion `.png`;
- browser print remains a separate option.

---

## 13. NAVIGATION / RELATIONSHIP RULES

Readable parent -> child drilldowns should exist where relationships are real:
- Tray -> Blades -> History
- Container -> Trays -> Blades
- Location -> Trays -> Blades
- Cutter Build -> blade records

Blade Tracking dashboard:
`GET /api/v1/trays/dashboard`

Metrics:
- Blades In Process
- Trays At Coater
- Trays In House
- Movements Today

Movement/activity counts must exclude null-audit mock reset assignments.

Tray Contents must show Summary + Part Type together and group blades by Summary + Part Type.

Greenshed availability:
- open builds in READY or SHELF are available even with no cutter_build_locations shelf record;
- UI may show `Available — no shelf recorded`;
- Greenshed must not show trays on cutter shelves.

---

## 14. LOCAL DEBUG LOGIN RULE

Local shortcut buttons may exist only on:
- `localhost`
- `127.0.0.1`

Operator/Admin shortcuts may fill the local email field.

Do NOT ship literal debug/test passwords in frontend production source/bundles.
Shortcuts must not auto-submit.

---

## 15. DANA APPS FUTURE MERGE PLAN

Gear Apps and Truck Log remain separate projects for now.

Future plan:
- stabilize Gear Apps;
- stabilize Truck Log;
- later merge under a new Nx monorepo named `Dana Apps`;
- use one shared Dana design system;
- keep application domains/backends appropriately separated.

Do not treat this future merge as already implemented.

---

## 16. CURRENT USER EXPECTATION FOR NEXT CHAT

When a new Gear Apps chat starts:
- use **V69.0** as the confirmed live Windows known-good baseline until V69.2 passes live;
- do not reopen the old V67 missing-reference/harness detour;
- do not redo dashboard `danaTable`, Admin search, Dana branding, large-screen shell scaling, or the V69.0 token/icon cleanup;
- preserve the combined V69.2 scope: Inventory Control Center search, 23/23 shared tables with relationship-safe grouping, and shared workflow-page consolidation;
- deliver actual CMD/code artifacts, never pictures/mockups unless explicitly requested;
- significant releases require exact source hashes, backups, full-batch rollback, deep scans, focused contracts, and authoritative `npm run test:gear-apps`;
- do not claim V69.2 is green until its CMD passes on the Windows workspace.

---

## 17. CONFIRMED GREEN BASELINES

### V68.4.1 — baseline recovery
- Deep JSON, Node, and PowerShell scans passed.
- Focused recovery contracts passed.
- Authoritative `npm run test:gear-apps` passed.
- Runtime E2E tray/container fixtures use canonical numeric `T...` / `C...` serials.
- `package-lock.json` did not change; no npm install was required.

### V69.0 — shared UI foundation
- Canonical token ownership established.
- Dead/conflicting cleanup/token declaration sources retired.
- Shared table/filter ownership consolidated.
- Semantic SVG controls replaced old Unicode sort/search/close controls.
- Deep scans, focused contracts, and authoritative `npm run test:gear-apps` passed live on Windows.
- Gear Apps restarted successfully.
- V69.0 is the current confirmed source baseline.

---

## 18. V69.2 COMBINED UI COMPLETION CANDIDATE

Implemented scope:
- full-database search for Inventory Control Center Trays, Containers, Locations, and Blades;
- server DTO/controller/service search support using PostgreSQL `ILIKE`;
- all 23 frontend tables on `danaTable`;
- relationship-safe parent/detail grouping through `data-dana-table-group` and `data-dana-table-detail`;
- static action/detail columns protected from sorting/filter generation;
- shared workflow layout module;
- Cutter Builder Build/Teardown/Lookup de-boxing;
- Greenshed Setup/Pull/Check/Lookup de-boxing;
- new maintained contracts for search, table migration/grouping, and workflow consolidation;
- refreshed handoff/design-system documentation.

Static review status:
- selected independently runnable contract suite passed;
- new V69.2 contracts passed;
- all 23 tables were detected as shared-table tables;
- Angular template structure and relationship contracts passed;
- shared CSS audit reports no new same-cascade duplicate ownership;
- `package-lock.json` remains unchanged; no npm install is required.

Final status:
- **PENDING LIVE WINDOWS CMD VALIDATION.**
- The final package must pass focused contracts and authoritative `npm run test:gear-apps` before V69.2 becomes the new known-good baseline.
