# Truck Log Maintainability Guide

Truck Log is maintained as one clean source tree. Historical patch chains are not part of the architecture. A change belongs in the canonical source module, its contract tests, and the release package.

## Design rules

1. **Keep composition roots thin.** Angular and Nest application projects wire Nx libraries together; business logic belongs in focused feature/domain/infrastructure projects.
2. **Keep workflow authority on the server.** Browser validation improves operator feedback, but database/API validation remains authoritative.
3. **Keep transaction boundaries visible.** Visit workflow, RXO association, document versioning, and print-state transitions must not be split in ways that hide a transaction or row lock.
4. **Separate I/O from pure transformation.** Parsing, presentation formatting, request mapping, and validation should be testable without a database/browser when practical.
5. **Comment invariants and reasons, not syntax.** A useful comment explains why a lock, grace period, idempotency rule, containment check, or fallback exists. Avoid comments that merely restate the next line.
6. **Do not create a new patch layer.** Update the source and tests directly, then rebuild the single package.


## Nx project rule

Truck Log uses project boundaries as a maintainability tool, not just folder naming. Every TypeScript library has a `project.json`, `tsconfig.json`, `src/index.ts`, and architecture tags. Cross-project imports use the public `@truck-log/...` aliases. Relative imports must stay inside one project. Browser and server projects never cross-import, and feature projects never depend directly on sibling features. See `docs/truck-log/NX-WORKSPACE.md`.

If two features need the same behavior, extract the shared behavior downward into `domain`, `data-access`, `auth`, `infrastructure`, or `ui` rather than introducing a feature-to-feature dependency.

## Current feature boundaries

### Check-In

- `check-in.component.ts` — operator state, API calls, polling and submit orchestration.
- `check-in.component.html` — presentation and Angular bindings.
- `domain/check-in-form.ts` — defaults, request shaping, and reusable form-domain logic.

The component should not regain a large inline template. Server-side workflow validation must not be moved into the browser.

### Truck visits

- `truck-visits.service.ts` — transactional visit/workflow orchestration.
- `truck-visit-slip.renderer.ts` — printable driver-slip rendering.
- packing-slip helpers — extraction, scan handling, supersession, and document-specific behavior.

When adding a workflow action, keep its row lock, state validation, state write, and audit write in one obvious transaction.

### RXO documents

- `rxo-documents.service.ts` — ownership, versioning, association and audit orchestration.
- `rxo-document-pdf-validation.ts` — bounded PDF byte/content validation.
- `rxo-document-orphan-reconciler.ts` — crash-window orphan cleanup and descriptor-safe traversal.
- `rxo-document-lock.ts` — canonical shipment-scoped locking identity.

Filesystem cleanup deliberately has a 24-hour grace and database references always win. Do not replace descriptor-anchored `O_NOFOLLOW` checks with raw path deletion.

### Driver printing

- `driver-print.service.ts` — package/retry/reprint orchestration.
- `driver-print-agent.operations.ts` — Print Agent claim/download/result protocol.
- `driver-print.store.ts` — shared persistence/configuration/summaries.
- `driver-print.types.ts` / `driver-print.utils.ts` — internal types and small pure helpers.

New Print Agent wire/protocol behavior should normally go into `driver-print-agent.operations.ts`, not back into the coordinator.

### RXO ingestion

- `rxo-ingestion.service.ts` — import orchestration and database writes.
- `rxo-snapshot-reader.ts` — boundary/workbook parsing and normalization.
- `rxo-data-page.query.ts` — paged query construction and result shaping.

### RXO Expedite

- `rxo-expedite.module.ts` — Nest composition only.
- `rxo-expedite.controller.ts` — HTTP boundary.
- `rxo-expedite.service.ts` — runtime/PostgreSQL coordination.
- `rxo-expedite.types.ts` — local input shapes.

Standard RXO and Expedite remain operationally independent. An Expedite problem must not disable standard RXO or manual Truck Log check-in.

### Standard RXO exporter

