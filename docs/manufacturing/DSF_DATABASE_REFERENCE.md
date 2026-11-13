# DSF database reference and capture contract

This is the durable reference for the plant DSF PostgreSQL database `maindblocal`.
It records what the supplied exports and the MeshForge reader establish, and what
still needs verification before production and downtime reports can match DSF.
The latest evidence is the successful November 12 capture; see
[its review](DSF_CAPTURE_20261112_REVIEW.md) for completeness and reconciliation.
No direct cloud-to-plant database query or complete report reconciliation has been
performed. The plant dashboard is a separate Nx application that shares MeshForge
libraries and its authenticated server integration.

## Evidence levels

- **CONFIRMED**: explicitly present in an exported definition/catalog, the supplied
  reference screens, a user clarification, or the existing reader implementation.
  The origin matters: reader behavior does not establish a database constraint.
- **SAMPLE-SUPPORTED**: a relationship, unit or interpretation supported by the
  exported rows for the selected sources. Do not generalize it to every plant
  operation without checking.
- **UNRESOLVED**: missing definition, incomplete history, or a proposed calculation
  that has not been reconciled with DSF.

**CONFIRMED — evidence inventory:**

| Evidence | Contents and limits |
| --- | --- |
| `DSF-discovery-20261111-223915.txt` | Initial catalog: 163 source mappings and 173 matched column descriptions. Snapshot recorded November 11, 2026, about 22:39 local time. Ends in `ROLLBACK`. |
| `DSF-details-20261111-224941.txt` | Export time `2026-11-12T03:49:45.412482Z`; 512 JSON records: 174 column definitions, 193 reason definitions, 98 historical sample rows, 40 event samples, six categories and one database/export timestamp. Ends in `ROLLBACK`. |
| `DSF-capture-20261112-180430-040.txt` | PostgreSQL 16.10 snapshot November 12, 2026, 18:04:35 Indianapolis (`23:04:35.958206Z`): 320 JSON objects, all 312 planned dataset manifests complete, six source validations passed, final completion after rollback. Includes whole-source inventory and 667 window event rows for all five grinders plus `181 - 1`. No truncation or unavailable sections. Detailed history is not plant-wide. |
| DSF reference screenshots | Department overview and the `181 - 1` shopfloor report for second shift, November 11, 2026. The line and department scopes and their cutoffs differ. |
| User clarification | The second number below the department doughnut is **maximum capacity**. |
| Existing server reader | `libs/manufacturing/server/feat-greenshed/src/lib/dsf-count/`, principally `dsf-sql.ts`, `dsf-core.ts` and `dsf-count.service.ts`. |

The raw uploads and private analysis artifacts are not part of this document and
must not be copied into the repository. The detail export contains samples, not
all events for a shift. The November 12 capture supplies the declared bounded
window for six selected sources. Empty rows do not establish that a table or
capability is unused plant-wide.

Evidence SHA-256 fingerprints (original uploaded bytes):

- Discovery: `b19f4e468aaeedb2d3fc25033c4ae4c03de65d0ec7d28607f58062e8c3b7e34e`
- Details: `d424099c21280a5c230d168bb59c04c49beea1784718a1bed2ec93aaaa103923`
- November 12 capture: `0c9de0cc5f0d0a88819f3daafc859b43a8687ccd0a6b5bf120cf64a6b6d420a0`

## Data flow and database boundary

**CONFIRMED — implementation:** MeshForge's server polls DSF using a dedicated
PostgreSQL client, a repeatable-read `READ ONLY` transaction, source/role/clock
checks, timeouts and bounded queries. It validates mapping identity and shift
evidence before publishing current-shift RUN counts. Browser consumers use the
authenticated cached `/api/v1/dsf-counts` endpoint; they do not query DSF directly.
The source catalog is also cached. This endpoint does not provide the complete
historical reporting dataset.

