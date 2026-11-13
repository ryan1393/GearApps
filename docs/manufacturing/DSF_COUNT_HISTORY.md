# Plant-wide DSF count history

MeshForge can retain production counts from every discovered DSF source, including
the five Cutter Grind sources, named departments and sources without a registered
MeshForge machine link. The separate plant dashboard's **Count history** screen
shows the saved hourly, shift and daily records and exports them to CSV.

This feature records **RUN pieces**. It does not implement downtime, maximum
capacity, production targets, FTT or OEE, and it does not certify parity with the
full DSF shopfloor report. The source schema and unresolved reporting rules remain
in [DSF_DATABASE_REFERENCE.md](DSF_DATABASE_REFERENCE.md) and the
[November 12 capture review](DSF_CAPTURE_20261112_REVIEW.md).

## Collection and storage

Collection extends the existing serialized DSF poll in `meshforge-server`. It
reuses that reader's configured connection, authentication, role policy, TLS,
source identity and clock checks, repeatable-read read-only transaction,
timeouts and shared-reader lease. It adds no DSF connection, background service,
timer, authentication backend or source credentials.

The poll stages the source catalog, bounded hourly totals and dated-shift slices.
The DSF connection is then rolled back and closed. Only after it closes does a
separate local transaction write history to **MeshForge's PostgreSQL database**.
A source read failure or local commit failure does not advance saved progress or
replace an uncaptured period with zero. History has a source savepoint so an
optional archival query error can be rolled back without aborting the existing
machine/cutter-count reads. Cutter crediting remains a separate existing feature.

Counts follow the established rule: join an event's reason-row ID, require that
reason's expected operation, then sum only business reason code `1` RUN
`part_count`. Loss rows and every row with `running = true` are not production.
Wrong-operation reasons, wrong whiteboards, invalid counts and incomplete reads
produce explicit issues instead of accepted counts.

The retained records are aggregate counts and coverage evidence, **not a complete
copy of DSF's individual event archive**. Saved count history is retained
indefinitely; this feature performs no automatic history deletion. Back up the
MeshForge PostgreSQL database to preserve it.

## Source coverage and identities

Discovery uses the DSF base mapping/operation/line/department tables without the
existing current-machine reader's numeric-department filter. Named areas such as
Hard Turn, Shot Peen, Straightener and Thread Draw therefore remain in the history
catalog. Inactive alternatives are retained, and they can have historical records.
The report defaults to current active sources; **Include inactive and earlier
sources** exposes the retained alternatives and earlier identity versions.

A source history key includes the configured source system, mapping, whiteboard,
operation, line and department identities. A changed identity starts a separate
stream and preserves the previous stream's history. A display-name change alone
does not create a new stream. Approved full-identity MeshForge mappings can supply
a physical machine label; the collector never creates or guesses those mappings.
The existing Lapper client exclusion remains in place: this archive records DSF
source operations and does not restore Lapper machine badges, mappings or links.

For a mapping whose identity changes, including a return to an earlier identity,
the archive records when that identity was observed active. It does not backfill
old hours into the new identity or guess the exact transition time. The transition
hour and uncertain earlier windows remain flagged for review; subsequent whole
hours can be captured normally. Existing earlier-stream counts are preserved and
can be viewed with **Include inactive and earlier sources**. An entirely new
mapping with no prior identity can use the normal initial backfill.

Sources sharing an active operation are archived separately and flagged for
review. Their contributions are excluded from report totals so they are not
silently treated as independent physical machines. Source counts do not certify
the plant's physical equipment inventory. Summing sequential operations can count
the same physical part more than once, so a plant subtotal is not finished-goods
output.

## Hourly records, shifts and corrections

Canonical hourly records use UTC boundaries and preserve the exact covered end,
source snapshot time, observation time and count. Current-hour records normally
cover only the elapsed part of the hour. Repeated polls **replace** the covered
window; they do not add successive polling totals. A corrected or deleted source
event is reflected when that complete window is successfully reconciled again.
An older snapshot or shorter read cannot overwrite newer, more complete evidence.

Each hour also keeps exact slices for the actual dated DSF shifts. Shift boundaries
can occur within an hour, cross midnight and span daylight-saving changes. The
reader only normalizes the observed one-second end convention when a real next
shift start proves it. It does not manufacture fixed eight-hour shifts or derive
historical boundaries from the text schedule template. Missing or overlapping
shifts leave unassigned slices: the hourly count can remain known while the shift
attribution requires review.

The canonical hour has a content hash and revision counter. Changes to an already
closed hour also retain before/after count, hash and source-time evidence in the
correction ledger. This supports reviewing source corrections without repeatedly
crediting the same production.

## Initial history, restart and outage behavior

Each successful poll normally checks three distinct UTC hours:

1. The current partial hour.
2. The previous hour, to close it and catch recent changes.
3. One earlier hour from the persisted backfill scan position.

The initial scan begins the configured number of 24-hour days before the current
UTC hour. Seven days represents approximately 168 earlier hourly windows, so it
needs roughly 168 successful scan steps in the best case. At a 60-second poll
interval that is on the order of three hours, with elapsed time, retries and
source/local performance affecting the actual duration. Current and previous
hours are collected while earlier history fills in.

Progress persists in the same transaction as the accepted catalog, counts, slices
and issues. After restart, an earlier saved position is resumed; an outage does
not silently skip it just because it lies before today's rolling lookback. Once
caught up, the scan cycles through the recent lookback to recheck corrections.

The position is **scan progress, not a coverage watermark**. A completed bounded
read may advance past an individual source's invalid evidence while keeping that
source/hour as an explicit issue. Healthy sources can continue. Global row limits,
invalid global accounting and query/commit failures do not advance the affected
scan step. Recent gaps are retried during the rolling scan. An unresolved gap that
has aged outside the configured reconciliation horizon remains visible; it must
not be converted to zero or assumed repaired from the scan position alone.