The standard worker follows the Nx application shape: executable entry points stay in `apps/rxo-integration/src`, while reusable implementation lives in `src/lib`. The exporter is split into workflow, runtime, workbook/data, publication, overlay, panel discovery, low-level filter input, option selection, and thin filter orchestration modules. `rxo-filter-test.mjs` intentionally runs the same production filtering implementation instead of carrying a second copy.

The filter orchestrator must stay thin: DOM input mechanics belong in `rxo-filter-input.mjs`, option/evidence rules belong in `rxo-filter-selection.mjs`, and latest-output promotion/verification belongs in `rxo-export-publication.mjs`. The strict maintainability audit checks these boundaries so future edits do not rebuild the former monolith.

`apps/rxo-integration/src/lib/rxo-auth.mjs` and `apps/rxo-expedite/src/lib/rxo-auth.mjs` are the one deliberate exact source duplicate. The workers currently have isolated Docker build contexts, so the helper is kept byte-identical in both. If Docker contexts are unified later, this should become one shared module.

### Database tooling

Migrations 004, 005, 006, 007, 008 and 010 use `tools/truck-log/database-tooling.mjs` for:

- environment/port validation;
- PostgreSQL connection behavior;
- `--preflight` parsing;
- transaction begin/rollback/commit;
- lock and statement timeouts;
- advisory locking;
- verify-before-commit semantics.

Feature migration wrappers should keep only feature-specific schema assertions, SQL safety checks, locks, and messages. Migration 009 remains specialized because its checksum/upgrade behavior is different.

### UI styles (Dana UI)

All visual styling comes from `@dana/ui` (Dana UI), shared with Gear Apps: colors, fonts, shadows, buttons, tables, panels, dialogs, toasts, the sign-in page and the TV wall display. Screens are built from Dana UI components and classes (`dana-panel`, `dana-page-header`, `dana-table`, `dana-btn`, `<dana-combobox>`, `dana-wall`, ...). Truck Log's own CSS (`libs/truck-log/web/styles/src/styles/truck-log.css` and the area files it imports) holds layout only: grids, ordering and spacing for one screen. Components declare no styles. A new look or shared component goes into Dana UI so both apps get it. Dana UI is installed from `vendor/dana-ui/dana-ui-<version>.tgz`; after re-vendoring, run `npm install` so `package-lock.json` matches (`npm run test:vendored-dana-ui` checks this).

## Commenting standard

Add documentation where a maintainer would otherwise need to reconstruct intent. Good targets include:

- public service/class responsibility and what it intentionally does **not** own;
- database transaction/locking invariants;
- security or filesystem containment assumptions;
- idempotency and retry semantics;
- race-condition grace windows;
- compatibility behavior that looks removable but is required.

Do not add line-by-line narration, disabled code, historical patch commentary, or comments that repeat names such as `// increment count` above `count += 1`.

## Validation before packaging

Run from the source root:

```text
npm run audit:maintainability
npm run test:maintainability
npm run validate:release
npm run validate:all
```

`audit:maintainability` reports the largest active modules and duplicate source. Strict mode is wired into `test:maintainability` so architectural splits do not silently collapse back into giant files.

A real Docker engine is still required for the final image build/start and live health check on a deployment host.

## Refactoring procedure

For a large module:

1. identify one responsibility with a stable input/output boundary;
2. move it without changing behavior;
3. change source-contract tests to inspect the feature boundary rather than demand one physical file;
4. run the narrow tests for that feature;
5. run `validate:release` and `validate:all`;
6. regenerate the release hash manifest and package only after all checks pass.

Avoid broad rewrites that simultaneously change workflow behavior, database schema, and module structure. Smaller responsibility-preserving moves are easier to prove.

## Remaining large modules

The maintainability audit is the source of truth for current size. The largest remaining production modules are primarily RXO browser automation and high-complexity transaction coordinators. They should be split only when a responsibility boundary is clear enough to preserve the existing contracts. File size alone is not sufficient reason to separate transactionally coupled code.
