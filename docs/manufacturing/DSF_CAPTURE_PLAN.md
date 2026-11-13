# DSF capture audit and report acceptance

Reviewed November 12, 2026 against the two November 11 uploads, the successful
November 12 capture, the running DSF screens and the MeshForge reader. The schema and confirmed rules are preserved in
[DSF_DATABASE_REFERENCE.md](DSF_DATABASE_REFERENCE.md). The uploads contain a
plant source catalog, small two-source samples and a complete declared window for
six selected sources, not complete plant-wide reporting history.

**The consolidated capture has now been run successfully.** All 312 planned
manifests are complete, all six source identities passed and none were truncated.
Read-only mode and rollback are recorded. See
[November 12 capture review](DSF_CAPTURE_20261112_REVIEW.md) for the findings.
The matrix below preserves the original capture plan; use that review and the
database reference for current evidence status. No broad repeat export is needed
for completeness. Part-number history, general comments and classification
setpoints are now identified for a possible narrow follow-up if implementation
needs their values.

## What the audit changed

The earlier report-window draft selected only CutGrind 3 and `181 - 1`, did not
include shift configuration, omitted empty source/dataset results and used the
default read-committed snapshot. It must not be used as evidence of complete
plant coverage or report parity. Use the versioned exporter under
[tools/manufacturing/dsf](../../tools/manufacturing/dsf/README.md) instead.

The new capture uses one repeatable-read, read-only snapshot. It inventories the
whole source catalog, including inactive mappings and nonnumeric departments.
Detailed historical rows are bounded to the five active Cutter Grind sources and
`181 - 1` for the reference screenshot window. Runtime identity checks, explicit
dataset manifests and boundary context make missing or truncated evidence visible.
This is a formula/reconciliation capture, not a dump of every plant event.

## Evidence coverage

| Reporting need | Already established | Next capture / remaining evidence |
| --- | --- | --- |
| Whole-plant source scope | 163 mappings, 117 both-active mappings, 116 active operations in the initial catalog | Refresh every mapping/board/operation/line/department without a numeric-name filter; include assets, activity, alternate sources, duplicate identities and additional areas. These are not physical-machine counts. |
| Cutter Grind | Five active sources: CutGrind 6/4/3/7/5, asset labels 1-24-77 through 1-24-81 | Capture all five detailed source windows; retain inactive CutGrind 77 in inventory; reconcile physical assets with MeshForge Admin records. |
| Named areas | Hard Turn (Pinions), Hard Turn (Rings), Shot Peen, Straightener and Thread Draw have 22 active mappings | Include them in inventory. Establish approved department identities before changing aliases or rollups. The current default reader can omit these areas. |
| Source joins | Mapping UUID, operation UUID, line UUID, whiteboard UUID and physical machine are distinct | Validate selected source identities at export time, including operation-to-line consistency. Inventory alternative mappings; review PIN cutter 550/551 sharing one operation. |
| Structural schema | 174 selected column definitions; logical joins from reader and samples | Capture relevant column types, keys/checks, indexes, relation kinds, view definitions and partition/inheritance lineage. Do not assume missing FKs or union cycle relations. |
| Actual production | Existing rule is reason-row ID join, then business code 1 RUN increments | Capture the full bounded event window and reason dictionaries, including inactive reasons, unmapped reason IDs and boundary ties. Reconcile to the reference actual of 108; do not sum loss-row part counts. |
| Downtime and loss reasons | State and cycle-loss samples, reason flags/colors and six maintenance categories | Capture state carry-in, window and following boundary context; retain raw durations/time precision. Establish each stream's start/end semantics and planned/unplanned classification. Never add parallel state and event loss streams. |
| Shifts and reporting day | Dated shifts differ from text schedule templates; start-of-day is explicit | Capture applicable dated shifts and schedule templates. Preserve UTC and Indianapolis time, local report date, cutoff and shift identity. Other day/week configuration remains subject to catalog discovery. |
| Maximum capacity | User confirms denominator; candidate whole-window reconstruction matches 222 | Capture historical rates, part multipliers, explicit cycle-rate references, planned states and cycle bounds. Resolve hourly 221 versus 222 and elapsed/full-shift policy before implementing. |
| Production target | Target 178 is separate from capacity 222 on the example screen | Capture op/line target histories and line daily targets. Determine which source/policy the report uses, effective dates and name-key semantics; do not assume an 80% rule. |
| Part changes | Line has multi-part metadata; cycle bounds include a part field | Capture bounded cycle bounds without serials. Discover additional part master/history table definitions. If bounds are empty, the authoritative active-part timeline is still needed; a rate change alone does not identify the part. |
| FTT and rework | Reason flags and mirrored op/line rework histories exist | Capture reason IDs, rework and relevant aggregate/OEE rows. Reconcile the 13 lost parts and obtain the approved quality denominator, correction and scrap rules. |
| Cycle variance | Cycle samples behave as seconds; long gaps include stopped time | Resolve each cycle's historical rate ID. Obtain stopped-time exclusions, sign, rounding and aggregation rules before comparing with -1.2 seconds. |
| Department rings / OEE | Center is capacity attainment; OEE columns exist | Obtain the small percentage above each ring, ring slice units, OEE scale/period/formula and weighting rules. Capture thresholds separately from measurements. |
| Daily aggregates | Board/day rows exist and timestamp is a date | Capture applicable board/day records for comparison. Do not add them to machine events or assume board/day equals line/shift. |
| Report comments | Shift comments have board/shift, edit/deletion fields | Use explicit reporting fields only where schema is verified; preserve edits/deletion state, exclude workstation/operator fields. Unknown comment/part/config relations remain metadata-only until reviewed. |
| Historical corrections | A later export can contain extended state lengths | Retain requested historical cutoff separately from snapshot/export time. Determine whether source version/audit history exists. A fresh snapshot cannot reconstruct overwritten historical values automatically. |
| Physical plant inventory | Local sample's 55 records cover four departments and are incomplete | Compare an authorized MeshForge machine/mapping snapshot with the refreshed DSF inventory and the physical plant list. Source rows alone cannot certify every physical machine. |

