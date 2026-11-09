# Migration and Data Carryover

All Gear Apps import/export tooling and bundled migration data live under `tools/`.

## Base/master data

```text
tools/base-data/
├── export-legacy-base-data.ps1
├── restore-legacy-base-data.ps1
├── import-base-data.mjs
└── data/                       bundled/exported base-data snapshots, when present
```

Export approved reference/master data from the restored legacy SQL Server source with:

```powershell
.\tools\base-data\export-legacy-base-data.ps1
```

For the combined legacy base-data restore workflow:

```powershell
.\tools\base-data\restore-legacy-base-data.ps1
```

Import with:

```powershell
npm run import:base-data -- <export-directory>
```

The base-data importer does not silently carry unrelated operational history.

## Cutter history

```text
tools/cutter-history/
├── export-cutter-history-FRESH-SAFE.ps1
├── import-cutter-history-DYNAMIC-FAST-AUDITED.mjs
└── data/                       bundled/exported cutter-history snapshots, when present
```

Export:

```powershell
.\tools\cutter-history\export-cutter-history-FRESH-SAFE.ps1
```

Import:

```powershell
npm run import:cutter-history
```

The exporter is read-only against the legacy SQL Server source and validates the export before promotion.


## Naming during migration

- **Cutter Builder** is the current app name.
- **Cuttergrind** remains the physical/business department.
- Operational department/location tagging uses `CUTTERGRIND`.
- Legacy descriptive master data may still display `CUTTER GRIND`.

## Cutter reference workbook base data

The cleaned cutter reference workbook is stored at:

```text
tools/base-data/source/cutter-body-info-BASE-DATA-READY.xlsx
```

The workbook is converted into the JSON files consumed by the normal base-data importer:

- `summary_additions.json` — 15 summaries that were missing from the legacy summary export. They are inserted active/enabled and may be disabled later if confirmed obsolete.
- `cutter_blade_requirements.json` — 216 unique Summary + Part Type blade-count requirements.
  A requirement with a blank `Summary_Rev` applies to **every** enabled revision of that Summary (blade counts are the same across revisions). An explicit revision, or `(blank)` for exactly the blank revision, limits it to that one.
- `cutter_bodies.json` — 120 unambiguous cutter serial to manufacturing serial mappings.

Sixteen ambiguous cutter-body rows remain in the workbook's `cutter_bodies_REVIEW` sheet and are deliberately **not imported** until their duplicate serials are resolved.

Validate the cutter reference data without changing the database:

```powershell
npm run validate:base-data
```

Import all normal base/master data plus these cutter-reference additions:

```powershell
npm run import:base-data
```

The import is transactional and idempotent. Existing summaries are reused, the 15 missing summaries are added, blade requirements are upserted by Summary + Part Type, and cutter bodies are upserted by cutter serial.

## Cutter-body reference mapping

- `Dana_Serial` → `cutter_bodies.serial_number` (unique scanner key)
- `MF_Serial` → `cutter_bodies.mf_serial_number` (reference only)

## Cutter-body definitions and blade requirements

The base-data import now includes:

- `cutter_body_definitions.json` → `cutter_body_definitions`
- `cutter_bodies.json` → physical cutter bodies linked by `definition_id`
- `cutter_blade_requirements.json` → `cutter_blade_requirements`

`cutter_body_definitions` describes the cutter design decoded from the Dana serial convention: supplier, hand, blade family, and size family. Physical cutter identity remains in `cutter_bodies`.

Blade requirements remain unique by `(summary_id, part_type_id)` and store the required blade quantity for each Summary + Part Type combination.

## Cutter-body serial schema transition

During base-data import, any legacy `cutter_bodies.serial_number` value is first copied to `dana_serial_number`, and any temporary `manufacturing_serial_number` value is copied to `mf_serial_number`. The old columns are then removed.

Removing the legacy `serial_number` column is required because it was non-nullable and would otherwise block insertion of an unetched cutter body that legitimately has only an MF/manufacturer serial.

## Part and machine compatibility after migration

Legacy gears import as `RING` parts and legacy pinions import as `PINION` parts. Machine department assignments are retained from the source base data. Runtime setup uses those classifications: `RING` builds require `GEAR CUTTING` machines and `PINION` builds require `PINION CUTTING` machines. The application does not reinterpret a RING part as PINION or vice versa.

## Authentication and automatic import upgrade

The additive startup migration adds `users.passwordResetTokenHash`,
`users.passwordResetExpiresAt`, and `users.authVersion` with an initial version of zero.
Existing sessions and legacy recovery links require renewal. Startup keeps
`DATABASE_SYNCHRONIZE=false` for existing databases. Automatic deployment uses
`--bootstrap-only` to preserve operational master-data edits; manually running the normal
base-data importer still intentionally updates matching records from its snapshot.
