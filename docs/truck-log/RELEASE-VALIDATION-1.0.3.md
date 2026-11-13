# Truck Log 1.0.3 verification

Validated on 2026-11-09 against the source rebuilt from repository commit `13564408f8f6495390f96c1b724a9eb20bf39e21`. This release restores the RXO connection-recovery feature as a new 1.0.3 release; it does not claim to reproduce the missing 1.0.2 ZIP byte for byte.

## Completed checks

- Root and both RXO worker `npm ci` installations passed. Dependency versions and integrity entries remain those in the repository baseline; lockfile changes update only root release metadata.
- Production builds passed for the web app, Nest API, standard worker, and Expedite worker.
- Workspace TypeScript checks passed for all 40 projects.
- `validate:all` passed, including existing workflow, security, parser, transport, architecture, styling, and release checks.
- New recovery suites passed: 32 authentication policy/mock cases, 31 API/lifecycle/security cases, 25 UI behavioral cases, and 16 scheduler/cross-process cases.
- The compiled Angular app passed 10 real Chromium scenarios across both control centers: queued recovery, pending-action locks, cooldowns, MFA/settings routes, denied-request races, operator access, retained data, and safe feedback. No unexpected browser errors or outside-origin requests were observed.
- Real Chromium authentication fixtures cover opaque navigation-error recovery, stale RXO storage removal before application scripts, scoped cookies, fresh OIDC state through redirects, slow DOM readiness, and one password submission. Paired fixtures with CDP unavailable demonstrate the one-time storage reset and expose stale per-tab storage when that reset is suppressed.
- An opt-in thin Docker integration passed 11 checks using isolated synthetic credentials, data volumes, and unique image tags. It exercises actual helper execution, read-only status, durable queued requests, cooldowns, immutable image selection, and stopped standard-worker startup. All fixture containers, volumes, and image tags were removed.
- Prior regression suites remained green: 21 worker safety cases, nine workflow cases, ten security cases, 13 check-in cases, seven RXO parser/settings cases, six worker dependency/workbook fixtures, and 64 Expedite workbook/acquisition cases. PostgreSQL-backed workflow concurrency tests were not rerun in this workspace.

## Dependencies and scope

The fresh production npm audit reports three moderate advisories in the existing TypeORM -> glob/minimatch dependency chain (GHSA-3g3m-2fjr-6pw4 and GHSA-g3hv-75wg-m249). Dependency pins are unchanged in this focused recovery release. The older 1.0.1 audit results describe their original verification date and are not a current clean-audit claim.

The tests use local mocks and fixtures. No customer RXO account, production database, plant printer, or live export was used. Thin helper tests do not establish that full Playwright worker Docker images have been built or that an upstream RXO login will succeed. Run the rebuilt services on the deployment host and confirm a verified export after installation.

Database migrations 0001 through 0005 and vendored DANA UI 0.3.1 are unchanged. The repository's companion V4R7/W3 print-agent source is preserved.

The release process also validates installed release contracts, a clean extracted archive, and refreshed SHA-256 manifests before publishing.
