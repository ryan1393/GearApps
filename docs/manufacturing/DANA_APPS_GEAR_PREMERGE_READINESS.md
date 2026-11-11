# Dana Apps — Gear Domain Pre-Merge Readiness

> **Superseded in 70.2.0.** MeshForge styling now lives in @dana/ui (Dana UI). The paths below
> (`libs/shared/ui-tailwind`, `libs/gear/ui`) no longer exist; see the "Styling (Dana UI)" section
> of the README. This file is kept for history.


MeshForge V69.3.0R1 marks the Gear side as ready to be imported into the Dana Apps monorepo without changing Gear business behavior.

## Protected Gear domain

Runtime applications:

- `apps/blade-tracking`
- `apps/cutter-builder`
- `apps/greenshed`
- `apps/server` (Nx project name remains `gear-app-server` for now)

The physical `apps/server` path is deliberately not renamed during pre-merge hardening. A path rename can happen later after the combined Dana Apps workspace is green.

## Master UI

The Gear side consumes the frozen Dana master UI defined by `DANA_MASTER_UI_BASELINE.md`.

Required order for all three Gear frontends:

1. application/Tailwind entry
2. `libs/shared/ui-tailwind/src/styles/meshforge.css`
3. `libs/gear/ui/src/styles/gear-features.css`

Dana shared UI owns reusable presentation and interaction primitives. Gear workflow presentation remains Gear-owned.

## Merge invariants

- Gear database/schema/data remain separate from Truck Log.
- Gear business workflows remain unchanged during the repository merge.
- Existing Gear ports and runtime behavior are preserved initially.
- `npm run test:meshforge` remains the authoritative Gear regression gate inside the future Dana Apps release gate.
- No npm install is required for this readiness patch.
- `package-lock.json` must remain unchanged.
- Truck Log may consume Dana shared UI but does not take ownership of Gear workflow styles.
- The future monorepo may contain Truck Log paths; this Gear readiness contract only protects Gear-domain requirements and does not reject other domains.

## Merge sequence

1. Keep this Gear baseline green.
2. Import the newest confirmed-green Truck Log/RXO source.
3. Reconcile root Nx/package/TypeScript configuration.
4. Normalize root Docker Compose and dependency/lockfile behavior.
5. Add the authoritative `npm run test:dana-apps` gate.
6. Migrate Truck Log onto the frozen Dana master UI without rewriting Truck Log business workflows.
