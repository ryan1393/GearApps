# Review against the running DSF screens

The user supplied the running Dana Connected shopfloor report and department overview as the reference for this separate dashboard. The current application is a development starter, **not a validated replacement for those reports**. No live plant DSF query, physical inventory reconciliation, or numerical report comparison has been completed.

## Confirmed scope and meanings

- The reference department overview includes CUTTER GRIND, 121, 131, 132, 152, 181, 191, 200, 240, 310, 341, 350, 400, 541, and 600. The existing MeshForge reader maps CUTTER GRIND to Department 45. The dashboard coverage baseline includes all 15, and retains any additional departments discovered later. It is not a machine inventory or a closed allowlist.
- The user explicitly confirmed that the denominator below a department doughnut is **maximum capacity**, not the production target. The center percentage is consistent with actual production divided by maximum capacity: Cuttergrind's `221 / 690` rounds to `32%`; Department 121's `96 / 119` rounds to `81%`. These are reference-screen observations, not live dashboard data.
- Name this measure **capacity attainment** (`100 × actual / maximum capacity`). Do not call it downtime, utilization, target attainment, or OEE. A target and maximum capacity are separate quantities. A missing or zero capacity cannot supply a valid attainment percentage.
- The shopfloor report shows line/date/shift selection, an active part number, hourly actual/target/capability values, an hourly production/loss Pareto, downtime percentage, cycle variance in seconds, FTT losses in parts, reason-code minutes, comments, and shift totals. The example is line `181 - 1`, second shift, November 11, 2026, 3–11 PM Indianapolis time. This is a different scope from the whole Department 181 overview.
- The department screenshot includes a separate percentage above each ring. Its definition has **not** been confirmed. Do not label it as FTT, downtime, or scrap without the DSF definition.

## Current implementation versus reference

| Requirement | Current support | Evidence still needed |
| --- | --- | --- |
| Cuttergrind and every reference department remain visible | Coverage matrix includes all 15 reference departments, registered departments and additional discovered DSF departments | Live source catalog and physical-machine inventory reconciliation |
| Machines that exist in DSF but not MeshForge | Administrators see source counts and unlinked-source warnings across departments; Cuttergrind also lists individual source mappings | Physical identities, duplicate/alternative operations, approved links, inactive equipment |
| Current-shift production | Existing authenticated DSF RUN-piece snapshot, source freshness, current exports | Reconcile a known line/shift to the DSF report; verify piece/quality semantics |
| Maximum capacity and center percentage | Confirmed specification only; not supplied by the current count endpoint | Authoritative per-hour/shift capacity, part/rate changes, planned breaks, elapsed versus full-shift basis |
| Production target | Separate requirement; unavailable in current count feed | DSF's target source and calculation, distinct from maximum capacity |
| Department state/loss doughnuts | Not implemented | Category definitions, units, aggregation, palette and thresholds; ring slices are not necessarily the center ratio |
| Hourly production/loss Pareto | Not implemented | Hour boundaries, event allocation, loss-to-piece conversion and rounding, planned versus unplanned categories |
| Downtime and reason-code minutes | Not implemented | Authoritative state intervals/durations and reasons; distinguish planned downtime, unplanned downtime, micro stops, slow running, job change and early stop/late start |
| Cycle variance | Not implemented | Actual/reference cycle measurements, sign convention, units, weighting and part/rate changes |
| FTT losses in parts | Not implemented | FTT meaning, rejected/reworked/good counts, counting and correction rules |
| Historical date/shift selection | Not implemented; current snapshot only | Historical data source, retention, corrections and timezone/shift rules |
| OEE | No OEE is displayed or calculated | Separate availability, performance and quality definitions plus approved aggregation |

## Data rules required for parity

1. Keep source operations, lines and physical machines distinct. The eight legacy Department 45 assets in the local sample catalog do not establish coverage of current CutGrind grinders. The older five-grinder stock ledger does not define plant inventory.
2. Do not replace unknowns, stale data or future unreported hours with zero. A validated source zero remains zero. Production inactivity alone does not establish downtime.
3. Keep pieces, lost pieces, seconds, minutes and percentages separate. The hourly Pareto and reason-code minutes use different measures; do not reuse one series as the other. The source's conversion rules must be verified before drawing these bars or rings.
4. Validate the capacity horizon: elapsed production hours versus the full scheduled shift, including breaks and part/rate changes. Record this with each report. Do not silently divide elapsed actual by a differently scoped capacity.
5. Show coverage and freshness with all rollups. The registered-machine filter is not a plant inventory filter. A fresh source list can still omit unsupported nonnumeric department names; verify department aliases and query coverage against DSF itself.
6. Reconcile per-hour values to shift totals and per-line values to department totals at the same source cutoff. Do not expect the two supplied screenshots to have identical totals: line and department scopes differ, and their cutoffs may differ.
7. Use Indianapolis timezone rules, including daylight saving transitions and shifts crossing midnight. Keep original UTC evidence in exports. Missing an hour during a clock change is not a zero-production hour.
8. Define aggregation explicitly. Do not average department attainment percentages without agreed weighting. Raw output across multiple operations is not a count of finished goods; grinder blades and machined parts can have different units.
9. Keep DSF reads on the server, authenticated and read-only. Existing source-role, TLS, source-identity, parameterization, timeout, row-limit and freshness guards remain in place. Browser coverage reads reuse the existing cached source list and do not write mappings or machine/cutter counts.

## Acceptance before calling the new dashboard equivalent

Obtain a read-only DSF reporting connection or source/schema export and one authoritative report for a known line/shift, including Cuttergrind. Confirm the additional percentage above the doughnuts and the loss-category definitions. Compare actual, capacity, target, hourly buckets, downtime minutes/percent, cycle variance, FTT and shift totals to DSF at a matching cutoff. Include planned breaks, a part change, a stale/missing source, zero output, and a shift crossing a date/time boundary. Reconcile all listed departments and physical grinders, including DSF-only machines. Until these pass, the application remains a current-count/coverage starter with the remaining metrics unavailable.
