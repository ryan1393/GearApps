# Gear Apps Architecture

## Deployable applications

Gear Apps has four deployable Nx applications:

```text
apps/
├── blade-tracking/   Angular frontend
├── cutter-builder/   Angular frontend
├── greenshed/        Angular frontend
└── server/           NestJS API
```

Frontend business logic is separated into `libs/frontend/*` feature/data-access libraries. Backend domains are separated into `libs/server/*`. Shared types, constants, and utilities live under `libs/shared/*`.

## Runtime

```text
Blade Tracking :4200 ─┐
Cutter Builder :4201 ─┼─> NestJS API :3333 ─> PostgreSQL :5432
Green Shed     :4202 ─┘
```

All three Angular development servers proxy `/api` to the NestJS API.

## Business domains

### Blade Tracking

Tracks blade trays through grinding, coating/container handling, and physical locations.

### Cutter Builder

The application used for cutter build and teardown work. **Cutter Builder is an app name, not a department.**

The physical/business department remains **Cuttergrind**, represented operationally as `CUTTERGRIND`.

### Green Shed

Tracks built cutters on machines, FC/CMM checks, piece counts, pulls, intact changeovers, and machine/shelf state.

## Shelf model

Summary-based shelves are canonical:

- `GSR-<summary>` — Green Shed RING intact-cutter shelf.
- `GSP-<summary>` — Green Shed PINION intact-cutter shelf.
- `CGDR-<summary>` (RING) / `CGDP-<summary>` (PINION) — Cuttergrind dull shelf.
- `CGFR-<summary>` (RING) / `CGFP-<summary>` (PINION) — Cuttergrind finished shelf.

See `SHELF_LOCATIONS.md`.

## Data migration

Base/master data and legacy cutter history are separate migration workflows. Base-data import does not silently import unrelated transactional history.

See `MIGRATION.md`.

## API

The maintained route manifest is `tools/api-route-manifest.json`. The master API probe targets 113 declared routes. Generated Swagger JSON is not committed; the server can regenerate it when configured.

## PINION/RING production compatibility

Green Shed setup has two independent server-side compatibility gates. The selected part must have the same Summary and Part Type as the cutter build. The selected machine must also match the build Part Type: `PINION` → `PINION CUTTING`; `RING` → `GEAR CUTTING`. Cross-type part numbers and cross-type machines are rejected before a machine run is created.