**Implemented count archive:** the same serialized reader now supplies the
[plant count-history system](DSF_COUNT_HISTORY.md). It discovers all DSF source
names, stages bounded hourly RUN totals and dated-shift slices, closes the source,
then atomically replaces the corresponding windows in MeshForge. The history APIs
and `/history` screen read that local archive. This does not establish the missing
capacity/downtime/OEE formulas or prove a live cloud connection to the plant.

DSF source objects used by the reader are in the `public` schema of `maindblocal`.
MeshForge's own database is separate. The following are **MeshForge-local** tables,
not DSF source tables: `dana_dsf_machine_mapping_v1`,
`dana_dsf_machine_mapping_audit_v1`, `dana_dsf_cutter_machine_state_v1`,
`dana_dsf_cutter_run_shifts_v1`, and any legacy grinder stock-ledger tables.
The new `dana_dsf_history_*_v1` source, hour, slice, state, issue and revision tables
also belong to MeshForge. They store counts, coverage and source identity evidence;
they are not new DSF source objects or a second database connection.
Optional cutter crediting writes to MeshForge only, after the DSF connection has
closed. Keep source reads, reporting calculations and local crediting separate.

## Identifier namespaces and joins

**CONFIRMED — exported types:** plant, area, department, line, line-segment,
operation, whiteboard and whiteboard-mapping identities are UUIDs in the observed
definitions/catalog. Event/history IDs and reason/rate/category/shift IDs are
integers. A similarly named column does not establish the same namespace.

**CONFIRMED — November 12 structural export:** 98 constraints, 74 indexes, three
business-view definitions and partition lineage now establish primary keys and
foreign keys for the source mappings, event reasons, state reasons, cycle rate
references and rework reasons below. These are single-column FKs: they do not
prove that a reason/rate belongs to the same operation as its event or cycle.
Keep operation, line and whiteboard consistency checks in queries.

| Relationship | Evidence and required scope |
| --- | --- |
| `tbl_whiteboard_machines.whiteboard_id → tbl_whiteboard.id` | **CONFIRMED, reader-used.** Retain the board together with mapping identity. |
| `tbl_whiteboard_machines.op_id → tbl_op.id` | **CONFIRMED, reader-used.** An operation is not automatically a physical machine. |
| `tbl_whiteboard_machines.line_id → tbl_line.id` | **CONFIRMED, reader-used.** Reader also requires `tbl_op.line_id = mapping.line_id`. |
| `tbl_line.department_id → tbl_department.id` | **CONFIRMED, reader-used.** Department name supplies the current discovery/alias logic. |
| `tbl_whiteboard_cycles_master.machine_id → tbl_whiteboard_machines.id` | **CONFIRMED, reader-used and present in event samples.** This is a DSF source-mapping UUID, not a MeshForge machine UUID or plant asset number. Match `whiteboard_id` too. |
| `tbl_whiteboard_cycles_master.code → tbl_op_state_reason.id` | **CONFIRMED, reader-used; SAMPLE-SUPPORTED.** The event stores the integer reason-row ID. The reason's own `code` is a separate business code; require the expected `op_id`. |
| `tbl_op_state.code → tbl_op_state_reason.id` | **CONFIRMED FK.** Preserve operation scope and historical reason rows. |
| `tbl_op_state_reason.category_id → tbl_op_state_category.id` | **CONFIRMED FK.** Maintenance fault grouping, not the production/loss classification. |
| `tbl_op_cycle_time.rated_speed → tbl_op_rated_speed.id` | **CONFIRMED FK.** Resolve a rate-record ID for the same operation before interpreting its numerical `rated_speed`. |
| `tbl_line_cycle_time.rated_speed → tbl_line_rated_speed.id` | **CONFIRMED FK.** Separate line-rate namespace. |
| `tbl_op_count_rework.reason → tbl_op_state_reason.id` | **CONFIRMED FK.** Do not use the line-reason dictionary. |
| `tbl_line_state.code` / `tbl_line_count_rework.reason → tbl_line_state_reason.id` | **CONFIRMED FKs.** Keep the line dictionary separate from operation reasons. |
| `tbl_line_daily_target.line_name → line name` | **UNRESOLVED.** Name-keyed data; exact field, uniqueness, rename history and effective-date policy need verification. |

