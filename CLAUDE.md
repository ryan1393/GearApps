# GearApps — notes for AI assistants

- Nx monorepo. Every application is in root `apps/`; shared/Lapper libraries are in `libs/{shared,api,client}`, and manufacturing domain libraries are in `libs/manufacturing/`. Run all npm/Nx commands from the root. Import via `@gearapps/...` path aliases only.
- There is no `manufacturing/` directory; do not recreate it. Manufacturing code lives in `libs/manufacturing/{frontend,server,shared}` (plus shared app assets in `libs/manufacturing/assets`), its maintenance scripts and source contracts in `tools/manufacturing/`, its docs in `docs/manufacturing/`, and the Windows/Linux launchers in root `commands/`. Every script runs from the repository root.
- UI is **Dana UI** (source `libs/shared/dana-ui`, built package `vendor/dana-ui/package`, imported as `@dana/ui`). Do not add PrimeNG/Material; build screens from Dana classes and directives, add layout-only CSS in the component.
- One API: `gear-app-server` in `apps/server` serves every web client and Lapper Read on port 3333. Keep one authentication service, default JWT guard, database connection and `.env` configuration. Do not restore the removed standalone Lapper server or signing key.
- API: NestJS 11 + TypeORM 1.x. Lapper controllers use `CrudService` contracts / `crudController()` from `@gearapps/api/core`; `@gearapps/api/postgres` supplies their shared-connection implementations. Keep DTOs in `libs/api/data-access` with class-validator + Swagger decorators. Never interpolate values into SQL — use bound parameters.
- Keep existing API paths backwards compatible (external collectors post to them).
- Shared types live in `libs/shared/domain` and are the single source of truth for both sides.
- Shared API configuration and validation live in `libs/manufacturing/server/util-common/src/lib/config`. Add new settings there and to `.env.example`; scanner settings also have the feature loader in `@gearapps/api/core`.
- Verify with `npx nx run-many -t lint test build` before opening a PR.

- One dependency authority: root package.json/package-lock.json. No nested dependency installs. Use Node 24.22.1/npm 11.9.0.
- Manufacturing aliases use `@gearapps/manufacturing/...`. Preserve PostgreSQL workflow transactions and guards. Preserve existing manufacturing API paths, database schema, transaction locks, authentication safeguards and inventory rules.
- Also run `npm test` and `npm run test:contracts` at the root. Live database tests need a dedicated test database and `GEAR_APPS_ALLOW_TEST_ACCOUNTS=YES`.
- All application releases share `GEAR_APPS_VERSION` in `libs/shared/domain`; update with `npm run version:set`.
