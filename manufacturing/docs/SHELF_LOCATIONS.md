# Summary Shelf Locations

> **Current rule (70.1.0):** Cuttergrind shelves are numbered physical shelves configured in Admin:
> rough `CGRR-###`/`CGRP-###`, dull `CGDR-###`/`CGDP-###`, finished `CGFR-###`/`CGFP-###` (RING/PINION).
> The `CGD?-<summary>` / `CGF?-<summary>` tags described below are legacy and are rejected for new
> placements. Green Shed shelves remain `GSR-<summary>` / `GSP-<summary>`.


Shelf tags are derived from the part summary number.

| Tag | Meaning | Department | Stored location number |
| --- | --- | --- | --- |
| `GSR-<summary>` | Green Shed RING intact-cutter shelf | `GREENSHED` | summary number |
| `GSP-<summary>` | Green Shed PINION intact-cutter shelf | `GREENSHED` | summary number |
| `CGDR-<summary>` (RING) / `CGDP-<summary>` (PINION) | Cuttergrind dull shelf | `CUTTERGRIND` | summary number |
| `CGFR-<summary>` (RING) / `CGFP-<summary>` (PINION) | Cuttergrind finished shelf | `CUTTERGRIND` | summary number |

Empty trays are intentionally not listed as a shelf type. A tray with stage `EMPTY` and 0 blades may have no active location assignment and is considered **Available / Ready to Use**.

For summary `1010`:

```text
GSR-1010   (RING)
GSP-1010   (PINION)
CGDR-1010
CGFR-1010
```

## Enforced workflow

- coated/finished tray return must use `CGFR-<summary>` (RING) / `CGFP-<summary>` (PINION);
- Cutter Builder teardown must return dull blades to `CGDR-<summary>` (RING) / `CGDP-<summary>` (PINION);
- the teardown tray does not need a location before use; if teardown returns blades, the tray receives the cutter Summary + Part Type and must go to the matching dull shelf; if every blade is scrapped, the tray remains/returns `EMPTY` and unlocated;
- intact Green Shed changeover must return RING cutters to `GSR-<summary>` and PINION cutters to `GSP-<summary>`;
- a shelf tag must match the build/tray summary;
- the API is authoritative even when the UI performs the same validation.

The shared parser/builder is in `libs/shared/util-constants/src/lib/shelf-location.constants.ts`.

## Tools

Validate all three shelves for a summary:

```powershell
.\tools\test-shelf-location-conventions.ps1 -SummaryNumber "1010" -PartTypeCode RING
```

Preview missing shelf creation:

```powershell
.\tools\ensure-summary-shelf-locations.ps1 -SummaryNumber "1010" -PartTypeCode RING
```

Create missing shelf records only after reviewing preview output:

```powershell
.\tools\ensure-summary-shelf-locations.ps1 -SummaryNumber "1010" -PartTypeCode RING -Execute
```

## Legacy Summary shelf conversion

Current/new Summary shelf tags always contain a dash between the location type and Summary. To audit a development database without changing data:

```powershell
commands\MIGRATE-SUMMARY-SHELF-TAGS.cmd
```

or:

```powershell
npm run migrate:summary-shelves
```

The migration recognizes legacy `G<summary>`, `GSR<summary>`, `GSP<summary>`, generic `CGD-<summary>` / `CGF-<summary>`, and older undashed Cuttergrind rows. It renames safe rows to `GSR-<summary>`, `GSP-<summary>`, `CGDR-<summary>` (RING) / `CGDP-<summary>` (PINION), or `CGFR-<summary>` (RING) / `CGFP-<summary>` (PINION). Generic legacy `G<summary>` still requires an unambiguous RING/PINION inference. Collisions or ambiguous rows are reported as `REVIEW` and are never guessed.

To apply only safe conversions from npm:

```powershell
npm run migrate:summary-shelves:apply
```

`commands\MIGRATE-GREENSHED-SHELVES.cmd` and the old `migrate:greenshed-shelves` npm aliases remain for compatibility and now invoke the same unified migration.