The current query orders cycle events by `(timestamp, id)`. The November 12
constraint export confirms the master primary key is `(id, timestamp)`. Do not
assume integer event IDs alone are globally unique across partitions.

## Object roles and known fields

Unless stated otherwise, the detail export describes fields below as
`timestamp(4) with time zone`, integer counts/durations/IDs, UUID entity IDs and
text names. These are type facts, not proof of business semantics.

| Object or family | CONFIRMED role/fields and interpretation boundary |
| --- | --- |
| `operation_detail` | Confirmed view. `line_segment_id` is actually `tbl_whiteboard_machines.whiteboard_id`, and segment name is the whiteboard name. Includes inactive mappings and can repeat operations; inner joins on location and threshold rows can omit operations. November 12: 308 rows, 302 distinct operations versus 310 in `tbl_op`. Thresholds are not measurements. Never use this view alone as the full operation inventory. |
| `tbl_line` | UUID `id`, `department_id`, `area_id`, `cell_id`, `line_type_id`, `loc_id`; name/display name, asset number, `has_multiple_parts`, `is_emaint_enabled`, timestamp. |
| `tbl_op` | UUID `id`, `line_id`; name/display name, asset number and timestamp. |
| `tbl_whiteboard` | UUID `id`; name, order, active flag, `shopfloor_by_shift`, timestamp. |
| `tbl_whiteboard_machines` | Complete captured schema: UUID `id`, `whiteboard_id`, `op_id`, `line_id`; boolean `active`; timestamp. Primary key and separate FKs confirmed. |
| `tbl_department` | Complete captured schema: UUID `id`, name text, timestamp. |
| `tbl_whiteboard_cycles_master` | Integer `id`, `code`, `length`, `part_count`; UUID `whiteboard_id`, `machine_id`; timestamp. Event increments include production and loss segments. |
| `tbl_op_state_reason` | Integer `id`, business `code`, `category_id`; operation UUID; name/color, active/running/fttloss/downtime flags, timestamp. |
| `tbl_op_state_category` | Integer `id`, name/display name. |
| `tbl_op_state` / `tbl_line_state` | Integer `id`, reason-row `code`, `length`; scoped operation/line UUID and timestamp. Interval semantics need cutoff-aware handling. |
| `tbl_line_state_reason` | Integer `id`, business `code`; line UUID; name/color, active flag, timestamp. It does not have the operation-reason running/downtime/FTT flags in the captured definition. |
| `tbl_op_rated_speed` | Integer `id`, numerical `rated_speed`, `part_count`; operation UUID and timestamp. |
| `tbl_line_rated_speed` | Integer `id`, numerical `rated_speed`; line UUID and timestamp. No `part_count` field in the captured definition. |
| `tbl_op_cycle_time` / `tbl_line_cycle_time` | Integer `id`, `cycle_time`, rate-record reference `rated_speed`; operation/line UUID and timestamp. |
| `tbl_op_cycle_bounds` | Integer `id`, operation UUID, `cycle_start`, `cycle_end`, serial and part text. No selected-source overlap rows in either capture; serial is deliberately excluded from the exporter. Part history must use a different verified source for this window. |
| `tbl_op_part_number` / `tbl_line_part_number` | Newly confirmed metadata: integer `id`, operation/line UUID, `number`, `name`, timestamp; op table also has integer `oee_green`/`oee_red`. Entity FKs confirmed. No row values exported yet; effective-time and active-part interpretation remain unverified. |
| `tbl_op_count_target` / `tbl_line_count_target` | Integer `id`, `count`; operation/line UUID and timestamp. Samples include per-operation ticks and hourly line counts. Business target/capacity meaning is unresolved. |
| `tbl_line_daily_target` | Integer `id`, `target`; `line_name` text and timestamp. No selected-line near-window rows in November 12 capture. Name/effective-date semantics remain unresolved. |
| `tbl_op_count_rework` / `tbl_line_count_rework` | Integer `id`, `count`, `reason`, `length`; operation/line UUID and timestamp. Mirrored sample rows must not be added together. |
| `tbl_op_oee` / `tbl_line_oee` | Integer `id`; operation/line UUID; double-precision `oee`, `oee_availability`, `oee_performance`, `oee_quality`; timestamp. November 12 has values: op examples use percentage-scale values (100), line examples use fractional values (1). Their scale and time grain differ; never apply one shared normalization or silently clamp values. Period/formulas need verification. |
| `tbl_shift` | Integer `id`, shift number; line UUID, `start_of_day`, dated `start_time`, `end_time`, metadata timestamp. |
| `tbl_shift_schedule` | Integer `id`, shift number; line UUID, `start_of_day`, **text** start/end times, metadata timestamp. Distinguish schedule templates from dated shifts. |
| `tbl_whiteboard_daily_aggregate` | Integer `id`, actual/target/rework/code/length; board UUID and timestamp of type **date**. No mapping, operation or shift key in the captured fields. Grain and derivation are unresolved. |
| `vw_oa_state_data` | Confirmed view over op state, op reason, op and OA-machine membership; `reason_id` is state code, while `code` is reason business code. OA membership/active is not physical production status. Do not add it to the base state stream. |
| `tbl_whiteboard_cycles_master` and companion cycle relations | Master is a partitioned table with PK `(id,timestamp)`. `tbl_whiteboard_cycles` is a view selecting the master directly. Partition export contains 85 table children plus 85 inherited PK-index entries; it does not show 170 table partitions. Current/old are separate regular tables with no observed inheritance edge to master. Do not union these relations or infer disjoint history. |
| `tbl_whiteboard_comment` / `tbl_whiteboard_comment_shift` | Separate tables. November 12 metadata confirms general comment fields `id`, board/shift IDs, `comment`, timestamp/created-on and workstation fields. Only shift-comment rows were queried and all six selected scopes were empty; this does not establish that general report comments are empty. Export only explicit report fields if that table is read later. |
| `tbl_threshold_setpoint` | Metadata confirms integer `id`, operation UUID, `slow_running`/`micro_stop` double-precision values and timestamp. No values exported yet; classification thresholds must not be guessed. |

