# Cutter-body blade rules

One authority decides a cutter body's blade capacity and whether it can take a tray:
`libs/manufacturing/shared/util-constants/src/lib/cutter-body-compatibility.constants.ts`.
The API (Cutter Builder build, tray validation, inventory availability) and the browser apps all
call it. The base-data tools carry a JavaScript mirror (`tools/manufacturing/base-data/blade-requirement-plan.mjs`)
whose test compares it with the TypeScript file.

## Approved rules

| Body rule | Condition | Total blades | Stored matched sets |
|---|---|---|---|
| 064 Standard | | 22 | 11 |
| 076 Standard | | 26 | 13 |
| 088 Standard | | 34 | 17 |
| 105 Standard | | 38 | 19 |
| 105 Special | body size 105 **and** 8th Dana S/N character is `8` | 26 | 13 |

## Units

`cutter_blade_requirements.required_blade_count`, tray `blade_count` / `required_blade_count` and
coater container sets count **matched inner/outer blade sets**: a tray count of 13 is 13 inner and
13 outer blades, 26 in total (see [Coater RPA](COATER_RPA.md)). The approved totals are therefore
twice the stored value. Stored values are never doubled, and physical tray, grinder and history
quantities are never converted. Screens show both units, for example `19 sets · 38 blades`.

The requirement API accepts only an approved set count (11, 13, 17 or 19). A total such as 38 is
refused rather than guessed.

## Dana S/N decoding

Only the Dana S/N is decoded; the MF/manufacturer serial is never used for capacity. The serial is
trimmed and upper-cased exactly as it is stored; no character is removed, so positions cannot shift.

| Position | Meaning |
|---|---|
| 1 | Cutter head |
| 2 | Manufacturer/supplier |
| 3 | Left/right hand |
| 4 | Blade family |
| 5–7 | Body size (`064`, `076`, `088`, `105`, leading zeros kept) |
| 8 | Special rule (`8` on a 105 body = 105 Special) |

A body is **unresolved** (no capacity, cannot be built) when it has no Dana S/N, the Dana S/N is
shorter than 8 characters, contains anything other than letters and digits, has an unsupported size,
or conflicts with its linked body definition (size, hand, blade family, supplier or head).
Admin > Cutter Bodies shows the decoded fields, the body rule and Required Blades read-only on each card.

## Summary Body Size Rule

Required blade quantity belongs to the Summary: its RING and PINION rows always carry the same
quantity, and changing one moves the other. Part Type rows stay separate; handedness and blade labels
are not inferred from Part Type (for example 30538 and 30588 PINION use LH IB + RH IB, HOS LH).

Admin > Part Summaries shows each Summary's Body Size Rule and its Required Blades (read-only):

- **Configured** — set in Admin (table `cutter_summary_body_rules`). The rule controls the quantity
  for every existing Part Type row; a quantity edit that disagrees is refused. Missing Part Type
  rows are not created and tray snapshots are not changed; the response reports trays that still
  hold another quantity.
- **From quantity** — no rule configured and the quantity fits one rule (22, 34 or 38 blades).
- **Unresolved** — 26 blades fits both 076 Standard and 105 Special. A 26 is never turned into a
  body rule on its own. Cutter Builder accepts either body for such a Summary and shows a warning
  until an administrator sets the rule.

With a configured rule, Cutter Builder requires that exact body rule: equal quantities do not make
076 Standard and 105 Special interchangeable. The API enforces this; the screen only mirrors it.

## Base-data import

Each row of `tools/manufacturing/base-data/data/cutter_blade_requirements.json` must state
`Blade_Quantity_Unit`: `MATCHED_SETS` (the original workbook, 11/13/17/19) or `TOTAL_BLADES`
(Blade sheet cope.xlsx Sheet2, 22/26/34/38, stored as half). A row without a unit stops the import.

- Blank or zero rows are skipped and reported; the existing requirement stays (32209 keeps 34 blades).
- RING/PINION rows of one Summary that disagree are skipped for review.
- A requirement row never creates a Summary; master scope comes from `summaries.json` and
  `summary_additions.json`.
- A configured Summary Body Size Rule wins; a conflicting row is reported and not applied.
- Re-running the import writes the same values.

## Audit and the proposed special-105 mappings

```bash
npm run audit:cutter-blade-rules                 # read-only report of the current database
npm run apply:proposed-special-105               # optional, see below
```

The audit lists requirement quantities, Summaries whose rule is unresolved or conflicting, bodies
whose Dana S/N is missing, malformed or conflicts with their definition, and trays whose snapshot
differs from the current requirement. It changes nothing.

`apply:proposed-special-105` sets 105 Special for 30131, 30132, 30133 and 30136 (the October 2
workbook review, model 286 = workbook model 80). These are workbook inferences, not physical serial
checks, so run it only if you accept them. Each Summary is changed only when it exists, its model is
286, every requirement row is 13 sets and it has no configured rule; anything else is reported and
left alone. It writes rule rows only and is safe to repeat.
