# Coater containers and staging

Ground blades travel to the coater in **coater containers**. A container holds exactly **one complete
set**: the full blade quantity of one Summary and part type, for example 13 inner and 13 outer.

## After grinding

When a grinding pass leaves a tray full, the Grinding screen asks where the blades go.

| Choice | What happens |
| --- | --- |
| **Into a coater container** (default) | Scan an empty container. The set moves out of the tray into the container, and the tray becomes `EMPTY` and goes back to the reusable pool. |
| **Stay in the tray** | The blades stay in the tray, which waits for the coater. Move them into a container later on **Load Container**. |

Either way the container or tray goes to a location:

- **`COATER-STAGING`**, the coater staging area. This is the default, so nothing needs scanning. The location is created automatically at startup (department `CUTTERGRIND`, type `STAGING`).
- **A rough shelf bin** (`CGRR-A1A` for RING, `CGRP-A1A` for PINION), if the operator picks **Use a rough shelf instead** and scans it.

A short tray (fewer blades than the set) stays in its tray with no location. It needs replacement blades and another grinding pass.

## Load Container

For a full, ground tray left in its tray, scan an empty container, then the tray. The set moves into the container and the tray empties. The container takes the tray's place: `COATER-STAGING`, or the tray's rough shelf bin.

## Shipping and receiving

1. **Coater Shipments**: add packed containers, review, print and dispatch as before. On the packing slip and RPA, each container's set counts as one tray.
2. **Receive From Coater**: scan the container, then **any empty tray**, then a finished shelf bin (`CGFR-A1A` / `CGFP-A1A`). The set goes into that tray, which becomes `READY_FOR_CUTTER` on the shelf. The container is empty and reusable.

Trays packed whole into a container before this change still ship and receive the old way, by scanning each tray out.

## Undo

Grinding into a container, loading a container, and receiving a set can each be reversed with **Cancel Last** on the tray, until later activity (such as dispatch) depends on them.

## Data

- `container_sets`: one active row per container. It holds the Summary, part type, set size, grinding date, the tray the set came from, and where the container sits (`location_id`).
- `container_set_blades`: the blades in each set, with at most one active set per blade.

Both tables are created additively at startup and are covered by the Cancel Last journal and the coater inventory lock.
