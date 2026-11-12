# RING / PINION HOS, Inner blade and Outer blade

Each Summary has two independent groups of three values, one per Part Type:

| Part Type | Fields |
|---|---|
| RING | RING HOS, Inner blade, Outer blade |
| PINION | PINION HOS, Inner blade, Outer blade |

## Storage and resolution

- Table `public.part_summary_part_type_blades` (migration `20261112-summary-part-type-blades-v1`,
  additive, nothing backfilled): one row per Summary + Part Type, keyed `(summary_id, part_type_id)`.
- View `public.part_blade_settings`: each part's values, read from **its own** Summary and Part
  Type. Parts store no copy. A pair with no row reads blank; nothing is borrowed from the other
  Part Type or another Summary. Moving a part to another Summary or Part Type resolves the new pair.
- The field is the position. A label is stored as written (trimmed, upper-case) and never moved,
  renamed or refused because of its IB/OB suffix or because the two labels have different hands.
- HOS here is workpiece Hand of Spiral for that Summary + Part Type. It is not cutter-body hand
  and adds no cutter-body restriction. The older Summary-level HOS (`part_summaries.hos`) stays
  as it was and is shown as "Summary HOS".

Confirmed values:

| Summary | Part Type | HOS | Inner blade | Outer blade |
|---|---|---|---|---|
| 30538 | RING | RH | RH IB | RH OB |
| 30538 | PINION | LH | LH IB | RH IB |
| 30588 | PINION | LH | LH IB | RH IB (only if 30588 is in approved scope; not applied automatically) |

## Screens

- **Admin > Part Summaries**: each card shows RING and PINION HOS / Inner blade / Outer blade.
  **Edit** opens one form with the Summary fields, both groups, Body Size and a read-only Required
  Blades preview, and one **Save Part Summary** button. The separate per-card Save Rule button is
  gone (the Body Size choice is in the form). Creating a Summary is unchanged; edit it to set the
  groups.
- **Admin > Parts**: each part shows Inner blade and Outer blade of its own Summary + Part Type.
  HOS stays in Part Summaries.

## Save Part Summary

`PUT /api/v1/cutter-config/summary-settings/:summaryId` (admin) saves everything submitted in one
request and one database transaction:

```json
{ "revision": "D",
  "part_types": { "RING": { "hos": "RH", "inner_blade": "RH IB", "outer_blade": "RH OB" },
                  "PINION": { "hos": "LH", "inner_blade": "LH IB", "outer_blade": "RH IB" } },
  "body_rule": "105" }
```

- An omitted field is unchanged; `null` or `""` clears it.
- `body_rule` omitted keeps the current Body Size Rule; a code changes it (the Summary's RING and
  PINION requirement rows follow; global rule totals are not edited); `null` removes it
  (quantities stay). Trays already ground keep their quantity and are reported
  (`open_trays_with_other_quantity`), as before.
- A duplicate number/revision, invalid value or any database failure rolls back the whole save;
  the Admin form keeps the draft and blocks a second submit while saving.
- `GET /api/v1/cutter-config/summary-settings[/:summaryId]` reads both groups and the Body Size
  Rule state. The older `PATCH /api/v1/part-summaries/:id` and `/summary-body-rules` endpoints
  still work.
- The compatibility matrix (`GET /api/v1/cutter-config/body-compatibility`) shows each row's Part
  Type HOS and blades for reference.

## Source import (opt-in)

`tools/manufacturing/base-data/data/summary_part_type_blades.json` holds the 216 raw rows of Blade
sheet cope.xlsx Sheet2 (cell references kept). Positions follow the recorded rule: HOS from the
source HOS column; the one IB label is Inner and the one OB label is Outer (V43 placement kept by
V45); the dual-IB PINION 30538 row is the confirmed Inner LH IB / Outer RH IB. Anything else stays
blank and is reported.

```bash
npm run report:summary-part-type-blades   # dry run: what would be written, kept or skipped
npm run apply:summary-part-type-blades    # write
```

It fills blank fields only (later edits win and are reported), never creates a Summary, skips
30588 and 32414 (out of approved scope) and zero/blank rows (32209, 32414), applies a blank-revision
row to every enabled revision, and is safe to repeat.
