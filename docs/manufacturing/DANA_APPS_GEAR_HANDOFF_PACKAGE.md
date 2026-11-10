> GearApps 70.3.0 uses one repository workspace. Run `npm run package:release` from the repository root to create `releases/GearApps-70.3.0.zip`. Both legacy PowerShell packaging entry points delegate to `tools/package-release.mjs` at the root and package the complete workspace. The earlier Dana Apps baseline and Robocopy staging notes below are retained as historical context; the current Node packager applies the source and sensitive-file policy directly to archive entries.

# Dana Apps — Source Handoff Package

Dana Apps V70.0.0 uses the maintained one-click safe source packaging workflow before Truck Log is imported into the monorepo.

Preferred command:

`PACKAGE-DANA-APPS-SOURCE.cmd`

The legacy `PACKAGE-GEAR-FOR-DANA-APPS.cmd` wrapper may remain temporarily for compatibility, but new Dana Apps workflows should use the preferred command.

The handoff workflow regenerates and validates the live merge manifest, validates source-package hygiene and completeness, packages only through the maintained staged safe packager, creates a merge-ready ZIP, and writes SHA-256 metadata for both the ZIP and merge manifest.

The produced ZIP is the preferred Dana Apps source input for the Dana Apps + Truck Log merge.
