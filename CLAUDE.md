# GearApps — notes for AI assistants

- Nx monorepo. Lapper apps in `apps/`, libraries in `libs/{shared,api,client}`; manufacturing apps/libs in `manufacturing/`. Run all npm/Nx commands from the root. Import via `@gearapps/...` path aliases only.
- UI is **Dana UI** (source `libs/shared/dana-ui`, built package `vendor/dana-ui/package`, imported as `@dana/ui`). Do not add PrimeNG/Material; build screens from Dana classes and directives, add layout-only CSS in the component.
- API: NestJS 11 + TypeORM 1.x. Use `BaseCrudService` / `crudController()` from `@gearapps/api/core` for new entities; keep DTOs in `libs/api/data-access` with class-validator + Swagger decorators. Never interpolate values into SQL — use QueryBuilder parameters.
- Keep existing API paths backwards compatible (external collectors post to them).
- Shared types live in `libs/shared/domain` and are the single source of truth for both sides.
- Config comes from `.env` via `@gearapps/api/core` `configuration.ts` + Joi schema. Add new settings there, and to `.env.example`.
- Verify with `npx nx run-many -t lint test build` before opening a PR.

- One dependency authority: root package.json/package-lock.json. No nested dependency installs. Use Node 24.22.1/npm 11.9.0.
- Manufacturing aliases use `@gearapps/manufacturing/...`. Preserve PostgreSQL workflow transactions and guards.
- All application releases share `GEAR_APPS_VERSION` in `libs/shared/domain`; update with `npm run version:set`.
