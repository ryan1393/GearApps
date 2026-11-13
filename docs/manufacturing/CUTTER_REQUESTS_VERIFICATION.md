# Cutter Requests restoration verification

Verified on 2026-11-12 against the current GearApps checkout, local PostgreSQL and
production frontend/API builds. The production database and deployment were not
accessed. Historical behavior is based on the user's recovered source excerpts; see
[rules and deployment instructions](CUTTER_REQUESTS.md).

## Diagnosis and integrated changes

The baseline lacked the request component, routes, menus, request API, schema and
assembly integration. Neither historical request table existed in the inspected local
development database. This was a missing feature across the modules, rather than a
navigation-only defect. Available repository history did not contain D2/E5 sources.

Both restored routes share one quantity-based queue and API. Fulfillment runs in the
successful assembly transaction; eligible creation voids append compensating history
in the physical reversal transaction. A unique allocation ledger, pair/build/request
locks, distinct history counts and consistency checks address the recovered duplicate
and reversal gaps. Existing physical validation and department guards remain in place.

## Executed checks

| Check | Result |
| --- | --- |
| `npm run test:versions` | Passed: pinned workspace versions and single dependency authority |
| `npm test` | Passed: all 50 Nx test targets, followed by deployment tests |
| `npm run lint` | Passed: all 58 targets; existing warnings remain |
| `npm run build` | Passed: all 7 production build targets |
| `npm run test:contracts` | Passed: all 83 source contracts |
| Final affected-project lint/test/build run | Passed: 21 tasks, followed by the final frontend render regression tests and both rebuilt clients |
| PostgreSQL historical-schema migration suite | Passed: 19 preservation/rollback checks in its own disposable database |
| Live API and Chromium acceptance suite | Passed: 37 named checks, 153 API calls across the final API run and browser retry |
| Persistence after actual API restart | Passed: all 13 request/history snapshots, counts, statuses, notes and linked Build IDs retained |
| Final Cutter Builder frontend tests | Passed: 40 tests, including real-template DOM identity stability |
| Final allocation/reversal helper tests | Passed: 17 tests |
| Request API/DTO service tests | Passed within 26 Cutter Builder server tests |
| `git diff --check` | Passed |

The additional scripts are Nx targets `manufacturing-tools:test-cutter-requests` and
`manufacturing-tools:test-cutter-request-migration`. The API suite requires explicit
test-account opt-in and local test/cloud-development database/API configuration. It
leaves synthetic physical inventory and audit records for inspection, closes its test
demand and disables its temporary accounts/roles. No production data reset was run.

## Acceptance coverage

| Requirement | Evidence and result |
| --- | --- |
| Both menus and direct routes | Passed in Chromium for Cutter Builder and Greenshed, including browser refresh |
| Existing role restrictions | Passed: unauthenticated API rejection, read-only custom role rejection of both mutations, hidden controls, and denied direct pages with no queue fetch |
| Valid requests and attribution | Passed via API and rendered form; quantities, notes, actor and original requester/time survive merges |
| Refresh and application restart | Passed: both browser routes refresh; all 13 saved API/database snapshots survive API restart |
| Invalid quantities and references | Passed: zero, negative, fractional, string, null and over-limit quantities; absent/disabled/incompatible references; invalid Part Type |
| Quantity is cutters, independent of blades | Passed through genuine opening inventory and physical cutter assembly |
| Two-field matching | Passed: wrong Part Type and wrong Summary requests remain unfulfilled |
| Partial counts and linked Build IDs | Passed: Quantity 3 / Built 1 / Remaining 2, UUID and build-number evidence |
| In Progress before first build | Passed: matching loaded tray gives Built 0; disabling that tray restores Requested when no build is linked |
| Automatic Ready | Passed after final qualifying assembly, with no manual Complete needed |
| Manual Complete | Passed: Ready-only browser action; recovered API can close partial demand without changing quantities or `completed_at`; terminal requests cannot reopen |
| Manual Cancel | Passed after partial fulfillment and Ready; preserves build evidence and physical inventory |
| Eligible build reversal | Passed: one compensating event, restored remaining quantity, retained original history, later notes/additions and terminal status |
| Ordinary cutter lifecycle | Passed: genuine setup, pull and teardown preserve fulfillment; existing protection blocks undo of creation after later operations |
| Duplicate processing | Passed: repeated saves/build attempts, repeated/concurrent allocation callbacks, retained duplicate old history counted once |
| Concurrent last-unit allocation | Passed with two genuine assemblies: one claim, no overfill, other build completes unmatched |
| Failed/incomplete builds | Passed: failed assembly and absent authoritative build event do not allocate |
| FIFO and quantity merging | Passed: oldest open request receives supply; zero-remaining Ready rows are not reused; cumulative quantity can exceed 99 |
| No historical backfill | Passed: an unmatched completion remains unmatched on replay after a new request is created |
| Historical row/link preservation | Passed with old table OIDs, notes, actors, timestamps and duplicate history preserved; conflicting ownership flagged; migration rerun stable |
| Known D2 wrong foreign key | Passed: safe correction to `public.part_types`; unmappable IDs and incompatible column types roll back without losing rows |

## Defects found and resolved during verification

Live merging exposed TypeORM's raw `UPDATE RETURNING` result shape. Mutation queries
now return rows through a SELECT CTE so attribution/history receive the actual request
ID and guarded updates detect zero affected rows correctly.

The populated browser queue exposed a render loop caused by fresh build-link object
identities feeding the shared table's DOM observer. Cached projections and stable
tracking keys fix it; the real-template regression and both browser pages pass.

No unresolved application test failure remains. Early browser retries also corrected
test selectors and an unsupported test assumption: the baseline does not journal
teardown as a separately undoable Cutter Builder operation.

## Limits and deployment

The checked physical workflow uses synthetic local fixtures and the existing test
suite; this does not verify every production machine or physical scanner/printer.
Original archive hashes, actual production accounts/schema and surviving production
records were not independently inspected.

Deployment was not performed. Existing `.env`, dependency files, configuration and
baseline application data were preserved. Normal API startup applies the additive
migration; take a verified database backup and follow [deployment instructions](CUTTER_REQUESTS.md#database-preservation-and-deployment).
Previously voided legacy builds without compensation are not retroactively reconciled;
their original evidence remains available for review.
