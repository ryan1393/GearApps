# Cuttergrind Needs / Cutter Requests

The quantity-based request queue is shared by both applications:

| Application | Navigation | Browser route |
| --- | --- | --- |
| Greenshed | Gear Quality → Cutter Requests | `/greenshed/cutter-requests` |
| Cutter Builder | Operations → Cutter Requests | `/cutter-builder/requests` |

Both routes render the same component and use the same API and database records. The
screen shows Part Summary, Part Type, Quantity, Built, Remaining, Status, linked Build
IDs, Notes and requester attribution. It refreshes every 30 seconds while visible and
also has a Refresh action.

## Diagnosis and recovery evidence

The baseline checkout had no request navigation, routes, component, controller methods,
request schema or build-allocation integration. Searches of the available Git history
and retained source archives also found no implementation of `cutter_requests`,
`cutter_request_history` or the historical request screen. The inspected local
development database had neither historical request table. This required restoring the
feature across the existing modules; exposing a hidden link alone could not recover it.
The production database was not inspected.

The historical behavior comes from the user's pasted D2–D2R5/E5 recovery records and
E5 source excerpts. The original release packages were not attached, and their hashes
and contents were not independently verified. Those excerpts establish the later
quantity-based workflow, including tray-derived work in progress, FIFO fulfillment,
request merging and manual status semantics. The allocation ledger, strict evidence
checks and compensating build-void handling described below address safety gaps in the
recovered implementation; they are restoration improvements, not claims about the old
release.

## Request creation and counts

An incoming quantity must be a whole number from 1 to 99 **cutters**. Blade quantities
for assembling each cutter remain governed by the existing blade requirement and build
validation. Existing cutter-body compatibility, handedness, and RING/PINION Inner/Outer
checks remain in the physical build workflow.

The server resolves `part_type_code` to the actual `public.part_types` identity and
requires an enabled, nondeleted Summary, Part Type and matching blade requirement with
a positive required blade count. The screen limits its choices to enabled requirements
and active, enabled summaries. Notes are optional, trimmed, and limited to 2,000
characters. The authenticated user supplies attribution; the client cannot choose it.

For the same Summary and Part Type, creation adds the incoming quantity to the oldest
nonterminal request with Remaining greater than zero. Requested quantity and Remaining
both increase. The original requester and request time remain unchanged; nonblank new
notes replace old notes, while blank notes preserve them. Each incoming addition is
limited to 99; the merged total may exceed 99 within the database integer limit. If
there is no eligible existing request, creation inserts a new one. History records
`CREATED` or `QUANTITY_ADDED` with the actor and quantity delta.

Built is the count of distinct linked build UUIDs recorded by `AUTO_FULFILLED` history
and joined to existing build records, excluding links compensated by
`AUTO_FULFILLMENT_REVERSED`. It is not calculated as Quantity minus Remaining. Repeated
old history events for one build count once, and Build IDs come from this same evidence.
The screen flags inconsistent legacy counts rather than silently rewriting them; such
records are not eligible for automatic allocation or quantity merging until reviewed.

## Status and manual actions

The list returns the stored status as `stored_status` and a computed display status as
`status`. Reading or refreshing the list does not update records or create history.

| Display status | Rule |
| --- | --- |
| Requested | Nonterminal, no linked completed build, and no matching nonempty tray |
| In Progress | Nonterminal, with a linked build or a matching enabled, nondeleted tray whose blade count is greater than zero |
| Ready | Nonterminal, Remaining is zero and distinct Built equals the positive requested quantity |
| Completed | Stored status is `COMPLETED` |
| Canceled | Stored status is `CANCELED` |

Tray matching uses both Summary UUID and Part Type UUID. This is the recovered
start-of-work condition: In Progress can precede the first completed cutter. It is a
derived tray condition, with no new Start button, reservation or assignment event.

Automatic fulfillment makes a fully supplied request Ready without a Complete click.
The screen offers Complete when the displayed request is Ready, and Cancel for any
nonterminal request, including one that is partially supplied or Ready. Both actions
require confirmation.

The recovered status API is deliberately broader than those screen buttons: an
authorized caller may set any supported status on any nonterminal request. A stored
Completed or Canceled request cannot subsequently be changed or reopened through this
API. A manually stored nonterminal status does not override the evidence-based display
rules; for example, setting `READY` cannot make an unfulfilled request display Ready.

