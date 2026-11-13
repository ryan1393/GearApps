# Truck Log Architecture

## Runtime services

| Service | Responsibility | Persistent storage |
|---|---|---|
| `truck-log-postgres` | PostgreSQL Truck Log database | `truck-log-postgres-data` |
| `truck-log-server` | NestJS API, migrations, document/print/RXO integration endpoints | `truck-log-documents`, `truck-log-rxo-import` |
| `truck-log-web` | Angular operator/admin UI served by nginx | none |
| `rxo-export` | Standard RXO scheduled acquisition | `truck-log-rxo-data`, `truck-log-rxo-state`, `truck-log-rxo-credentials` |
| `rxo-browser` | Optional standard RXO interactive login profile bootstrap | standard RXO state/credential volumes |
| `rxo-expedite-scheduler` | Independent RXO Expedite scheduled acquisition | `truck-log-rxo-expedite-data`, `truck-log-rxo-expedite-state`, credentials |
| `rxo-expedite` | Manual one-shot Expedite troubleshooting profile | Expedite volumes |

All services join the Compose-managed `truck-log` network.

## Source boundaries

### Web

`apps/truck-log` is a thin Angular composition root. Browser code is split into Nx projects under `libs/truck-log/web`: `feature/*` for route/operator capabilities, `data-access` for API access, `domain` for reusable form/domain logic, `ui` for shared presentation, `auth/*` for browser authorization concerns, and `styles` for shared style entry points. Cross-project imports go through each project's `src/index.ts` public API.

### API

`apps/truck-log-server` is a thin NestJS shell that imports only `@truck-log/server/core`. Server implementation is split into Nx `auth/*`, `data-access`, `domain/*`, `infrastructure/*`, and `feature/*` projects under `libs/truck-log/server`. Shared browser/API contracts live in `libs/truck-log/shared/contracts`. Feature-to-feature imports are forbidden; shared business behavior is extracted into a domain or infrastructure project.

### Database

Schema ownership is explicit SQL under `database/truck-log`. Automatic TypeORM synchronization is forbidden for the deployed baseline.

### RXO

Standard RXO and RXO Expedite are intentionally separate applications. They may share high-level operational concepts, but their scheduler, acquisition, state, and credential semantics are independent.


## Nx workspace boundaries

The canonical project map, dependency direction, public API rules, tags, and instructions for adding projects are documented in `docs/truck-log/NX-WORKSPACE.md`. `tools/truck-log/test-nx-project-boundaries.mjs` is a release gate: every TypeScript source file must be owned by an Nx project, cross-project relative/deep imports are rejected, and web/server and feature-to-feature dependencies are prevented.

## Refactored source boundaries

The original high-churn files have been split by responsibility while preserving their existing public API and workflow contracts.


### Check-In

- `check-in.component.ts` owns operator state, API calls, polling, validation state, and submit orchestration.
- `check-in.component.html` owns the Angular presentation.
- `domain/check-in-form.ts` owns reusable defaults and request shaping.

### RXO documents

- `rxo-documents.service.ts` owns ownership/version/association transactions.
- `rxo-document-pdf-validation.ts` owns bounded PDF validation.
- `rxo-document-orphan-reconciler.ts` owns crash-window orphan cleanup and descriptor-safe traversal.

### RXO Expedite

- `rxo-expedite.module.ts` is the thin Nest composition root.
- `rxo-expedite.controller.ts` owns the HTTP boundary.
- `rxo-expedite.service.ts` owns runtime and PostgreSQL coordination.
- `rxo-expedite.types.ts` owns local input shapes.

### Database migration tooling

`tools/truck-log/database-tooling.mjs` centralizes connection, preflight, transaction, timeout, advisory-lock, rollback, and verify-before-commit behavior for the standard additive migration wrappers. Feature wrappers retain feature-specific schema checks.

### Truck visits

- `truck-visits.service.ts` owns visit/workflow orchestration and persistence.
- `truck-visit-slip.renderer.ts` owns the printable driver-slip document rendering.

### RXO ingestion

- `rxo-ingestion.service.ts` owns import orchestration, database writes, synchronization, and feature coordination.
- `rxo-snapshot-reader.ts` owns RXO boundary/workbook parsing and row normalization.
- `rxo-data-page.query.ts` owns paged RXO data queries, active-window predicates, and response shaping.

### Driver printing

- `driver-print.service.ts` owns package/retry/reprint orchestration.
- `driver-print.store.ts` owns bounded configuration, database/storage helpers, summaries, and common persistence operations.
- `driver-print-agent.operations.ts` owns Print Agent claim/download/result and lease operations; `driver-print-agent-results.ts` writes a verified result.
- `print-agent-late-result.ts` decides what a Print Agent result does, for both the automatic and the legacy path.

#### Print results and leases

- A job is leased to the Print Agent for a fixed time. When the lease expires without a result, the lease monitor marks the item FAILED with an "uncertain" error: nobody knows whether the paper came out. The guard checks the printer and retries explicitly; nothing reprints automatically.
- The Print Agent (4.0.7+) keeps finished results in a durable outbox and re-sends each with the same `X-Idempotency-Key` and body until the server confirms. A result can therefore arrive after its lease expired.
- Such a result is recorded as reported when it is **in time**: the claim token still matches the job, and `leased_at - 5 min <= submittedAt <= lease_expires_at + 5 min`. If the item is still LEASED, it is recorded normally. If the lease monitor already marked it uncertain, the agent's PRINTED (or FAILED with its error) replaces that failure once, with guarded single-row updates. The visit history records `..._LATE_RESULT`, and the attempt is flagged `lateResult`.
- Anything else is unchanged. An out-of-time result leaves or makes the item FAILED and uncertain. A FAILED reported by the agent or written by a person is never overwritten, and PRINTED is never downgraded. A key reused with a different body is rejected, and a replay returns the stored response.
- A guard retry clears the lease token, so a late result for the old attempt fails the claim check and is rejected. The retry wins.
- Migration `0003_late_print_agent_results.sql` lets the history triggers allow this single transition from the lease monitor's marker.
- `driver-print.types.ts` and `driver-print.utils.ts` contain shared internal types and small pure helpers.

