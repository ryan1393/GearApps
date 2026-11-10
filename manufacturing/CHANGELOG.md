# Changelog

## 70.3.0 (2026-11-09)

- Fixed clean Linux Docker builds when a native dependency's prebuilt download
  fails: dependency stages now include the Python/Make/C++ toolchain, and CI
  builds every application image with a forced native-compilation check.
- The bootstrap services use the locally built API image without attempting to
  pull its unpublished tag from Docker Hub.

All four applications now belong to one root Nx workspace and use one dependency
manifest and lockfile. Application releases share the root version constant.

- All application and end-to-end projects now live under root `apps/`, including
  the shared API and the Lapper Read collector.
- One root `compose.yml` and existing root `.env` configure the whole stack.
  Deployments retain the `dana-apps` project and PostgreSQL volume identity.
- Every web client and Lapper Read uses `gear-app-server` on port 3333, the shared
  email login and PostgreSQL connection. The standalone Lapper API is removed.

- Aligned Angular 20.3.35, NestJS 11.2.9, TypeORM 1.1.2, Nx 24.0.5,
  TypeScript 5.9.3, Jest 30, Node 24.22.1, and npm 11.9.0.
- Dana UI 0.3.3 source is included under libs/shared/dana-ui and built with the
  root Angular compiler. Every client uses this source and one generated package.
- Removed the manufacturing dependency install, lockfile, Nx configuration,
  duplicate UI package, obsolete UI adapters, and unused crypto/UUID packages.
- Migrated Angular application builds, backend webpack builds, Jest configuration,
  flat ESLint configuration, Docker contexts, CI, Windows tools, and deployments.
- Updated JWT decoding, Nest configuration typing, public health tests, template
  resolution, and keyboard/focus handling for the shared framework versions.
- Retained the 70.2.1 authentication and inventory safeguards, API routes,
  PostgreSQL data preservation, Lapper history and collector retry/checkpoint rules.

Upgrade: install once at the repository root with npm ci. Keep the existing root
.env for the shared API and Compose stack. Use
npm run test:versions to detect dependency or release-version drift.

## 70.2.1 (2026-11-09)

Recovered from the original 70.2.0 upload and rebuilt with security, inventory,
deployment, and user-interface fixes. The original archive and this source are
retained in the GearApps GitHub repository alongside the existing Lapper app.

- Department relations load during authentication, restoring operator permissions.
- Refresh tokens use complete digests, unique IDs, token purposes, and atomic
  rotation. Expiring single-use recovery codes revoke existing sessions on reset.
- Verified Google sign-in requires a preapproved account bound to that identity;
  recovery and database errors are sanitized. Legacy email casing is supported.
- Working shared password-recovery pages, keyboard login, and invalid-session
  redirects are available in all three apps.
- Inventory mutations protect assigned blades and occupied trays, containers,
  shelves, and machines. Cutter compatibility and stale machine-run checks are
  enforced by the server. Scan selection, pagination, and response races are fixed.
- Optional empty Sentry configuration now starts. Automatic imports initialize empty
  master data while preserving existing operational edits. Deploy uploads use private
  staging. Additive user schema changes work with runtime synchronization disabled.
- Dana UI 0.3.2 is built for Angular 19 and retains Gear's compatibility styles,
  with table cleanup, Escape/focus behavior, and modal accessibility corrections.
- Build-only dependencies moved out of the production install and compatible
  vulnerable dependencies were updated. Remaining framework advisories are recorded
  separately; this release does not claim a clean dependency audit.
- Portable unit/configuration/source-contract runners and behavioral regressions
  are included. The parent repository adds dedicated manufacturing CI.

Upgrade: users must sign in again and request new recovery links. Configure SMTP
and PUBLIC_WEB_BASE_URL (Docker GEAR_PUBLIC_WEB_BASE_URL) for recovery email links.
Use the dedicated workflow endpoints rather than generic blade-assignment PATCH.

## 70.2.0 (2026-10-28)

All Gear Apps styling now comes from **@dana/ui 0.3.0** (Dana UI). No screen looks different:
the compiled stylesheet has the same 1,496 rules in the same order, and 86 screenshots (every route,
every admin tab, login and an error toast, on desktop and phone) are pixel-identical to 70.1.2.

Deploy as usual with `Deploy-GearApps.cmd`. There is no database change.

### Changed