Manual Complete and Cancel update only status, update attribution/time and
`STATUS_CHANGED` history. They do not change requested quantity, Remaining,
`completed_at`, existing build links, physical cutters, blade inventory or teardown.
Manual Complete has no inferred pickup, delivery or machine-setup meaning. An API
caller can therefore manually close a partially fulfilled request with Remaining still
positive. Automatic Ready retains the recovered `completed_at = NULL` behavior.
Completed and Canceled records are hidden by default; Include completed/canceled shows
them with their counts and evidence intact.

## Successful builds, concurrency and reversals

The allocation hook runs inside the existing successful cutter-assembly transaction,
after the physical build and inventory updates and before the workflow journal commits.
It verifies the READY build, `built_at`, nondeleted build event of type `CB`, and both
identity UUIDs. A draft, failed or incomplete operation cannot supply a request. The
build's physical `completed_at` is not an assembly-success marker; the existing cutter
lifecycle uses it for teardown.

One completed cutter supplies one unit to the oldest eligible matching open request,
ordered by request time and then request UUID. A matching Summary with the wrong Part
Type, or the right Part Type with the wrong Summary, cannot supply it. Allocation
decrements Remaining by one, records the Build ID and actor in `AUTO_FULFILLED`, and
sets the stored status to In Progress or Ready as appropriate.

Build-row locks, a transaction-scoped advisory lock for the Summary/Part Type pair,
request-row locks and a primary key on the allocation ledger's build UUID prevent
duplicate claims and over-allocation. There is no `SKIP LOCKED` bypass of an older
request. The existing build transaction uses SERIALIZABLE isolation; a serialization
conflict requires retrying the entire failed build operation. Physical inventory,
allocation, counts and history commit or roll back together.

A successful build with no eligible request still completes. Its ledger entry has no
request owner, so a retry cannot later assign that old build to a newly created request.
Neither request creation nor startup allocates unlinked historical builds.

An eligible Cutter Builder Cancel Last that voids the creation of a linked build now
compensates its allocation in that same reversal transaction. It increments the current
Remaining, marks the ledger entry reversed, and appends
`AUTO_FULFILLMENT_REVERSED`; the original event and build evidence remain in history.
Active Built/Build IDs exclude the compensated link. Completed and Canceled request
statuses and their `completed_at` values remain unchanged; another request returns to
In Progress. The reversal uses current request data rather than restoring an old
request snapshot, preserving later notes, quantity additions and manual closure.

Ordinary cutter use, setup, pull and teardown do not reverse fulfillment. Request
cancellation does not void a build or release/reassign a linked cutter. A reversed
build identity cannot be allocated again. Conflicting historical owners, missing
allocation evidence, or inconsistent request counts block an unsafe build void and
roll back its physical changes for review.

## API and custom roles

These are API routes under the shared `/api/v1` prefix, not the browser routes above:

| Method and path | Body or query | Custom-role grant |
| --- | --- | --- |
| `GET /cutter-builder/requests` | Optional `includeCompleted=true` includes Completed and Canceled | `cutter-builder:listCutterRequests` |
| `POST /cutter-builder/requests` | `{ "summary_id": "<UUID>", "part_type_code": "RING", "quantity": 3, "notes": "Optional" }` | `cutter-builder:createCutterRequest` |
| `PATCH /cutter-builder/requests/<UUID>/status` | `{ "status": "COMPLETED" }` | `cutter-builder:updateCutterRequestStatus` |
| `GET /cutter-config/blade-requirements` | Existing Summary/Part Type form choices | `cutter-config:listRequirements` |

Part Type codes are `RING` or `PINION`; incoming codes are trimmed and uppercased.
Supported status values are `REQUESTED`, `IN_PROGRESS`, `READY`, `COMPLETED`, `CANCELED`.
Invalid UUIDs, quantities, codes, notes and reference pairs are rejected on the server.

Request endpoints retain the recovered signed-in USER/ADMIN access across departments.
They do not apply Cutter Builder's physical-operation department restriction. Assigned
custom roles restrict each API action through the existing shared access guard; an
administrator retains administrator access. Role names such as Team Leader and Cutter
Grind do not grant anything by themselves. Give a reader the list grant, add create
and blade-requirement lookup for a requester, and add status update for someone who
may Complete/Cancel. Both navigation links require list access, and the shared screen
also checks individual action grants.

Build evidence stays visible as text without permission to open its lookup. Following
a Build ID also requires the application's existing department/edit gate and
`cutter-builder:getBuild` or `greenshed:getBuild`. Greenshed's full lookup additionally
loads `greenshed:getHistory`; lookup search requires `cutter-builder:searchBuilds` or
`greenshed:searchBuilds`. These lookup permissions do not grant request mutation rights
or vice versa.

## Database preservation and deployment

