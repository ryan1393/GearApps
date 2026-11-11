# Gearset master and relationships

How gearsets are stored and used in this repository, checked against a live database built by
the repository's own bootstrap (`dist/apps/server-bootstrap`) and base-data import. Run
`npm run audit:gearsets` (read-only) to see the same facts for any database.

## Schema

`public.gearsets` (DDL: `libs/shared/database/src/lib/gearset-schema.ts`, migration
`20261109-shared-gearset-schema-v1`, `CREATE TABLE IF NOT EXISTS`, so an existing table from an
earlier Gear Apps database is kept as it is):

| Column | Meaning |
|---|---|
| `id` uuid PK | Assembly identity. History (`lapper.gearsets.public_gearset_id`) points here. |
| `gearset_part_id` uuid **UNIQUE** → `parts` | The gearset number: a `parts` row of type `GEARSET` (reference part). |
| `ring_part_id` uuid → `parts` | RING part. **Not unique**: a ring may be in several gearsets. |
| `pinion_part_id` uuid → `parts` | PINION part. **Not unique**: a pinion may be in several gearsets. |
| `summary_id` uuid → `part_summaries` | The assembly's Summary. **Not unique.** |
| `ratio_value` numeric(10,4), `ratio_text` | Ratio from the tooth counts, e.g. `3.45 (38-11)`. |
| `customer`, `application`, `cut` | Master data, stored as given. |
| `statuses` text[] | **Business** classification (Production, Service, …). |
| `active`, `enabled`, `archived_at` | Whether the record is usable. |

All foreign keys are `ON DELETE RESTRICT`. Deferred guard triggers require GEARSET/RING/PINION
roles, positive ring and pinion tooth counts, and the GEARSET part's Summary to equal the
assembly's Summary. Tooth counts live on the RING/PINION `parts` rows (`parts.teeth`); the model
comes from the Summary (`part_summaries.model_id`, one model per Summary). There is no models
array, no per-gearset tooth columns and no source_requirement / required_blades / body_rule_hint
/ source_row column; blade requirements are per Summary + Part Type in
`cutter_blade_requirements` (matched sets).

`lapper.gearsets` holds collector-reported numbers and Lapper's own `rev`/`status` override; a
complete assembly is linked through `public_gearset_id`.

## Shared relationships

A Summary, ring or pinion may belong to several gearsets; RING and PINION roles stay distinct.
Example (verified live): gearsets 10060460 (ring 10060462) and 10161958 (ring 10161959) both use
Summary 30634 and pinion 10060466, and both stay linked.

## Status and archive

- `status` returned by the gearset API is active/inactive: `active AND enabled AND archived_at IS
  NULL`, then Lapper's own override. **Business statuses** are returned separately as
  `business_statuses` and never change usability: a Service gearset stays active.
- Admin > Gearsets → Edit → Inactive writes only Lapper's override. The assembly row, its business
  statuses and its ring/pinion/gearset parts are unchanged, so a pinion shared with another gearset
  stays usable.
- An archived assembly (`archived_at` set) reads as inactive and keeps its parts, links and
  history; no code in this repository sets `archived_at` and none archives linked parts.
- Assembled gearsets cannot be deleted (409); only collector-only numbers can.

## Imports

No importer in this repository writes `public.gearsets`. The base-data importer writes RING and
PINION parts (`gears.json`, `pinions.json`). An explicit `npm run import:base-data` refreshes
reference values but:

- never re-enables or reactivates an existing Summary, part, roll master or blade requirement;
- never changes the Summary, type or teeth of a part used by a gearset (it reports `[KEEP]`);
- creates no duplicates; a second run changes nothing.

Automatic deploys (`--bootstrap-only`) import only into an empty database. A historical seed's
`hard_reset_test_data` flag is not read by any tool here; `npm run audit:gearsets -- --seed <file>`
compares a seed with the database and lists its rules without applying anything.

## Cutter blades

A gearset reaches the blade rules only through its Summary: the Summary's RING and PINION
requirement rows and its Body Size Rule (see [CUTTER_BODY_BLADE_RULES.md](CUTTER_BODY_BLADE_RULES.md)).
Tooth counts are never used for blade quantities. A 26-blade Summary stays unresolved (076
Standard or 105 Special) until its rule is set; the audit lists gearsets whose Summary is
unresolved or has no requirement.