- **Styling moved into Dana UI.** Gear's own design-system libraries (`libs/shared/ui-tailwind`
  and `libs/gear/ui`) are gone. Their CSS now ships in @dana/ui 0.3.0 as an optional Gear
  compatibility layer (`gear-compat.css`, `gear-compat-features.css`,
  `gear-compat-overrides.css`) that only Gear loads. Truck Log's Dana UI stylesheets are
  byte-identical to 0.2.0.
- Components import Dana UI from `@dana/ui` (29 files), and the Tailwind preset comes from
  `@dana/ui/tailwind/tailwind-preset.cjs`.
- **Internal Movement** tray details use Dana UI's detail grid, and the **Green Shed Setup**
  button uses `danaButton`, instead of Gear-only colors and a Gear-only button class.
- Contract tests now read the Dana UI component source from the vendored package's source map,
  and check that every shared stylesheet comes from `@dana/ui`.
- README: new "Styling (Dana UI)" section with the styling rules and the Dana UI update steps.
  The older design-system docs are marked as superseded.

### Tested

- 88 contract tests, typecheck and the Angular template compiler (all projects), production builds
  of all three apps.
- Frontend Jest specs ran for the first time in this review (6 tests, all pass).
- `apps/server-e2e` was not run: it uses SQLite, and the uploaded `node_modules` holds the
  Windows build of `better-sqlite3`. Unchanged since 70.1.0.

## 70.1.2 (2026-10-28)

The 70.1.1 deploy stopped on the next summary with the same condition (Summary 30163, revisions
blank and B). The plant confirmed blade requirements are the same for every revision, so this is
now a rule instead of per-summary mappings:

- **A blade requirement with no revision applies to every enabled revision of that Summary.**
  The import no longer stops on "N enabled revisions exist". Tested with 102 summaries carrying
  several revisions; every revision receives the same blade counts, and re-running changes nothing.
- **Supplemental summaries** (`summary_additions.json`) no longer stop the import when several
  revisions already exist; that step only ensures the summary exists.
- `cutter_blade_requirements.json` is back to exactly the Excel export (216 rows); the 70.1.1
  manual 30135 rows are no longer needed. `Summary_Rev` still accepts an explicit revision, or
  `(blank)` for exactly the blank revision, if a requirement ever needs to differ by revision.

## 70.1.1 (2026-10-28)

Hotfix for the first 70.1.0 deploy, which stopped at the reference-data import.

- **Summary 30135 blade requirement.** Production has two enabled revisions of Summary 30135
  (blank and B), and the import refused to guess which one the 19-blade RING/PINION requirement
  belongs to. It now applies to both, as decided on 2026-10-27. `Summary_Rev` in
  `tools/base-data/data/cutter_blade_requirements.json` accepts `(blank)` to mean exactly the
  blank revision; use one row per revision when a requirement covers several.
- **Deploy shows the real error.** If a setup step (database bootstrap or reference-data import)
  fails, the deploy now prints that step's last 40 log lines instead of only `bash -s failed`.
- **Rollback on the first deploy.** With no newer previous release yet, `--rollback` now falls
  back to the pre-70.1.0 release in `/tmp/dana-apps.v0.1`.

## 70.1.0 (2026-10-28)

The first release with a single version number. Earlier builds were labelled V68.x to
V70.0.8R61R23 in comments and patch folders, while `package.json` said `0.0.0` and the UI said
`v1.0.0`.

### Do these in production

1. **Check for test accounts.** Earlier test scripts created `admin@gearapps.local` and
   `e2e.admin@gearapps.local` (role admin) and `test@gearapps.local` with passwords published in
   this repository, in whatever database `.env` pointed at. The development `.env` in the upload
   points at `DATABASE_HOST=usftwvmdocker`, the Docker host. Run this against production:
   `SELECT email, role, active FROM users WHERE email ILIKE '%@gearapps.local';`
   Disable or delete any rows it returns.
2. **Rotate the JWT secrets** if the production `.env` uses the template placeholders or anything
   under 32 random characters. The deploy script checks this for you and stops if they are weak.
   Rotating signs everyone out once.
3. **Use `Deploy-GearApps.cmd` from now on.** The first run moves the release from
   `/tmp/dana-apps.v0.1` to `~/dana-apps` and carries the `.env` over.
4. **After deploying**, run `npm run db:check-drift` against production (read-only).

### Fixed

