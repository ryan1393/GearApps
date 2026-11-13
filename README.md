# MeshForge 70.10.0

One Nx monorepo contains Lapper, Lapper Read, Blade Tracking, Cutter Builder and
Greenshed. All four web applications and the collector use **one NestJS API on
port 3333**, one authentication service and the same PostgreSQL database.

| Application    | Project / source                                   | Browser port                             |
| -------------- | -------------------------------------------------- | ---------------------------------------- |
| Shared API     | meshforge-server / apps/server        | 3333 (API)                               |
| Plant dashboard (development) | plant-dashboard / apps/plant-dashboard | 4204 |
| Lapper         | lapper-client / apps/lapper-client                 | 4203                                     |
| Blade Tracking | blade-tracking / apps/blade-tracking | 4200                                     |
| Cutter Builder | cutter-builder / apps/cutter-builder | 4201                                     |
| Greenshed      | greenshed / apps/greenshed           | 4202                                     |
| Lapper Read (Docker) | lapper-read-py / apps/lapper-read-py         | Python collector container, see its README |

The root package.json and package-lock.json are the dependency authority. Use
Node 24.22.1 and npm 11.9.0. All clients share [Dana UI](libs/shared/dana-ui).
Application API routes are under /api/v1; health is /api/v1/health/ready.
Every application and its end-to-end project lives under root `apps/`.
Manufacturing libraries are in `libs/manufacturing/`, their maintenance tools in
`tools/manufacturing/`, their documentation in [docs/manufacturing](docs/manufacturing/README.md),
and the Windows/Linux launchers in `commands/`.

## Run the complete stack

Keep your existing root `.env` with its PostgreSQL settings and JWT access/refresh
secrets. For a new installation, use [the template](.env.example). From
the repository root:

```sh
docker compose up -d --build --remove-orphans
```

The root `compose.yml` reads that same `.env`. It builds one
API image shared by the bootstrap jobs and the running API. All four nginx clients
proxy /api to meshforge-server:3333. Keep the existing PostgreSQL volume.

For an existing installation, follow [the unified API upgrade procedure](docs/UNIFIED_API.md).
Build the application source ZIP with `npm run package:release`; it writes
`releases/MeshForge-<version>.zip` and its `.sha256`. Release archives are not committed:
attach them to a GitHub release instead. Earlier archives remain in git history.

Docker dependency stages include Python, Make and a C++ compiler, as required by
[node-gyp](https://github.com/nodejs/node-gyp#on-unix), so native npm
dependencies can build when a prebuilt-binary download fails. These tools are
excluded from the final runtime images. CI forces native compilation and builds
the API and all four web images.

## Develop from the repository root

```sh
nvm use
npm ci
npm run serve:api
# In separate terminals, start the clients you need (all share the same API):
npm run serve:plant-dashboard
npm run serve:lapper-client
npm run serve:blade-tracking
npm run serve:cutter-builder
npm run serve:greenshed
```

Use .env for the shared API. Every development proxy targets
localhost:3333. Keep DATABASE_SYNCHRONIZE=false for an existing PostgreSQL
database. The explicit bootstrap service initializes a new empty database.

All applications sign in through POST /api/v1/auth/email/login and use the same
accessToken/refreshToken response. Account management, password recovery,
department access and token revocation belong to the shared API. Lapper Read uses
the same flow; the [collector README](apps/lapper-read-py/README.md) describes its
`MESHFORGE_API_...` settings.

## Database and validation

Public users, departments, machines, parts, summaries and gearsets are shared
masters, edited by administrators in the shared Admin screen (`/admin` in every app,
including Lapping's Gearsets and Lapping Machines tabs). Lapper profiles, scanner/FANUC snapshots and production history live in
the linked lapper schema. [Database integrity](docs/DATABASE_INTEGRITY.md) explains
the preserved history, migrations, backup-first tools and outstanding review items.

```sh
npm run test:versions
npm test
npm run test:contracts
npm run lint
npm run build
```

The database suites require disposable restores and explicit fixture authorization.

## Plant dashboard workspace structure

The plant dashboard is a separate frontend inside this MeshForge Nx monorepo. It shares the existing API, authentication, Dana UI, root dependency manifest and lockfile. Its thin application shell is `apps/plant-dashboard`; routes/screens are in `libs/manufacturing/frontend/feature-plant-dashboard`, polling is in `data-access-plant-dashboard`, pure reporting/coverage logic is in `util-plant-dashboard`, and DTOs are in `libs/shared/domain`. Cross-project imports use public `@meshforge/...` aliases. See [dashboard setup and architecture](apps/plant-dashboard/README.md). The development app is not deployed by the existing Docker Compose stack; full historical/downtime/capacity parity with DSF is still pending source validation.
