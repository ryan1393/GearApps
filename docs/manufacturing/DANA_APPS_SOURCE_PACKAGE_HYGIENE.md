> MeshForge 70.3.0 uses one repository workspace. Run `npm run package:release` from the repository root to create `releases/MeshForge-70.3.0.zip`. Both legacy PowerShell packaging entry points delegate to `tools/package-release.mjs` at the root and package the complete workspace. The earlier Dana Apps baseline and Robocopy staging notes below are retained as historical context; the current Node packager applies the source and sensitive-file policy directly to archive entries.

# Dana Apps Source Package Hygiene

MeshForge V69.3.5 hardens the source-packaging rules that Dana Apps should carry forward.

## Why

A development checkout may legitimately contain machine-local files and historical trees that must never become part of a handoff or release ZIP. The packaging workflow stages source into a short temporary path, excludes historical archives and junctions, removes blocked files, audits the staged copy, and only then creates the archive.

## Always excluded from source packages

- `node_modules`
- `.nx`
- `.git`
- `dist`
- `build`
- `coverage`
- `_patch_backups`
- `_archive`
- `.angular`
- `.cache`
- `runtime-data`
- filesystem junctions/reparse trees followed by Robocopy (`/XJ`)
- existing ZIPs and log files
- `.env` and non-template `.env.*`
- `.npmrc`
- private key / certificate containers such as `.pem`, `.key`, `.pfx`, `.p12`, `.jks`, `.keystore`, `.kdbx`
- common credentials/secrets JSON files
- RXO/browser/auth/cookie state JSON files
- local SQLite/DB files
- files stored under obvious `secret`, `secrets`, `credential`, or `credentials` directories

## Allowed environment templates

The following may remain because they are templates rather than live credentials:

- `.env.example`
- `.env.sample`
- `.env.template`

## Windows path hardening

The packager uses a short `%TEMP%\DAP-<id>` staging root. Historical `_archive` trees and junctions are excluded before the sensitive-file audit so old deep backup paths cannot break the handoff package.

## Robocopy exit-code handling

Robocopy return codes `0` through `7` are successful outcomes. After the packager accepts one of those success codes, it resets `$LASTEXITCODE` to `0` so a calling PowerShell handoff script cannot mistake normal file-copy activity for failure.

## Rule

The working repository may still contain local development configuration and historical archives when needed. The release rule applies to packaged source artifacts: a source ZIP must be produced by the maintained safe packager or an equivalent process that passes the same hygiene checks.

## Nested source-directory preservation

Generated directories are excluded by absolute root path. Bare Robocopy directory-name exclusions are forbidden for names such as `build`, because Dana Apps contains legitimate nested source directories with that name.

Before ZIP creation, the packager compares the live and staged `apps`, `libs`, and `tools` source inventories. Any live source file missing from staging fails the package. Cutter Builder `libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/build/` is explicitly protected.