#### Packing-slip watcher routes

The SAP capture queue watcher on the print PC takes its eight route settings from Truck Log. Its `watcher.ini` keeps only machine-local things: folders, timings, Sumatra, OCR and the `[truck_log]` connection. The shared contract (types and validation) is `libs/truck-log/shared/contracts/src/packing-slip-routes.ts`.

- **Per route (1-8):** name, SAP capture queue (`sourceQueue`), output printer (UNC path such as `\\USFTWPLVPS03\USFTWP_DGL_Ricoh`), mode and Upload to Truck Log (`uploadEnabled`).
- **Modes:** `OFF` ignores the route. `TEST` verifies and files each slip and uploads it when Upload is on, but never prints. `LIVE` does the same and also prints verified slips on the output printer. Unverified slips are never printed.
- **Watcher:** `GET /api/v1/print-agents/packing-slip-routes` uses the packing-slip upload credential (scope `documents:upload`). It returns `{version, updatedAt, updatedBy, routes}` with `ETag: "<version>"` and answers `If-None-Match` with 304.
- **Webpage:** Administration > Printing > Packing slip watcher uses `GET/PUT /api/v1/admin/packing-slip-routes`. Anyone at a paired station sees the routes read-only; saving needs an administrator (session and CSRF, like the other admin writes). The PUT sends `{version, routes, confirmLive}`. A stale `version` gets 409. Routes newly switched to LIVE must be listed exactly in `confirmLive`, otherwise 400. The webpage asks for that confirmation in a dialog that names the routes and printers.
- **Rules (server, webpage and watcher):** name 1-60 characters; SAP capture queue 1-120 characters and unique (ignoring case) across routes that are not OFF; output printer a UNC queue path, required for LIVE; no control characters.
- **Audit:** every saved change bumps the version and adds a row to `packing_slip_watcher_route_audit` (who, when, versions, routes confirmed LIVE, before → after per field). The table is append-only. A save with no changes keeps the version.
- Migration `0004_packing_slip_watcher_routes.sql` creates the tables. It seeds today's `watcher.ini` routes, all TEST with upload off. An administrator switches DGL (route 8) to LIVE when ready.
- Code: `packing-slip-routes.service.ts` and `packing-slip-routes-admin.controller.ts` in the print-agents feature; `packing-slip-watcher.component.ts` in the admin web feature.

### RXO Control Center

- `rxo-control-center.component.ts` owns Angular state and user actions.
- `rxo-control-center.component.html` owns the template.
- `rxo-control-center.component.css` owns component-local presentation.
- `rxo-control-center.presenter.ts` owns pure display/status/time formatting helpers.

### Standard RXO exporter

- `src/rxo-fort-wayne-export.mjs` owns the end-to-end export workflow and coordinates the focused modules under `src/lib`.
- `src/lib/rxo-export-runtime.mjs` owns filesystem/runtime primitives.
- `src/lib/rxo-export-data.mjs` owns workbook/date-window/data transformation helpers.
- `src/lib/rxo-export-publication.mjs` owns promotion to `/data/latest` and post-publish integrity verification.
- `src/lib/rxo-overlay-ui.mjs` owns Angular/CDK overlay dismissal.
- `src/lib/rxo-filter-common.mjs` owns immutable Fort Wayne identifiers plus small screenshot/DOM helpers.
- `src/lib/rxo-filter-panel.mjs` owns filter-control discovery/opening and diagnostics.
- `src/lib/rxo-filter-input.mjs` owns low-level search/input/button interaction inside an opened panel.
- `src/lib/rxo-filter-selection.mjs` owns option matching, click behavior, selected-count evidence, and selection diagnostics.
- `src/lib/rxo-filter-ui.mjs` is now the thin Fort Wayne filter orchestration layer.
- `src/rxo-filter-test.mjs` is a thin harness that executes the same production filter implementation instead of maintaining a duplicate implementation.

### Styling (Dana UI)

All visual styling comes from `@dana/ui` (Dana UI), shared with Gear Apps: colors, fonts, shadows, buttons, tables, panels, dialogs, toasts, the sign-in page and the TV wall display. Screens are built from Dana UI components and classes (`dana-panel`, `dana-page-header`, `dana-table`, `dana-btn`, `<dana-combobox>`, `dana-wall`, ...). Truck Log's own CSS (`libs/truck-log/web/styles/src/styles/truck-log.css` and the area files it imports) holds layout only: grids, ordering and spacing for one screen. Components declare no styles. A new look or shared component goes into Dana UI so both apps get it. Dana UI is installed from `vendor/dana-ui/dana-ui-<version>.tgz`; after re-vendoring, run `npm install` so `package-lock.json` matches (`npm run test:vendored-dana-ui` checks this).

Contract tests use `tools/truck-log/source-contract-utils.mjs` when a feature spans several source files. This keeps tests tied to feature behavior instead of forcing implementations back into a single monolithic file.


## Deliberate duplication

`apps/rxo-integration/src/lib/rxo-auth.mjs` and `apps/rxo-expedite/src/lib/rxo-auth.mjs` remain byte-identical because the two workers currently build from isolated Docker contexts. The maintainability audit allows only this known duplicate.