The startup migration is `20261112-cutter-requests-restoration-v1`, registered by
`GearMasterDataBootstrap` through the existing transaction, startup lock and
checksum/version migration mechanism. Keep `DATABASE_SYNCHRONIZE=false` for an existing
database. No old host installer is required.

On a database without the feature, the migration creates `public.cutter_requests` and
`public.cutter_request_history` with the recovered UUID, integer, text and timestamp
columns. There is no stored `built_quantity` column. Existing compatible tables and
rows are reused without rewriting notes, attribution, timestamps or history. Missing
or incompatible historical column types stop the migration and roll back its
transaction; there is no guessed conversion.

The known D2 foreign key to `public.cutter_part_types` is corrected only when every
surviving request Part Type UUID resolves in the real `public.part_types`. Otherwise
startup fails without remapping or deleting data. A newly added foreign key on an
existing table uses `NOT VALID` to avoid silently asserting that unrelated legacy
records were audited; fresh tables have normal foreign keys.

The additive `public.cutter_request_build_allocations` ledger enforces one claim per
build. Startup imports only surviving `AUTO_FULFILLED` associations, deduplicating the
claim while preserving all original history rows. If one historical build is linked
to multiple requests, the ledger records `legacy_conflict = true` with no guessed
owner. Existing claims are never overwritten on rerun. Arbitrary historical builds
are not backfilled into requests.

The queue also flags conflicting historical owners for review. Previously voided
builds whose old fulfillment was never compensated retain their historical links and
counts; startup does not guess or retroactively repair that evidence. Review those
legacy cases against their physical cancellation history before operational use.

Before deployment, take and verify a backup of the existing database and preserve the
existing root `.env`, credentials, secrets, PostgreSQL volume and deployment
configuration. Follow the [unified API upgrade procedure](../UNIFIED_API.md) using the
current application source. Normal API startup applies the additive migration. Check
startup/health and both request routes, review the role grants above, and compare
surviving records and build links against the backup before operational use. No
production migration or production validation is claimed by this restoration report.

**Operational reset classification:** requests, request history and allocation claims
are operational records. The explicit, backup-first `clear-operational-data` floor
reset empties all three request tables along with cutter builds and workflow history.
This destructive maintenance action is separate from deploying, restarting, or
canceling a request. Normal deployment and request cancellation preserve these rows.

## Validation commands

Run the normal repository checks from the root with the pinned Node/npm versions:

```sh
npm run test:versions
npm test
npm run test:contracts
npm run lint
npm run build
```

For the additional live checks, use an authorized local disposable database or restore
whose name contains the `test` or `cloud_dev` marker. The API acceptance tool also
requires a loopback database/API host and refuses production runs. Start the shared
API and Cutter Builder/Greenshed clients, provide the test administrator password in
`SEED_ADMIN_PASSWORD` (or `MESHFORGE_ADMIN_PASSWORD`), then run:

```sh
MESHFORGE_ALLOW_TEST_ACCOUNTS=YES npx nx run manufacturing-tools:test-cutter-request-migration
MESHFORGE_ALLOW_TEST_ACCOUNTS=YES npx nx run manufacturing-tools:test-cutter-requests
# Restart the local API, then verify the saved request/history snapshots:
MESHFORGE_ALLOW_TEST_ACCOUNTS=YES node --env-file=.env tools/manufacturing/test-cutter-requests.mjs --verify-restart
```

The migration test creates its own disposable database and drops only that database.
It checks historical table/row preservation, the D2 foreign-key correction, duplicate
and conflicting old links, repeated application and rollback on incompatible/orphaned
legacy data. Its database account needs permission to create that test database.

The API/browser suite exercises validation, attribution, permissions, matching,
quantity merging, tray-derived work in progress, partial/full fulfillment, FIFO,
manual actions, repeated/concurrent processing, build-void compensation and unaffected
physical workflows. It creates synthetic local test summaries, trays, inventory,
cutters, requests, accounts and roles. It attempts to cancel open test requests and
disable test accounts/roles afterward; operational records and audit evidence remain
for inspection. Its JSON report is written to
`tmp/cutter-request-integration-result.json` and reused by the restart check.

The API defaults to `http://127.0.0.1:3333/api/v1`; override it with
`MESHFORGE_BASE_URL`. Browser defaults are Cutter Builder on port 4201 and Greenshed on
4202; use `MESHFORGE_CUTTER_WEB_URL` and `MESHFORGE_GREENSHED_WEB_URL` to override them.
Chromium defaults to `/usr/bin/chromium`, overridden by `CHROMIUM_PATH`. These commands
describe repeatable checks, not a claim that every environment or physical shop-floor
device has been verified; the delivery report records actual run results.
