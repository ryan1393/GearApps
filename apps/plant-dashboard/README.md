# Plant dashboard

A separate Angular application in the GearApps workspace, using the shared MeshForge API and sign-in service. It adds no dependency packages and does not alter the existing clients or DSF reader.

The running DSF screenshots and confirmed metric meanings are recorded in [DSF reference review](../../docs/manufacturing/PLANT_DASHBOARD_DSF_REFERENCE.md). The department doughnuts show actual divided by **maximum capacity**, as confirmed by the user; capacity is separate from a production target. The starter does not yet reproduce those doughnuts or the full hourly DSF report.

From the repository root, with Node 24.22.1 and npm 11.9.0:

```sh
npm ci
# Start/configure the MeshForge API and PostgreSQL first (see root README).
npm run serve:plant-dashboard
npm run build:plant-dashboard -- --configuration=production
npx nx test plant-dashboard
npx nx lint plant-dashboard
```

The development port is 4204. The development proxy forwards `/api` to the local MeshForge API on port 3333. A production deployment must serve the built `dist/apps/plant-dashboard/browser` files with SPA fallback and reverse-proxy `/api` to MeshForge. DSF credentials belong on the API server, never in this browser application.

## Nx architecture and MeshForge integration

This is a separate frontend application **inside the existing MeshForge/GearApps Nx monorepo**. It uses `meshforge-server`, the existing JWT/session service and guards, Dana UI, the root `package.json` and `package-lock.json`, and the existing database/DSF reader. It is not a new standalone repository, API, authentication backend or database. It is not embedded in the existing Blade Tracking/Cutter Builder/Greenshed/Lapper client menus, and it has not been deployed to the plant server or added to Compose.

| Nx project | Location | Responsibility |
| --- | --- | --- |
| `plant-dashboard` | `apps/plant-dashboard` | Thin bootstrap, shared HTTP interceptor, frontend styles/proxy and build/serve targets |
| `frontend-feature-plant-dashboard` | `libs/manufacturing/frontend/feature-plant-dashboard` | Lazy screen routes, dashboard/sign-in presentation, filters and exports |
| `frontend-data-access-plant-dashboard` | `libs/manufacturing/frontend/data-access-plant-dashboard` | Authenticated cached-snapshot HTTP calls, polling, refresh, error state and cleanup |
| `frontend-util-plant-dashboard` | `libs/manufacturing/frontend/util-plant-dashboard` | Pure production/freshness/CSV logic, Cuttergrind and plant coverage reconciliation, reference departments |
| `shared-domain` | `libs/shared/domain` | Dashboard/DSF response contracts; single type authority for this feature |

Cross-project imports use the public `@meshforge/...` aliases in `tsconfig.base.json`. Library lint rules enforce the layers: utilities depend on domain types; data access depends on domain types and existing data-access libraries; feature UI depends on those layers and Dana UI. Frontend libraries cannot import server libraries or apps. Local files within a library use relative imports.

`nx test plant-dashboard` orchestrates the utility and data-access test targets through Nx dependencies; tests live with their owning libraries. Nx tracks and caches these projects with the workspace defaults. The app has no duplicated business logic or nested dependency installation. The data-access service is provided by the dashboard component, so leaving/signing out destroys polling and source metadata; a later regular-user session cannot inherit an administrator's cached source list.

To inspect the dependency graph or test layers independently:

```sh
npx nx graph --focus=plant-dashboard
npx nx test frontend-util-plant-dashboard
npx nx test frontend-data-access-plant-dashboard
npx nx run-many -t lint --projects=plant-dashboard,frontend-feature-plant-dashboard,frontend-data-access-plant-dashboard,frontend-util-plant-dashboard
```

## Available now

- MeshForge account sign-in and the existing authenticated `/api/v1/dsf-counts` endpoint.
- Machine cards, department/search/review filters, source freshness, and current-shift counts.
- A dedicated Cuttergrind (Department 45) coverage section and one-click machine filter. Administrators also see DSF Cuttergrind source mappings, including unlinked sources absent from the registered machine catalog. This uses the existing read-only `/api/v1/dsf-counts/admin-mappings` endpoint; other users are not sent that source catalog.
- A plant coverage matrix/export covering the 15 departments visible in the user's DSF reference, every registered department, and additional discovered source departments. Missing catalog departments stay visible; stale or unavailable DSF source totals are unknown rather than zero.
- Current-shift reports grouped by department, date, shift number, and exact shift boundaries.
- Machine and department CSV exports honoring the filters, and a printable report.
- Explicit missing-data and partial-coverage states; unknown production remains blank, not zero. Counts expire at shift end or when source evidence becomes stale, even if HTTP requests keep succeeding.

“Reporting” means count evidence is fresh; it does not mean the machine is running. Summed machine output is not a finished-goods count: parts can pass through several operations. A fresh zero remains zero, but does not establish downtime.

## Needed for the full plant workflow

The current endpoint lists the MeshForge machine catalog, not every machine in DSF. The sample base-data file has 55 machine records in four departments (45, 48, 132, and 152); those numbers do not establish plant coverage. The department reference file also contains Management, which has no machines in that machine file. Reconcile the DSF machine/department catalog against the plant inventory, including duplicate mappings, inactive equipment, and departments using nonnumeric names. See `docs/manufacturing/DSF_COUNTS.md`.

The sample catalog includes **eight legacy Cuttergrind records** in Department 45: `01-024-010`, `01-024-073`, `01-024-075`, `01-024-077`, `01-114-008`, `01-114-021`, `01-114-023`, and `01-114-024`. Four are inactive in that import. These legacy asset records do not establish coverage of the physical CutGrind machines in DSF (for example the documented `CutGrind 3 1-24-79` source). The importer also leaves these records with the default machine type; verify the actual physical identities/type in Admin before treating them as correctly registered grinders. Do not create guessed machines or remap production equipment automatically.

The DSF reader already recognizes the plain DSF department name `CUTTER GRIND` as code `45`. Preserve `CUTTER GRIND=45` if customizing `DSF_DEPARTMENT_NAMES`. Current-shift grinder counts do not depend on the old five-grinder stock ledger. The coverage section lists source operations separately from physical machines, flags active sources without a registered link, and treats a stale/missing source catalog as unverified. An administrator must reconcile physical machines, source mappings, inactive equipment and machine types before the Cuttergrind inventory can be called complete.

Downtime, utilization, reason breakdowns, and historical production reports are **not implemented**. The inspected reader only establishes timestamped piece increments, RUN reason code `1`, and current-shift windows. It does not establish whether cycle timestamps are state transitions, heartbeat samples, or completion times, nor the state-duration schema. Inferring downtime from gaps between counts would be incorrect.

To implement these reports, obtain an authorized read-only DSF connection or a sanitized schema/data export, then verify:

1. Authoritative physical-machine identities, all departments, operations, and source coverage.
2. State history tables, start/end or duration semantics, reason code definitions, and missing-signal rules.
3. Shift schedules, Indianapolis daylight saving transitions, planned breaks, planned/unplanned downtime, and report retention.
4. Historical count corrections, counter resets, event duplicates, and source freshness.

Then add bounded, parameterized server-side history queries with the existing read-only role/TLS checks. Validate production and downtime totals for known machines/shifts against DSF before enabling the reports. No production DSF connection or plant-wide coverage was validated during local setup.
