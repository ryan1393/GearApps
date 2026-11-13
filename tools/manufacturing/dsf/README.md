# DSF evidence capture

This captures DSF evidence from `maindblocal` without modifying plant records or settings. It is a separate diagnostic tool; it does not enable a production dashboard connection or certify report formulas.

The November 12 capture has already passed all 312 manifest checks; see its
[review](../../../docs/manufacturing/DSF_CAPTURE_20261112_REVIEW.md). No broad
repeat is currently needed. Keep these scripts for reproducibility and use a
specific, verified scope for any later missing-data query.

The checked-in defaults use the November 11, 2026 second-shift screenshot: 15:00–23:00 in `America/Indiana/Indianapolis`, with a historical cutoff of 21:56:23. UTC timestamps have explicit offsets. Re-running later reads the current database snapshot, which can include changes made after that screenshot.

## Run on the plant PC

Use [DSF-capture.ps1](./DSF-capture.ps1) as a complete script, or paste its complete contents into PowerShell. It finds the PostgreSQL client, asks for host, port and read-only username, and lets `psql -W` prompt for the password. It needs no previously defined variables and no separate SQL download. The script does not contain a server address or credentials.

The report is saved as `DSF-capture-<timestamp>.txt` on the Windows Desktop. On an error, an existing report is renamed with `.partial`; send the displayed error and retain that partial report for diagnosis. The temporary SQL file is removed. A successful export validates its header, completion marker and expected source/dataset manifests before displaying its location.

The connection timeout is 10 seconds, each statement has a 20-second timeout, lock waiting is limited to 1 second, and an idle transaction is limited to 60 seconds. The export includes many bounded queries and can take several minutes. A timeout stops the export immediately; it does not retry or silently skip failed SQL.

The session uses `REPEATABLE READ READ ONLY`, a controlled search path and UTC display, then rolls back. Use the same read-only account as the earlier discovery. Keep the resulting report local until reviewed: the explicitly selected report comments are free text entered at the plant and may contain operator-entered information.

## Coverage

- Whole database inventory: departments, lines, operations, whiteboard mappings, operation hierarchy and thresholds. It keeps inactive aliases and all department names, including Cutter Grind and nonnumeric names. Source IDs and operation IDs do not establish physical-machine counts or completed plant coverage.
- Detailed history: the five active Cutter Grind sources from the audited discovery plus `181 - 1`. It does **not** pull full history for every plant mapping. Identity checks compare source, operation, line, operation-to-line relationship, whiteboard name and active flags. Previously observed whiteboard UUIDs are also checked for CutGrind 3 and `181 - 1`; the other four UUIDs are captured at runtime and explicitly marked as not previously verified.
- Bounded streams: whiteboard events, operation/line states, standards, cycle times, targets, rework and OEE. Window rows use `[start,cutoff)`. Nearest predecessor/successor datasets retain every row sharing the boundary timestamp, under the same explicit cap. These context rows can lie outside the report window and must not be added directly to report totals.
- Reference/configuration evidence: rate history referenced by each cycle, current standards at capture time, active/inactive reason dictionaries, reason categories, nearby stored shifts, schedules, daily targets, daily aggregates, overlapping cycle bounds with part names, and selected board/shift report comments with edit/deletion markers. Serial numbers and workstation/user columns are excluded.
- Schema evidence: relation kinds, columns, constraints, indexes, selected business-view definitions and partition structure. Unknown part/config/comment/threshold relations are discovered as metadata only. No arbitrary function bodies or unknown table row values are exported.

Every planned dataset has a manifest even when empty or unavailable. `complete` means all rows for that particular query were returned within the cap. `truncated` means the query observed at least one more row than it returned; its results are incomplete. `unavailable_schema`, `missing_source`, `missing_related_identity`, `identity_mismatch` and `inactive_source` require investigation and suppress affected detailed reads. Optional schema differences are recorded; missing core mapping/hierarchy schema aborts the capture.

The final `CAPTURE_COMPLETED` record confirms that the export reached rollback and emitted its planned manifests. It explicitly keeps `business_parity_verified:false` and `full_plant_history:false`. It does not prove physical inventory completeness, source formulas, historic configuration, or screenshot equality.

## Regenerate and test

The dependency-free source is [generate-capture.mjs](./generate-capture.mjs). Generate both checked-in artifacts from the repository root:

```sh
node tools/manufacturing/dsf/generate-capture.mjs
node --test tools/manufacturing/dsf/capture.test.mjs
```

The Nx equivalents are `npx nx run manufacturing-tools:generate-dsf-capture` and `npx nx run manufacturing-tools:test-dsf-capture`. On the Windows plant PC, `npx nx run manufacturing-tools:export-dsf-capture` launches the same PowerShell script from a checkout. The standalone PowerShell artifact also works without Node or an Nx checkout.

`buildCaptureSql(options)`, `buildPowerShell(options)` and `writeGeneratedArtifacts(directory, options)` are exported for verification or an intentionally bounded alternate capture. Options are:

```js
{
  sources: [{ name, sourceId, opId, lineId, whiteboardId /* optional UUID */ }],
  window: { start, end, cutoff, timezone }, // ISO timestamps require explicit offsets
  rowLimit: 10000,
  inventoryLimit: 5000,
  catalogLimit: 10000
}
```

Detailed selections are limited to 25 sources and a 48-hour maximum window. The historical defaults remain the reproducible baseline. Changing a capture window must not be presented as a screenshot reconciliation without matching report inputs.

The SQL intentionally uses `psql` schema guards (`\gset`/`\if`), so run it with `psql`, rather than pasting it unchanged into a generic SQL editor. Set `DSF_CAPTURE_TEST_DATABASE_URL` to an explicitly selected test PostgreSQL database to enable the optional PostgreSQL fixtures; tests use isolated temporary schema data and do not connect to the plant by default.

The durable source relationships and unresolved formulas are documented in [DSF_DATABASE_REFERENCE.md](../../../docs/manufacturing/DSF_DATABASE_REFERENCE.md), with acceptance coverage in [DSF_CAPTURE_PLAN.md](../../../docs/manufacturing/DSF_CAPTURE_PLAN.md). Preserve source UUIDs, reason-row IDs and referenced rate-history IDs; do not replace them with display names, reason business codes or the current nominal standard.
