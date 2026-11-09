# Dana Apps — Source Handoff Package

Dana Apps V70.0.0 uses the maintained one-click safe source packaging workflow before Truck Log is imported into the monorepo.

Preferred command:

`PACKAGE-DANA-APPS-SOURCE.cmd`

The legacy `PACKAGE-GEAR-FOR-DANA-APPS.cmd` wrapper may remain temporarily for compatibility, but new Dana Apps workflows should use the preferred command.

The handoff workflow regenerates and validates the live merge manifest, validates source-package hygiene and completeness, packages only through the maintained staged safe packager, creates a merge-ready ZIP, and writes SHA-256 metadata for both the ZIP and merge manifest.

The produced ZIP is the preferred Dana Apps source input for the Dana Apps + Truck Log merge.
