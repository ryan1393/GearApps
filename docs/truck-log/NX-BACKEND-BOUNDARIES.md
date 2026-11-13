# Truck Log Nx Backend Boundaries

## Purpose

Truck Log keeps deployable processes in `apps/` and backend implementation code in `libs/`.

## Current server boundary

```text
apps/
└─ truck-log-server/
   ├─ src/
   │  ├─ main.ts
   │  └─ app/
   │     └─ app.module.ts
   ├─ project.json
   ├─ tsconfig.app.json
   └─ webpack.config.js

libs/
└─ truck-log/
   └─ server/
      ├─ project.json
      └─ src/
         ├─ index.ts
         └─ lib/
            ├─ truck-log-server.module.ts
            ├─ data-access/
            │  └─ entities/
            ├─ infrastructure/
            │  └─ truck-log-upload.module.ts
            ├─ health/
            ├─ docks/
            ├─ settings/
            ├─ reference-data/
            ├─ scheduled-loads/
            └─ visits/
```

## Responsibilities

### `apps/truck-log-server`

The application is the deployable composition root only:

- process bootstrap (`main.ts`);
- global API prefix and CORS bootstrap;
- imports the server implementation through `@truck-log/server`.

It must not own feature controllers, business services, DTOs, TypeORM entities, or upload configuration.

### `libs/truck-log/server`

The server library owns:

- NestJS feature modules;
- controllers and services;
- DTO validation;
- TypeORM entity classes;
- database/module composition;
- document upload configuration;
- workflow implementation.

The public entrypoint exports only `TruckLogServerModule` so application code does not depend on internal feature files.

### `libs/truck-log/shared/contracts`

Workflow statuses and directions are canonical shared contracts. The backend no longer maintains a duplicate `visit-statuses.ts`.

### `apps/rxo-integration`

RXO remains an independently running application because it has its own Docker/Playwright lifecycle and recurring schedule. Its consolidated acquisition/filter/export runtime is not part of this refactor.

## Build strategy

The NestJS application is bundled with Nx Webpack so the app can consume workspace libraries through TypeScript path aliases without changing the established runtime entry:

```text
dist/apps/truck-log-server/src/main.js
```

`START-TRUCK-LOG.cmd` therefore keeps the same compiled API entry contract.

## Guardrails

Run:

```text
npm run test:server-boundaries
npm run validate:all
```

The boundary contract rejects backend implementation files being moved back into `apps/truck-log-server/src/app`.
