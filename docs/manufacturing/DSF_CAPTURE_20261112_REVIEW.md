# Review of the November 12 DSF capture

Evidence: `DSF-capture-20261112-180430-040.txt`, 1,623,474 bytes.
SHA-256: `0c9de0cc5f0d0a88819f3daafc859b43a8687ccd0a6b5bf120cf64a6b6d420a0`.
The database snapshot was taken November 12, 2026, at 18:04:35 Indianapolis time
(`2026-11-12T23:04:35.958206Z`). The requested historical report is November 11,
15:00–23:00, with a cutoff of 21:56:23 in
`America/Indiana/Indianapolis`. Later source corrections can differ from the
original screen. Raw records and private analysis remain outside Git.

Read this with [DSF_DATABASE_REFERENCE.md](DSF_DATABASE_REFERENCE.md) and
[DSF_CAPTURE_PLAN.md](DSF_CAPTURE_PLAN.md). Structural facts below are confirmed
by this capture; derived counts follow the existing reader rule and do not by
themselves certify the source application's reporting formulas.

## Capture integrity

The capture completed successfully. No repeat is needed for an export failure.

| Check | Result |
| --- | --- |
| Database/server | `maindblocal`, PostgreSQL 16.10 |
| Transaction evidence | `repeatable read`, `transaction_read_only = on`, explicit `ROLLBACK` |
| JSON objects | 320: one header, 312 dataset manifests, six source validations, one completion record |
| Planned manifests | All 312 unique dataset/source combinations present; header and completion plans agree |
| Result status | All 312 `complete`; zero truncated, unavailable-schema or failed-identity datasets |
| Row accounting | Each manifest's returned/observed count matches its record array |
| Source identity | All five active Cutter Grind sources and `181 - 1` validated |
| Nested records | 6,000 across the declared datasets, including metadata and boundary context |
| Scope | Whole-plant source inventory; detailed history for six selected sources, not all plant history |

`complete` describes the rows selected by each declared query. It does not prove
physical-machine completeness, undiscovered dependencies, a historical version
of current configuration, or official metric formulas. Empty sections were
successfully queried; they were not omitted or silently replaced with zero.

## Source and machine coverage

The refreshed inventory confirms the earlier discovery:

- 163 source mappings; 117 with both mapping and whiteboard active; 116 distinct
  active operations. These are not certified physical-machine counts.
- 33 departments, 147 lines and 310 operations in the base inventories.
- Five active Cutter Grind sources: CutGrind 6/4/3/7/5, corresponding to asset
  labels 1-24-77 through 1-24-81. The legacy CutGrind 77 alias remains inactive
  and shares CutGrind 6's operation/line.
- The five other named areas retain 22 active mappings: Hard Turn (Pinions),
  Hard Turn (Rings), Shot Peen, Straightener and Thread Draw. The default reader's
  numeric department discovery still needs approved alias/coverage treatment.
- Both active PIN cutter 550 and 551 mappings still reference one operation.
  They cannot be presumed two physical machines or independently summed.
- All 163 mapping operation-to-line comparisons match in this snapshot.

The sample MeshForge machine catalog still requires physical-asset reconciliation.
Neither this source inventory nor the five source validations establish that all
physical plant machines are registered and correctly linked in MeshForge.

## Confirmed schema relationships and history storage

The capture contains 310 column definitions, 98 constraints, 74 indexes, three
selected view definitions and partition/inheritance metadata. Foreign keys now
confirm the important identifier relationships that were previously established
only by reader code or small samples:

- Whiteboard mapping to whiteboard, operation and line; operation to line; line
  to department, area, cell and location.
- Event `machine_id` to the DSF whiteboard-mapping ID and event `code` to the
  operation-reason row ID. The reason's business `code` remains a separate field.
- Operation/line state `code` to their respective reason-row IDs, and rework
  `reason` to the appropriate operation/line dictionary.
- Operation and line cycle-time `rated_speed` to the corresponding rate-history
  row's integer `id`; the numerical rate is a different value in that row.

These foreign keys do not enforce every reporting invariant. In particular, a
reason-ID foreign key does not prove that a reason belongs to the event's expected
operation, nor does separate mapping FKs enforce operation-to-line agreement.
Keep the existing scoped joins and runtime identity checks.

`tbl_whiteboard_cycles_master` is a partitioned table with primary key
`(id, timestamp)`. The `tbl_whiteboard_cycles` view selects directly from that
master. The current/old cycle objects are separate ordinary tables; their
relationship does not prove that their rows are disjoint from the master. Do not
union or sum them blindly.

The partition catalog's 170 entries comprise **85 table partitions plus 85
inherited primary-key index entries**, not 170 table partitions. Allocated table
partitions span July 2020 through August 2027. Their existence does not establish
actual retained rows in every month. The November 2026 table partition spans
`2026-11-01T04:00:00Z` to `2026-12-01T05:00:00Z`, preserving the DST boundary.

## Hierarchy view grain and exclusions

`operation_detail` is a view. Its `line_segment_id` is an alias of the mapping's
**whiteboard UUID**, not evidence of a separate physical line-segment entity.
It joins mappings without filtering out inactive alternatives, so an operation
can produce several rows. It also inner-joins location and threshold records.

The captured view returns 308 rows for 302 distinct operations, compared with
310 operations in the base inventory. Eight operations are absent from the view.
Do not use that view alone as an exhaustive machine/operation inventory or sum
its repeated rows as independent production. Its downtime/FTT/OEE fields are
configuration thresholds, not measured performance.

`vw_oa_state_data` joins operation states, reasons, operations and OA machine
configuration. It is another representation of the operation-state stream,
not an additional duration stream to add to the base state data.

## Confirmed empty sections and newly located dependencies

For all six selected sources, these queries returned no rows:

