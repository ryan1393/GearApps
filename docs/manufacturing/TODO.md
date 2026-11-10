# Gear Apps TODO

This file tracks only remaining work. Completed setup/test/fake-data behavior is documented in `docs/manufacturing/START_AND_TEST_GUIDE.md`.

## Before production use

- [ ] Re-run `npm run test:gear-apps` on the target development laptop after the Blade Tracking strict-null build fix and confirm all four projects build.
- [ ] Confirm the 113-route non-mutating API probe passes against the target database.
- [ ] Run the full workflow **preflight** with dedicated test records.
- [ ] Run the mutating end-to-end workflow only after preflight passes and confirm the complete Blade Tracking → Cutter Builder → Green Shed lifecycle.

## Data and migration validation

- [ ] Validate a clean PostgreSQL GearApps schema from scratch.
- [ ] Run `npm run validate:base-data` and `npm run import:base-data` on the target database; verify counts including 15 summary additions, 216 blade requirements, and 120 cutter bodies.
- [ ] Resolve the 16 duplicate/ambiguous cutter-body serial mappings in `tools/manufacturing/base-data/source/cutter-body-info-BASE-DATA-READY.xlsx`; they are intentionally not imported yet.
- [ ] Review base-data export/import counts for departments, employees/users, machines, models, summaries, gears, pinions, and cutter pull reasons.
- [ ] Validate the audited cutter-history import against a fresh legacy export before production migration.
- [ ] Confirm imported Cuttergrind department/reference values map correctly to current `CUTTERGRIND` behavior.

## Shop-floor acceptance

- [ ] Test Blade Tracking tray/grinding/coating flow with the actual scanners.
- [ ] Verify the Blade Locations screen against real tagged locations/trays and confirm tray → blade drill-down matches physical inventory.
- [ ] Verify Admin > Locations create/edit/enable/disable behavior with a normal location plus GSR-/GSP-/CGDR-/CGDP-/CGFR-/CGFP- Summary shelves; occupied-location protection should reject unsafe reroutes/disables.
- [ ] Verify grinding scrap and replacement quantities.
- [ ] Verify coating return accepts only `CGFR-<summary>` or `CGFP-<summary>` for the matching Summary + Part Type.
- [ ] Verify Cutter Builder build with production-like cutter/body/tray data.
- [ ] Verify Green Shed running-machine department/cell display after the automatic compatibility test passes.
- [ ] Verify FC/CMM checks at the required piece intervals.
- [ ] Verify intact changeover goes to `GSR-<summary>` / `GSP-<summary>`, releases the machine, and can be re-set up from that shelf.
- [ ] Verify re-setup clears the prior Green Shed shelf assignment.
- [ ] Verify teardown-required pull routes dull blades only to `CGDR-<summary>` or `CGDP-<summary>`.
- [ ] Verify a teardown tray may start EMPTY/unlocated; if returned blades > 0 it inherits Summary + Part Type and is placed on CGDR-/CGDP-, while a fully-scrapped teardown leaves the tray EMPTY/unlocated and Available / Ready to Use.
- [ ] Verify teardown scrap/returned-blade quantities and lifecycle history.


## UI design-system cleanup

- [x] Split the monolithic Gear Apps stylesheet into one import-only entry point plus ordered foundation/layout/components/theme/feature modules without changing the intended visual cascade.
- [x] Add modular-style ownership/regression contracts and a zero-input duplicate-selector audit.
- [x] Consolidate the layered shell/button/Admin/inventory/table/dashboard overrides into canonical owners; same-cascade duplicate selector debt is now 0.
- [x] First-pass modular CSS was started successfully on the Windows development laptop and visually confirmed by the user.
- [x] Apply the second-pass design-system standardization patch on the Windows development laptop.
- [x] Complete V69.0 shared token/table/icon ownership cleanup and confirm the authoritative suite passes.
- [x] Implement full-database Inventory Control Center browsing search for Trays, Containers, Locations, and Blades.
- [x] Migrate all 23 frontend tables to the shared Dana table system with relationship-safe parent/detail grouping.
- [x] Consolidate Cutter Builder and Greenshed workflow pages onto the shared workflow-layout primitives.
- [ ] Run the V69.2 combined package on Windows and confirm the authoritative `npm run test:gear-apps` gate passes.
- [ ] Complete a final visual spot-check of Blade Tracking, Cutter Builder, Greenshed, and Admin after V69.2 is green.

## Production readiness

- [ ] Set `DATABASE_SYNCHRONIZE=false` for production.
- [ ] Perform a database backup/restore test.
- [ ] Complete final role/permission review.
- [ ] Complete production environment/secrets review.
- [ ] Confirm production hostnames, ports, and reverse-proxy/deployment configuration.

## Current conventions

- Cutter Builder = application name.
- Cuttergrind / `CUTTERGRIND` = department.
- `GSR-<summary>` = Green Shed RING intact-cutter shelf.
- `GSP-<summary>` = Green Shed PINION intact-cutter shelf.
- `CGDR-<summary>` or `CGDP-<summary>` = Cuttergrind dull shelf.
- `CGFR-<summary>` = Cuttergrind finished RING shelf; `CGFP-<summary>` = Cuttergrind finished PINION shelf.

- [ ] Verify cutter-body definition decoding against shop-floor/Dana convention before production rollout.

- [ ] Run the fresh all-data SQL Server + Excel migration preflight on the laptop, review reconciliation, then apply.

- [x] Reconcile legacy repeated Central Log inserts such as FC|9884 as one logical operation when Build_ID/Part_Count/Emp_ID agree; archive extra source rows.
- [x] Preserve orphan build Check_ID 278 as archive-only with no operational build/event/log rows.
- [ ] Run fresh all-data preflight again on the laptop and confirm unresolved core relationships = 0 before APPLY.

- [x] Fix full-workflow shelf-tag assertion variable collision.
- [x] Use dedicated automatic E2E PINION/RING-compatible machines instead of The automated workflow uses a dedicated E2E Green Shed machine and does not use production machines.

- [x] Add automatic PINION/RING cross-type part-number rejection tests.
- [x] Add automatic PINION/RING cross-type machine rejection tests.

- [x] Remove TypeORM pessimistic-lock + relation-join queries from transactional services; lock base rows first and load relations separately.

- [x] Add zero-input authenticated backend mutation suite with CRUD, authorization, rollback, duplicate, concurrency, error-message, and write-route coverage checks.
- [x] Centralize Gear Apps styling/Tailwind tokens for all current and future Angular frontend apps.
- [x] Add shared Admin create screen for Users, Part Summaries, Models, Machines, and Cutter Bodies.
- [x] Make Cutter Body creation and Dana serial assignment admin-only while preserving operator scan/build access.
- [x] Enforce department-scoped app editing with cross-department dashboard-only access and admin bypass.
- [x] Add safe true data-reset workflow that validates fresh source before deleting old PostgreSQL rows.
