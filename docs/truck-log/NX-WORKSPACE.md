# Truck Log Nx Workspace

Truck Log is organized as an Nx monorepo. Deployable processes live under `apps/`; reusable implementation lives under focused `libs/` projects. The application projects are composition roots, not feature buckets.

## Workspace map

```text
apps/
  truck-log/                  Angular browser application
  truck-log-server/           NestJS API application
  rxo-integration/            Standard RXO Playwright worker
    src/                       executable entry points
      lib/                     internal worker implementation
  rxo-expedite/               RXO Expedite Playwright worker
    src/                       executable entry points
      lib/                     internal worker implementation

libs/truck-log/
  shared/
    contracts/                Browser/server DTO and workflow contracts

  web/
    data-access/              HTTP/API client boundary
    domain/                   Pure browser domain/form helpers
    ui/                       Shared presentational primitives
    auth/admin/               Admin browser auth/interceptor behavior
    styles/                   Shared/global style entry points
    feature/
      active-trucks/
      admin/
      check-in/
      dashboard/
      dock-board/
      history/
      rxo-control-center/
      rxo-expedite-control-center/
      tv-display/

  server/
    core/                     Nest composition root used by the API app
    data-access/              TypeORM entities and database-owned primitives
    auth/
      access/                 Operator/API access credentials and guard
      admin/                  Admin authorization boundary
      print-agent/            Print Agent credential/guard boundary
    domain/
      driver-print/           Printing orchestration/domain behavior
      rxo/                    Shared RXO locks, SQL and domain rules
    infrastructure/
      sap-documents/          SAP document filesystem/storage adapter
      uploads/                Upload plumbing
    feature/
      docks/
      driver-print/
      health/
      print-agents/
      reference-data/
      rxo-documents/
      rxo-expedite/
      rxo-ingestion/
      scheduled-loads/
      settings/
      tv-displays/
      visits/
```

## Public APIs

Every library exposes one public entry point at `src/index.ts`. Cross-project TypeScript imports must use an `@truck-log/...` alias from `tsconfig.base.json`. Do not import another project's `src/lib/...` implementation path.

Examples:

```ts
import { TruckLogApi } from '@truck-log/web/data-access';
import { CheckInComponent } from '@truck-log/web/feature/check-in';
import { TruckLogServerModule } from '@truck-log/server/core';
import { DriverPrintDomainModule } from '@truck-log/server/domain/driver-print';
```

Relative imports are for files inside the same Nx project only.

## Dependency direction

The allowed direction is deliberately one-way:

```text
shared/contracts
      ^
      |
web: domain/data-access/ui/auth
      ^
      |
web features
      ^
      |
Angular app

shared/contracts
      ^
      |
server: data-access/auth/domain/infrastructure
      ^
      |
server features
      ^
      |
server core
      ^
      |
Nest API app
```

Additional rules:

- Web libraries never import server libraries.
- Server libraries never import web libraries.
- Feature libraries do not import sibling feature libraries.
- Reusable business behavior needed by several server features belongs in `server/domain`.
- Reusable external-system/storage behavior belongs in `server/infrastructure`.
- TypeORM entities and database-owned persistence definitions belong in `server/data-access`.
- Browser features share HTTP access through `web/data-access`, not direct ad-hoc HTTP clients.
- App folders wire projects together and should remain thin.

`tools/truck-log/test-nx-project-boundaries.mjs` enforces these rules and is part of both release validation suites.

## Nx project tags

Projects use tags as searchable architecture metadata:

- `scope:truck-log`
- `platform:web`, `platform:server`, `platform:shared`, or `platform:worker`
- `type:app`, `type:feature`, `type:domain`, `type:data-access`, `type:auth`, `type:infrastructure`, `type:ui`, `type:styles`, `type:contracts`, or `type:core`
- feature/domain-specific `domain:*` tags where useful

The custom boundary test validates both project ownership and dependency direction. This provides the same practical protection as an Nx module-boundary rule without making linting a prerequisite for a fresh runtime deployment.

## Adding a new web feature

Create a focused library under `libs/truck-log/web/feature/<feature>` with:

```text
project.json
src/index.ts
src/lib/...
tsconfig.json
```

Export only the route/component/public types needed by other projects. Add the route import to `apps/truck-log` using the public alias. If code is reusable across features, place it in `web/domain`, `web/ui`, or `web/data-access` instead of importing one feature from another.

## Adding a new server feature

Create `libs/truck-log/server/feature/<feature>` with a Nest module as its public boundary. If another feature needs its business behavior, first extract that behavior into `server/domain/<name>` or an appropriate infrastructure/data-access library; do not create feature-to-feature coupling.

Register the feature module in `server/core`. The Nest application under `apps/truck-log-server` should continue to import only `@truck-log/server/core`.

## Worker applications

Standard RXO and Expedite remain independent Nx application projects because they are independently built Docker workers with different runtime/state/credential behavior. Both follow the same app shape as the TypeScript applications: executable entry points live directly under `apps/<worker>/src`, reusable worker implementation lives under `apps/<worker>/src/lib`, and Docker/operational files stay at the application root. Worker implementation must not drift back into a flat app-root script collection.

Shared concepts are extracted only when the Docker/build boundary can preserve worker independence. The current standard/Expedite auth helper is deliberately byte-identical in both isolated worker contexts; this exception is covered by the maintainability audit rather than hidden as accidental duplication.

## Commands

Useful architecture checks:

```text
npm run test:nx-boundaries
npm run typecheck:workspace
npm run test:maintainability
npm run validate:release
npm run validate:all
```

A structural refactor is not complete until the Nx boundary check, type checking, release checks and existing workflow contracts pass.
