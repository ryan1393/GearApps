# GearApps — notes for AI assistants

- Nx monorepo. Apps in `apps/`, libraries in `libs/{shared,api,client}`. Import via `@gearapps/...` path aliases only.
- UI is **Dana UI** (`vendor/dana-ui`, imported as `@dana/ui`). Do not add PrimeNG/Material; build screens from Dana classes and directives, add layout-only CSS in the component.
- API: NestJS 11 + TypeORM 1.x. Use `BaseCrudService` / `crudController()` from `@gearapps/api/core` for new entities; keep DTOs in `libs/api/data-access` with class-validator + Swagger decorators. Never interpolate values into SQL — use QueryBuilder parameters.
- Keep existing API paths backwards compatible (external collectors post to them).
- Shared types live in `libs/shared/domain` and are the single source of truth for both sides.
- Config comes from `.env` via `@gearapps/api/core` `configuration.ts` + Joi schema. Add new settings there, and to `.env.example`.
- Verify with `npx nx run-many -t lint test build` before opening a PR.