## Time conventions, units and counting rules

**CONFIRMED — application convention:** report using
`America/Indiana/Indianapolis`, preserving original UTC timestamps in evidence.
For the sampled November 11, 2026 second shift, materialized boundaries are
`2026-11-11T20:00:00Z` through `2026-11-12T04:00:00Z`, or 3–11 PM local.
The shift metadata timestamp is later than the scheduled start; it is not the
shift boundary. Respect `start_of_day`, shifts crossing midnight and DST rules.
The existing reader uses half-open event windows `[start, end)`.

**SAMPLE-SUPPORTED — units and references:**

- Operation rate record `98332` has value `100`, `part_count = 1` for `181 - 1`;
  CutGrind 3 rate record `95633` has value `180`, `part_count = 1`. These act as
  nominal **seconds per piece**, giving 36 and 20 pieces/hour before adjustments.
  Those IDs are not speeds. Preserve historical rates and explicit references;
  duplicate/equal-time rate rows exist.
- `cycle_time` tracks successive completion gaps in seconds: for example,
  200.147 seconds corresponds to 200, and 121.180 corresponds to 121. Source
  rounding and treatment of fractional seconds remain unresolved.
- State/event `length` tracks second-scale durations. Convert to minutes only
  for a metric explicitly expressed in minutes. Piece-loss conversions are a
  separate calculation, not a unit rename.
