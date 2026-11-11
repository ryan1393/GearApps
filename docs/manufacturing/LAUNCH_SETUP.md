# Launch Setup

**Admin > Launch Setup** (in every app, administrators only) gets the floor into MeshForge for the first day. It has four parts.

## 1. Set up

A checklist of what the workflows need, with the count recorded now and a button that opens the Admin tab where it is added: user accounts, grinders, cutter builder machines, production machines, the four kinds of shelves, trays, coater containers, cutter bodies, the default tag printer and Coater RPA.

## 2. Barcode tags in bulk

Makes a run of numbered records and prints a tag for each one.

| What | Barcodes |
|---|---|
| Trays | `T0001`, `T0002`, ... |
| Coater containers | `C0001`, ... |
| Rough shelves | `CGRR-A1A` (ring), `CGRP-A1A` (pinion) (shelf letter, layer number, bin letter; made as a grid of shelves × layers × bins) |
| Finished shelves | `CGFR-A1A`, `CGFP-A1A` (shelf letter, layer number, bin letter; made as a grid of shelves × layers × bins) |
| Dull shelves | `CGDR-A1A`, `CGDP-A1A` (shelf letter, layer number, bin letter; made as a grid of shelves × layers × bins) |

Choose the first number and how many (up to 100 at a time). A number that already exists is not created again; its tag is printed again, so a run can be repeated safely. With no tag printer set up, the tags that could not be printed come down as one file.

## 3. Trays already on the floor

Records a tray that is already ground or already coated on the day the system starts, without replaying grinding and coater history that was never captured.

- Scan the tray, choose its Summary and part type, say where it stands, and scan the shelf it is on.
  - **Ground, waiting for the coater** goes at `COATER-STAGING` or on a rough shelf bin (`CGRR-A1A` / `CGRP-A1A`: shelf, layer, bin).
  - **Coated, ready for a cutter build** goes on a finished shelf bin (`CGFR-A1A` / `CGFP-A1A`: shelf, layer, bin).
- The tray must exist, be empty and not be in a container or a cutter build. It is recorded with the full blade quantity its Summary requires, in the same state the normal workflow would leave it in, so it continues through coater loading or cutter building like any other tray.
- Each entry is journaled. **Cancel Last** in Blade Tracking undoes it.

Everything else uses the normal screens: dull or new blades in **Blade Intake**, a built cutter in **Cutter Builder > Build**, and a cutter on a machine in **Greenshed > Setup**.

## 4. What the system holds now

Trays and blades by stage, and the cutters built and running, so the count on the screen can be compared with the floor.
