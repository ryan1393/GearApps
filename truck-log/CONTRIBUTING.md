# Contributing to Truck Log

Truck Log is maintained as one clean source tree. Do not add patch folders or one-off upgrade scripts; schema changes go in a new numbered migration (see `docs/truck-log/DATABASE-MIGRATIONS.md`).

## Before changing code

Read:

- `README.md`
- `docs/truck-log/ARCHITECTURE.md`
- `docs/truck-log/MAINTAINABILITY.md`
- `docs/truck-log/NX-WORKSPACE.md`
- the feature-specific document under `docs/truck-log/` when one exists.

## Change rules

- Preserve API/database/workflow behavior unless the change explicitly requires new behavior.
- Prefer one-responsibility modules over adding another large section to an existing coordinator.
- Keep database mutations transactional and preserve existing advisory/row locks.
- Keep standard RXO and RXO Expedite independent.
- Never commit `.env`, credentials, browser profiles, runtime PDFs, database files, logs, or build output.
- Add comments for invariants, safety assumptions, compatibility requirements and non-obvious retry behavior; do not narrate obvious code.
- Update feature contract tests when moving code across files. Tests should verify behavior/feature boundaries, not force a feature into one monolithic file.

## Required checks

```text
npm run test:nx-boundaries
npm run audit:maintainability
npm run test:maintainability
npm run validate:release
# On a separate clean extraction, before npm ci:
npm run validate:archive
npm run validate:all
```

For deployment changes, also run a real Docker build/start and health check on a Docker host before promoting the package.

## Release identity

The release is the SemVer string in `VERSION` (currently `1.0.9`), used unchanged by npm, Docker image tags, labels and the UI. `tests/new-host/test-release-version.mjs` lists every copy and fails if one drifts; after changing `VERSION` run `node tools/truck-log/refresh-manifests.mjs`.

## Local development (`nx serve`)

`START-TRUCK-LOG-DEVELOPMENT.cmd` runs the API and web app on your PC against a PostgreSQL you configure in `.env`. Station sign-in would otherwise send every page to `/station/setup`. For local development only, set:

```text
NODE_ENV=development
TRUCK_LOG_DEV_OPEN_STATIONS=true
```

The API ignores `TRUCK_LOG_DEV_OPEN_STATIONS` unless `NODE_ENV=development`. Docker Compose always runs the server with `NODE_ENV=production`.

Use Node.js 22.12+ or a supported Node.js 24 release for source development. Production dependencies are audited independently with `npm audit --omit=dev`; see `docs/truck-log/DEPENDENCY-SECURITY.md` for the reviewed build-only advisory.