- A CutGrind cycle of 22,182 seconds includes stopped time. Averaging raw
  `cycle_time - nominal_time` is not a validated DSF cycle-variance calculation.
- Event timestamp appears to be completion/end; state timestamp appears to be
  interval start. Confirm each stream's semantics and corrections policy before
  implementing historical allocation.

**CONFIRMED — current production rule; SAMPLE-SUPPORTED necessity:** resolve event
`code` to the operation reason's ID, require the mapped operation, and sum only
business reason code `1` RUN `part_count` increments. The 20 sampled `181 - 1`
event rows sum to 20 raw increments but only 11 RUN pieces; CutGrind 3 sums to
14 raw increments but only five RUN pieces. Loss segments can share production's
completion timestamp and carry `part_count = 1`. `running = true` is also too broad:
Slow Running has that flag. Do not deduplicate by timestamp alone or sum all rows.

Keep historical inactive reasons resolvable. The sampled operation has two active
FTT-loss reason rows with business code `8000` and the same label. A reason's
business code or name is not a unique key, even within an operation.

**UNRESOLVED — historical allocation:** capture the interval already active at
window start; clip interval ends to the historical cutoff and bucket boundaries.
A later export can contain a length extended after the requested cutoff. Retain
both `exported_at` and `report_cutoff`. Do not sum operation-state duration and
cycle-loss segment duration as independent losses, or mirrored line/op counts as
independent production/rework. Output across sequential operations is not
automatically finished-goods output; blades and machined parts can use different
production units.

## Reasons, categories and source palette

**CONFIRMED — exported definitions:** the six operation-state categories are
Machine; Electrical; IT & Controls; Tooling & Fixtures; Materials & Scheduling;
Safety & Operations. These group maintenance reasons; they are not the same as
Running/Slow Running/Micro Stoppage/FTT-loss classes.

| Source class | Source color | Flag caution from samples |
| --- | --- | --- |
| Running | `#06A34A` | Business code 1 is the current production class. Manual code 3 can also have `running = true`. |
| Downtime / fault | `#D30000` | Fault and Undefined Downtime reasons have downtime true. |
| Micro Stoppage | `#2B9CD8` | Downtime true does not mean every reason should use the same displayed class. |
| Slow Running | `#FFC700` | Has running true; do not count its event rows again as RUN production. |
| Planned Downtime | `#D0CECE` | Sample code 60 has running/downtime/fttloss all false. |
| Early Stop / Late Start | `#F97A18` | Sample codes 11000/11001 also have those three flags false. |
| FTT loss | `#66411C` | Reason IDs and rework-count records exist; the percentage denominator is unresolved. |
| Changeover | `#112288` | Preserve source reason definition and category. |

Retain reason ID, operation, business code, flags, category, active status and
color. Do not collapse the classification to a single boolean or infer downtime
from no production. These data colors are separate from the Dana UI shell theme.

## Source coverage and physical-machine reconciliation

**CONFIRMED — November 11 catalog, not current plant inventory:** 163 mapping
rows; 117 with both mapping and whiteboard active; 116 distinct active operation
UUIDs. There are 25 raw department strings, including inactive sources. Active
sources use 22 raw department strings, or 21 groups after combining `Dept.132`
with `Dept. 132`. These are source/operation counts, not a certified count of
physical machines.

| Normalized source department | Both-active mappings |
| --- | ---: |
| CUTTER GRIND | 5 |
| 121 | 4 |
| 131 | 6 |
| 132, combining both spellings | 19 |
| 152 | 13 |
| 181 | 14 |
| 191 | 2 |
| 200 | 6 |
| 240 | 8 |
| 310 | 4 |
| 341 | 1 |
| 350 | 2 |
| 400 | 2 |
| 541 | 5 |
| 545 | 1 |
| 600 | 3 |
| Hard Turn (Pinions) | 4 |
| Hard Turn (Rings) | 5 |
| Shot Peen | 4 |
| Straightener | 4 |
| Thread Draw | 5 |
| **Total** | **117** |