- **Startup deadlock.** Three startup schema routines (master data, workflow journal, Green Shed
  shift counts) ran in parallel under separate locks and could deadlock on `cutter_builds`. They now
  take one shared lock first. In a stress test the old code deadlocked 2 times in 40 runs; the new
  code ran 190 times with none.
- **Generic pull reasons came back on every restart.** The base-data import deletes DULL, DAMAGED,
  CHANGEOVER, QUALITY and OTHER in favour of Dana's `PCR_*` reasons, but the API re-created them on
  every start, so operators saw both sets. Startup now seeds them only into an empty table. Rows
  that are not referenced by cutter history disappear at the next base-data import, which runs on
  every `compose up`.
- **Changeover shortcut.** Running Machines → *Changeover* asked for the code `CHANGEOVER`. Without
  that generic row the Pull page fell back to the first reason in the list, a teardown reason. It
  now selects the configured return-to-shelf reason (e.g. `PCR_002`).
- **Strict type errors** in `workflow-reversal.ts` (40) and the asset-tag service (3). These stopped
  11 server libraries from compiling under their own strict settings and stopped most server unit
  tests from running. Runtime behaviour is unchanged.
- **Intake:** after a tray scan the cursor goes to the first field that still needs input (Summary,
  Part Type, then Quantity), including after each batch.
- **Internal Movement:** the confirmation shows the tray's Summary, Part Type and blade count again.
- **Green Shed Setup** uses the shared workflow layout like Pull and Check. All bindings are unchanged.
- **Garbled characters:** `Empty â€” Available` on Cutter Teardown and the `â€¢` bullet in the Running
  Machines footer.
- The Running Machines table had two `class` attributes; the dead one was removed (compiled output
  unchanged).

### Added

- `GEAR_APPS_VERSION`, shown in all three sidebars, Swagger and `GET /api/v1/health/live`;
  `npm run version:set` and `npm run test:version`. Docker images are tagged with the version.
- `Deploy-GearApps.cmd` / `tools/deploy/deploy-remote.mjs`: backup before deploy, release kept for
  `--rollback`, `--check` preflight, refuses weak secrets and test-account opt-in, verifies the
  deployed version. It replaces `Dana-Apps-Native-Remote-Deploy.cmd`, now in `tools/retired/`.
- `npm run db:check-drift`: a read-only comparison of the entities with a live database. Two
  indexes created at startup are now declared on the entities, so a fresh install has zero drift.
- `npm run test:workflow`: a cross-platform 23-call end-to-end test. Fixtures now create numbered
  E2E shelves (`-990`), the rough shelf and an E2E Cutter Builder machine.
- `GEAR_APPS_ALLOW_TEST_ACCOUNTS=YES` opt-in for the fixture scripts. The API warns at startup about
  placeholder or short JWT secrets.

### Changed

- Read-side queries moved out of the three largest services into `cutter-build.queries.ts`,
  `greenshed.queries.ts` and `tray.queries.ts`. The services delegate to them. All 50 read endpoints
  returned identical data before and after on a live database.
- `greenshed-running-machines.css` (1,144 lines) was split at its section markers into four files
  that load in the same order. The resolved CSS is identical.
- Tests: 17 contract tests that had drifted from the code were updated. Brittle exact-count and
  file-hash checks now assert the real rule. The R37 harness was retired. Server unit-test mocks and
  build-number expectations were fixed.
- Root clean-up: reports, old manifests and deploy logs moved to `docs/history/`. Generated test
  output is no longer shipped. `.dockerignore` was rewritten for this project (it was copied from
  Truck Log). `pagination.contants.ts` was renamed to `pagination.constants.ts`.

### Known follow-ups

- `tools/test-full-workflow.ps1` (PowerShell master suite) still uses per-summary Cuttergrind shelves
  and has no coater shipment or Cutter Builder machine steps. Use `npm run test:workflow` until it is
  updated.
- Four tables (three on Coater Shipments, one on the Blade Tracking dashboard) don't use the shared
  `danaTable`. They are listed as exceptions in the test, and should be moved only after checking
  screen and print output.
- `frontend-feature-admin-users.component` (1,005 lines TS, 831 HTML) should be split into
  per-tab components.
- Frontend Jest specs and the Angular production build were not run in this review: the review
  machine could not install the Linux build tools. The Angular template compiler (`ngc`) was run
  on all three apps and reports no errors.