## Reading reports

Open **Count history** in the plant dashboard, or visit `/history` in that separate
frontend. Choose an inclusive date range, grouping, department and source, then
apply the filters. The source selector includes equipment absent from the
registered-machine catalog. Filters can include inactive and earlier identities.

- Hourly and daily date ranges use calendar dates in
  `America/Indiana/Indianapolis`. UTC storage preserves repeated daylight-saving
  hours; a local day can contain 23 or 25 hourly windows.
- Shift date ranges select the dated shift's local **start date**, including its
  continuation after midnight. This is the existing shift-start convention, not
  a newly inferred DSF business-day policy.
- `COMPLETE` means the requested period has complete accepted coverage; a verified
  empty source window is a real recorded zero. `PARTIAL` identifies a known
  covered portion. `UNKNOWN` is missing coverage. `REVIEW` flags source ambiguity
  or evidence requiring attention. None is a running/stopped machine signal.
- The known subtotal can include verified partial-period counts and excludes
  duplicate/review contributions. A full selected-report total stays unknown
  when coverage or validity is incomplete. Missing counts remain blank in CSV.
- Reports allow at most 31 calendar days and return at most 5,000 rows. A
  truncation flag and the screen warning require narrower date/source filters;
  a limited display is not a complete plant total.

The browser refreshes the saved report/status every 30 seconds while the screen
is open. These reads query MeshForge history only; they do not force DSF reads.
Leaving the screen or signing out destroys its polling and cached state.

## Enable on the MeshForge server

Deploy the rebuilt `meshforge-server` and plant dashboard frontend using the
existing installation process. Keep the dashboard's SPA fallback and `/api`
reverse proxy to MeshForge. This implementation has not, by itself, deployed a
new plant service or established cloud-to-plant connectivity.

In the active MeshForge server configuration, enable:

```dotenv
DSF_COUNT_ENABLED=true
DSF_HISTORY_ENABLED=true
DSF_HISTORY_LOOKBACK_DAYS=7
```

`DSF_COUNT_ENABLED` may already be enabled at the plant. The lookback is optional
and defaults to 7; supported values are 1–31. It controls initial/repeated
reconciliation, not deletion of saved records. Keep the existing validated
`DSF_DB_*` connection settings. No new password, login, database service or
collector token is required. `DSF_CUTTER_WRITE_ENABLED` is independent of history
and is not required for recording counts.

These settings also appear under **Admin → Server Settings → DSF production
counts**. Saved settings are applied at startup, so update the effective server
configuration and restart the MeshForge API. Check the Count history collection
status and coverage dates after the first successful poll. Disabling collection
later does not delete previously recorded history.

## Local schema and read API

All history tables are in the MeshForge application database:

| Table | Purpose |
| --- | --- |
| `dana_dsf_history_source_v1` | Versioned source catalog and identity/review evidence |
| `dana_dsf_history_hour_v1` | Canonical hourly totals, exact coverage and revisions |
| `dana_dsf_history_slice_v1` | Dated-shift and unassigned slices within each hour |
| `dana_dsf_history_state_v1` | Source-system snapshot/failure state and resumable scan position |
| `dana_dsf_history_issue_v1` | Explicit source/time and global-read issues |
| `dana_dsf_history_revision_v1` | Before/after evidence for corrected closed hours |

Startup creates the additive schema only when history is enabled and verifies
that the target has MeshForge's machine table and is not the DSF source. Existing
tables must have the expected columns; a mismatch requires review instead of
destructive replacement. Do not execute the schema helper against `maindblocal`.

All three read endpoints use the existing JWT authentication and ADMIN/USER role
checks, send `Cache-Control: no-store`, and read local storage only:

| Endpoint | Use |
| --- | --- |
| `GET /api/v1/dsf-counts/history/status` | Enablement, failures, saved coverage and scan progress |
| `GET /api/v1/dsf-counts/history/sources?include_inactive=true` | Saved source catalog, including earlier/inactive identities when requested |
| `GET /api/v1/dsf-counts/history?from=2026-11-11&to=2026-11-11&group=hour` | Bounded report; supports `day`, `hour` or `shift`, optional `source_key`, `department_id` and `include_inactive` |

## Bounds and validation

The source catalog is capped at 5,000 entries plus an explicit sentinel. Each
hourly query scans all sources together with a 200,000-raw-row bound and sentinel;
aggregate and shift metadata also have explicit limits. An exceeded limit is an
issue, not a complete result or a zero. Queries preserve operation/reason and
whiteboard scope and retain microsecond timestamp precision.

The existing five-second source statement timeout, shared-reader deadline and
history time budget remain in place. The exported schema does not establish a
time-leading index on the master event partitions. The implementation therefore
avoids one historical scan per machine and makes no DSF index/schema changes.
Actual plant performance and ongoing source retention/correction behavior still
need operational verification on the approved connection.

Relevant verification commands, run from the repository root:

```sh
npx nx test server-feat-greenshed
npx nx test server-util-common
npx nx test plant-dashboard
npx nx run manufacturing-tools:test-dsf-history
npx nx build meshforge-server --configuration=production
npx nx build plant-dashboard --configuration=production
```

The PostgreSQL integration cases use `DSF_HISTORY_TEST_DATABASE_URL` when set and
otherwise skip those optional cases. Supply an explicit disposable **loopback**
PostgreSQL test connection; storage tests create and remove their own synthetic
database, so that local test role must permit it. Source fixtures use temporary
tables. Never use the plant database or production credentials for these tests.
The automated tests establish local behavior, not live deployment or full DSF
report-formula equivalence.