**CONFIRMED — five active cutter-grind sources:**

| Source label | Plant asset label |
| --- | --- |
| CutGrind 6 | 1-24-77 |
| CutGrind 4 | 1-24-78 |
| CutGrind 3 | 1-24-79 |
| CutGrind 7 | 1-24-80 |
| CutGrind 5 | 1-24-81 |

The extra `CutGrind 77` mapping is inactive and shares line/operation with active
CutGrind 6; it does not establish a sixth active grinder. The eight legacy
Department 45 assets in the local MeshForge sample, four inactive, are different
identities. Neither those nor the older five-grinder stock ledger establish
registration or approved source links for the five current source grinders.

**CONFIRMED — duplicate and discovery hazards:**

- Both-active sources `132 PIN CUTTER 550` and `132 PIN CUTTER 551` reference the
  same `Line132-PIN_551` operation. Resolve the physical identity/alternative
  mapping before counting these as two machines or adding their output.
- `181 - 1` has an inactive old operation mapping alongside active OP10. Check
  activity on alternatives, not only their current active flags.
- The current source query recognizes numeric `Dept.` names plus explicit
  `DSF_DEPARTMENT_NAMES` aliases. Its default alias is `CUTTER GRIND=45`; setting
  the alias list replaces the default. Retain this alias when extending it.
- The five other named areas above contain 22 active mappings. They are missed
  without explicit alias/coverage treatment. Do not guess their department codes
  from line names. A fresh cached list can still have incomplete query coverage.
- Dept.545 has an active source beyond the screenshot's 15 department groups.
  The screenshot departments are a baseline, not a closed allowlist.

Physical-machine acceptance requires a reviewed mapping among MeshForge machine,
DSF mapping, whiteboard, operation, line, department, plant asset identity and
production unit. Keep duplicates, inactive alternatives and DSF-only equipment
visible for review. Preserve existing identity/department/operation-line checks
and refusal when alternate mappings carry production.

## Capacity, target, FTT, downtime and OEE boundaries

**CONFIRMED — user/screen meaning:** the doughnut denominator is maximum capacity.
Name its center `capacity attainment = 100 × actual / maximum capacity`, with
matching scope/cutoff/unit. It is distinct from production-target attainment,
downtime, utilization and OEE. Missing or zero capacity cannot supply a valid
attainment percentage. The percentage above each doughnut remains undefined.

**CONFIRMED — capture horizon versus displayed clock:** the export requests
15:00–21:56:23 local (`20:00:00Z`–`02:56:23Z`), using the screenshot's displayed
clock. That clock is not proof of the report data's last refresh time. The later
November 12 snapshot can also contain historical corrections.

**SAMPLE-SUPPORTED — six-source production reconciliation:** the five grinders
sum to 221 RUN pieces, matching the Cutter Grind overview. `181 - 1` has 109 RUN
pieces with hourly values `[12,23,15,14,12,20,13]`; the screen shows 108 and a final
hour of 12. Its last captured RUN is 21:56:00.700 local. A prior refresh could
explain the difference, but no source refresh metadata establishes that explanation.
Do not delete the extra completion or move the cutoff to force equality.

**SAMPLE-SUPPORTED — candidate capacity reconstruction:** all five captured grinder
standards are 180 with part multiplier 1. At the requested horizon, the candidate
`5 × floor(24,983 / 180) = 690` and actual 221 reproduce the overview's `221/690`
and rounded 32% attainment. This match does not establish an official formula.

For `181 - 1`, the full capture adds a planned carry-in overlap of 0.986 seconds.
Clipped planned durations total 2,699.986 seconds; available time is 22,283.014
seconds and `floor(22,283.014 / 100) = 222`. Exact hourly flooring instead gives
`[35,36,24,36,21,35,33]`, total 220, versus the screen's
`[36,36,24,36,21,36,33]`, total 222. The earlier 221 hourly reconstruction omitted
carry-in and is superseded by this complete window. Rounding/interval allocation,
elapsed versus full-shift policy and part/rate changes remain unresolved.

