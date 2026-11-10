# GearApps 70.5.0

One Nx monorepo contains Lapper, Lapper Read, Blade Tracking, Cutter Builder and
Greenshed. All four web applications and the collector use **one NestJS API on
port 3333**, one authentication service and the same PostgreSQL database.

| Application    | Project / source                                   | Browser port                             |
| -------------- | -------------------------------------------------- | ---------------------------------------- |
| Shared API     | gear-app-server / apps/server        | 3333 (API)                               |
| Lapper         | lapper-client / apps/lapper-client                 | 4203                                     |
| Blade Tracking | blade-tracking / apps/blade-tracking | 4200                                     |
| Cutter Builder | cutter-builder / apps/cutter-builder | 4201                                     |
| Greenshed      | greenshed / apps/greenshed           | 4202                                     |
| Lapper Read    | apps/lapper-read                                   | Windows collector, outbound HTTP to 3333 |
| Lapper Read (Docker) | lapper-read-py / apps/lapper-read-py         | Python collector container, see its README |

The root package.json and package-lock.json are the dependency authority. Use
Node 24.22.1, npm 11.9.0 and .NET SDK 8 for the collector. All clients share [Dana UI](libs/shared/dana-ui).
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
proxy /api to gear-app-server:3333. Keep the existing PostgreSQL volume.

For an existing installation, follow [the unified API upgrade procedure](docs/UNIFIED_API.md).
The application source ZIP is [GearApps 70.5.0](releases/GearApps-70.5.0.zip).

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
# In separate terminals, start the clients you need:
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
the same flow; [collector configuration](apps/lapper-read/SETUP.txt) describes its
GearAppsApi settings.

## Database and validation

Public users, departments, machines, parts, summaries and gearsets are shared
masters. Lapper profiles, scanner/FANUC snapshots and production history live in
the linked lapper schema. [Database integrity](docs/DATABASE_INTEGRITY.md) explains
the preserved history, migrations, backup-first tools and outstanding review items.

```sh
npm run test:versions
npm test
npm run test:contracts
npm run lint
npm run build
dotnet test apps/lapper-read/LapperRead.Tests/LapperRead.Tests.csproj -c Release
```

The database suites require disposable restores and explicit fixture authorization.
See [unified API verification](docs/UNIFIED_API_VERIFICATION.json).
Historical releases remain in releases/ and source-archives/.