- `LINE_DAILY_TARGETS_NEAR_WINDOW`
- `WHITEBOARD_DAILY_AGGREGATES_NEAR_WINDOW`
- `OP_CYCLE_BOUNDS_OVERLAPPING_WINDOW`
- `WHITEBOARD_SHIFT_COMMENTS`

This is evidence about these query scopes, not proof that the underlying tables
are globally empty or that the report has no part/target/comment data. The
`181 - 1` shift-schedule template query is also empty, while its dated shift
intervals are present. CutGrind 7 has zero RUN production in the window and no
cycle-time window rows; missing cycle measurements alone are not a downtime
classification.

The catalog now identifies the following dependencies precisely:

| Object | Confirmed columns relevant to reporting | Capture limit |
| --- | --- | --- |
| `tbl_op_part_number` | `id`, `op_id`, `number`, `name`, `timestamp`, `oee_green`, `oee_red` | Definitions only; active/historical part values were not selected. |
| `tbl_line_part_number` | `id`, `line_id`, `number`, `name`, `timestamp` | Definitions only; line/op mirroring and effective-time rules remain unverified. |
| `tbl_threshold_setpoint` | `id`, `op_id`, `slow_running`, `micro_stop`, `timestamp` | Definitions only; units/effective settings and classification rules still need confirmation. |
| `tbl_whiteboard_comment` | `id`, `whiteboard_id`, `shift_id`, `comment`, `timestamp`, `created_on` | Definitions only. This differs from the empty queried `tbl_whiteboard_comment_shift`; relevant report comments may use this object. |

Any later capture should project only the specific required fields and scope.
The comment table's workstation fields and unrelated configuration values are
unnecessary for report reconciliation. Do not infer the active part from a rate
alone, or treat empty cycle bounds as proof that no part history exists.

## Preliminary production reconciliation

All 667 event rows resolve to an operation-scoped reason dictionary in this
capture. Following the existing reader rule—join the reason-row ID and sum only
business code 1 RUN `part_count`—gives:

| Source | RUN pieces in the requested window |
| --- | ---: |
| CutGrind 6 | 116 |
| CutGrind 4 | 71 |
| CutGrind 3 | 14 |
| CutGrind 7 | 0 |
| CutGrind 5 | 20 |
| **Five-grinder total** | **221** |
| `181 - 1` | 109 |

The five-grinder total agrees with the supplied overview's displayed actual of
221, but that match alone does not certify all ring calculations or identical
screen cutoffs. `181 - 1` is one above the screen's 108, so that comparison remains
open. Preserve the discrepancy; do not subtract a piece or change the counting
rule merely to force a match. A later snapshot, screen refresh cutoff and source
corrections are possible explanations that require evidence.

The first six `181 - 1` hourly RUN totals match the screen exactly:
`[12,23,15,14,12,20]`. The captured final hour has 13 versus the screen's 12,
including a RUN completion at 21:56:00.700 local. The displayed wall clock is not
proof of the report's effective data refresh cutoff.

## Metric reconciliation and remaining definitions

| Measure | Evidence from this capture | Interpretation limit |
| --- | --- | --- |
| Cutter Grind maximum capacity | Historical standard 180 and multiplier 1 for each of the five grinders; no planned-state overlap. Candidate `5 × floor(24,983 / 180) = 690` with RUN actual 221 reproduces `221/690` and rounded 32%. | Strong sample match; it does not certify the rule for every department or establish a shared effective cutoff. |
| `181 - 1` FTT parts | Whiteboard events flagged `fttloss` give hourly `[0,5,0,0,1,6,1]`, total 13, matching the screenshot. | Op and line rework each total 13 but their timestamps give `[0,5,0,0,1,5,2]`; preserve the report stream's hourly attribution. Do not add mirrored streams. |
| FTT reason duration | Whiteboard FTT lengths total 650 seconds, or 10.8 minutes as displayed; op rework lengths total 1,300 seconds. | A matching piece total does not make their durations interchangeable. |
| `181 - 1` capacity | Carry-in planned overlap is 0.986 seconds; total clipped planned time 2,699.986 seconds. Candidate whole-window floor gives 222. Exact per-hour flooring yields `[35,36,24,36,21,35,33]`, total 220, versus screen 222. | The earlier 221 hourly reconstruction omitted carry-in. Official interval allocation and rounding are still required; do not introduce a manual correction. |
| Production target | Line count-target rows `[36,36,12,36,21,36,36]` total 213; op target history totals 330 and contains non-unit values. | Neither raw sum establishes the screen's target 178 or maximum capacity. |
| Downtime | The first six rounded hourly percentages reproduce 67/28/36/58/36/35. The requested final hour gives about 61 versus screen 62. The screen's seven rounded hourly percentages average to its total 46%. | This suggests an hourly averaging rule and a refresh-time difference; it does not establish either. A duration-weighted total differs. |
| Cycle variance | Weighting the screen's hourly variances by its hourly production gives -1.1713 seconds, rounding to its -1.2 total. | This does not define the per-hour variance or exclusions. Naive captured cycle-time minus standard averaging gives +111.41 seconds and is unsuitable. |
| OEE | `181 - 1` has 103 operation records and seven line records. Operation examples are percentage-like; line examples are fraction-like and include OEE 1.25. | Different grain and scales; verify each stream's contract, preserve values above nominal bounds and do not apply a shared normalization or clamp. |

The capture is sufficient to continue offline reconciliation now. A full rerun
would repeat already complete evidence. A narrowly scoped follow-up may be useful
for part-number history, the actual report-comment object or classification
settings once the existing rows have been analyzed. Official target, capacity
rounding, FTT, downtime, cycle variance and department aggregation rules still
require authoritative confirmation; source data alone does not settle an
undocumented formula.