Other unresolved definitions:

- `tbl_op_count_target` and `tbl_line_count_target` are not proven production
  targets merely because of their names. The complete 181-1 op stream sums to
  330 and includes values 35/12/14 among one-count rows; it is not safe to treat
  every row as a nominal increment. Line rows `[36,36,12,36,21,36,36]` also do not
  reproduce the screen's capacities. Production target 178 and the name-keyed
  daily target's effective-date policy still need an authoritative definition.
- FTT-loss reasons/rework quantities do not establish good/reject/scrap semantics,
  a quality denominator, or an FTT percentage. Do not add mirrored op/line rework.
- Captured OEE values demonstrate different scales between operation and line
  streams; hourly line records and more frequent operation records also have
  different grain. Their historical-update horizon, exact scale contract,
  component formulas and aggregation remain unverified. Do not derive OEE from
  capacity attainment or normalize both streams alike.
- Downtime percentage needs the approved included reasons, denominator, break
  policy, interval clipping and weighting. A mean of machine percentages is not
  an established plant percentage.
- Cycle variance needs its approved reference, sign, weighting and stopped-time
  treatment. Hourly production/loss bars in pieces and reason durations in minutes
  need separate verified transformations.
- The complete window reproduces 13 rework/FTT-loss pieces in each mirrored
  op/line rework stream. Whiteboard FTT-loss event parts also total 13 and match
  the screen's hourly `[0,5,0,0,1,6,1]`; rework timestamps instead allocate
  `[0,5,0,0,1,5,2]`. Their hourly attribution is not interchangeable. Event FTT
  lengths total 650 seconds (10.8 minutes), while op rework lengths total 1,300
  seconds; duration streams are distinct. RUN actual is 109 versus screen 108.
  Downtime and cycle-variance comparisons support candidate
  aggregation rules only; they do not establish the approved report formula.
  Line and department screens differ in scope and may differ in refresh time.

## Capture completion and reporting acceptance

**Status after the successful November 12 capture:**

1. **Captured and reviewed:** mapping/department definitions, 98 constraints,
   74 indexes, targeted views and cycle partition lineage. Preserve remaining
   owner-scope checks even where single-column FKs exist.
2. **Captured for six selected sources:** complete declared window plus boundary
   state/rate/event context, applicable shifts, reasons, cycles, targets, rework
   and OEE. Not all plant history. Newly identified part-number tables, general
   comments and classification setpoints have metadata but no selected values;
   read them narrowly if required for the next reporting implementation.
3. **Passed:** 312/312 planned manifests, six source validations, no truncation,
   no unavailable schema, consistent read-only snapshot and rollback. Empty
   scopes are explicit and must not be generalized to entire tables.
4. Obtain authoritative DSF hourly and total values for the same line/date/shift
   and cutoff. Reconcile RUN actual, capacity, separate target, every loss class,
   reason minutes, downtime percentage, cycle variance and FTT. Resolve 221/222
   and the separate percentage above the department doughnuts. Keep any approved
   rounding tolerance explicit.
5. Validate temporal and correction behavior: planned break overlap, partial hour,
   rate/part change, inactive reason, long stopped cycle, zero output, stale/missing
   source, duplicate alternative, cross-midnight shift and DST boundary. Confirm
   how later source corrections affect a historical report.
6. Reconcile all discovered areas and physical machines, including the five active
   cutter-grind sources and 22 active mappings in other named areas. Record unit,
   aggregation path and duplication policy before line/department/plant rollups.
   Unknown/stale/missing data remain distinct from validated zero.

The dashboard now includes persistent RUN-count history and coverage reports;
unverified capacity, downtime, FTT and OEE metrics remain unavailable. Update this reference when new
evidence changes a fact; retain the evidence level and date so a later reader can
distinguish a verified source rule from a working hypothesis.