## Export integrity and operating bounds

- PostgreSQL receives `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; the
  capture ends with `ROLLBACK`. It does not create helper tables, change plant
  settings, credit cutters or write DSF data. Session-local timeouts/timezone
  affect only this connection. Use an existing read-only reporting login.
- The reference window is November 11, 2026, 15:00 to 21:56:23 in
  `America/Indiana/Indianapolis`, with half-open event boundaries `[start,end)`.
  Preserve the scheduled 23:00 shift end separately from the screenshot cutoff.
- Every planned dataset has a manifest. Empty, missing relation, identity
  mismatch, truncation and successful bounded completion have different meanings.
  A missing/failed section is not zero output. Counts at the limit are lower
  bounds; truncated rows cannot support totals.
- Carry-in and following context preserve equal-timestamp rows. They are context,
  not extra production inside the report window. Clip state/cycle intervals to
  the historical cutoff and each hourly bucket when testing candidate formulas.
- The script sets statement, lock and idle-transaction timeouts. Each statement
  has its own time limit; that is not a total execution-time promise. No plant
  execution time has been measured. A capture may take several minutes. On an
  SQL error or timeout it stops, and the partial file must not be treated as
  complete. Do not raise limits or rerun an unbounded history query blindly.
- The Windows wrapper finds `psql`, asks for host/port/user and writes a dated
  Desktop text file. The password stays in the `psql` password prompt. It embeds
  its SQL, so no previous PowerShell variables or separate SQL download are
  required. Success requires both the process result and final completion marker.
- Keep raw captures and connection details outside Git. The repository contains
  the reusable exporter and sanitized reference, not uploaded production rows.

## What completion will mean

A finished text export establishes that its declared bounded sections ran. It
does not establish the official DSF business formulas, whole-plant history,
physical-machine completeness or a deployment.

Before enabling reporting metrics:

1. Review every manifest and reconcile refreshed source coverage, including all
   five grinders, named areas, inactive alternatives and duplicate operations.
2. Resolve metadata-only part/config/comment dependencies and capture the
   specific required fields with verified joins. Obtain the report SQL or an
   authoritative definition for the unresolved metrics and rounding rules.
3. Compare hourly and shift actual, capacity, target, loss classes, reason
   minutes, downtime percent, cycle variance and FTT to an authoritative report
   at the same line, shift and cutoff. Retain source values and tolerances.
4. Repeat with a planned break, part/rate change, inactive reason, long stopped
   cycle, validated zero, missing/stale source, alternate mapping, cross-midnight
   shift and DST boundary. Verify changes made after a historical cutoff.
5. After source joins/formulas are verified, validate bounded history coverage
   for every included plant source and retention period. Six detailed sources
   cannot prove all other sources behave identically. Define compatible units
   and aggregation paths before plant totals; sequential operations can count
   the same physical part more than once.

The dashboard currently remains a count/coverage starter. Unverified metrics
remain unavailable until their acceptance evidence is recorded in the database
reference.

## Local verification of the revised exporter

On November 12, 2026, all ten automated capture tests passed, including six
PostgreSQL fixture tests using isolated temporary objects. They exercise actual
queries, schema guards, identity checks, empty results, source/cutoff scope, caps,
timestamp ties and explicit field selection. Generated artifacts match the source.

A separate native PostgreSQL 16 `psql` check in a disposable synthetic database
passed complete, missing-optional-schema and missing-core-schema paths. It
confirmed repeatable-read/read-only mode and rollback. The last path deliberately
raises a harmless SQL error after the failure record and rollback: older `psql`
clients can ignore a numeric `\quit` argument, so that argument alone was not
sufficient to guarantee a failing exit code.

The PowerShell artifact parsed and passed eight portable PowerShell 7 checks:
success, native process error, missing completion, missing/incorrect/duplicate
dataset, invalid JSON and truncated coverage. These substituted Desktop resolution
and the client process; they checked temporary SQL cleanup, retained partial files
and restored caller settings. They do not certify a particular Windows install,
live DSF performance, physical inventory or business-formula parity.
