# Dana Apps — Gear Merge Manifest

`DANA_APPS_GEAR_MERGE_MANIFEST.json` is generated from the live confirmed Gear workspace.

It exists so the future Truck Log merge can compare against the real Gear baseline instead of an older source archive.

The manifest intentionally contains structural information only:

- Nx project names, roots, tags, and target names
- protected Gear runtime project identities
- selected framework/dependency versions
- root configuration SHA-256 values
- root Compose filenames and SHA-256 values when present
- authoritative Gear test entry point
- Dana master UI / Gear pre-merge / package-hygiene document locations

It does **not** contain environment-variable values, database credentials, passwords, browser state, or other secrets.

## Refresh rule

If a merge-critical Gear project configuration, package lock, root Nx/TypeScript configuration, or Compose file intentionally changes before the Truck Log merge, regenerate the manifest with:

`node tools/generate-dana-apps-gear-merge-manifest.mjs`

The authoritative Gear test suite validates that the checked-in manifest matches the live workspace.
