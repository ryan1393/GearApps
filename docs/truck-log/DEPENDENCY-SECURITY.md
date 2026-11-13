# Dependency security

Truck Log 1.0.1 uses Angular 20.3.34, NestJS 11.2.8, Nx 23.3.1, TypeScript 5.9.3 and Node.js 22 containers. Dana UI 0.3.1 is built and tested separately and installed from the shipped, integrity-checked tarball. The lockfile is generated with npm 10.9.9; CI/builds use frozen `npm ci`.

The production audit reports **zero advisories** at packaging time. This is a registry snapshot, not a guarantee against future vulnerabilities. Run `npm run audit:production` regularly. `npm run audit:build` fails at moderate or above and still displays low advisories.

## Reviewed overrides

- `multer` 2.5.0: fixes pending-filter request-teardown denial of service in the Nest Express adapter's 2.4.0 dependency. The same 2.x API is retained; document upload regressions and API startup are checked.
- `undici` 7.30.1: fixes the 7.x client advisories in Nx. Node 22 meets its engine requirement.
- `uuid` 11.1.1: supplies fixed buffer-bound checks while retaining CommonJS and the `v4` API used by ExcelJS/SockJS. Spreadsheet read/write and compiled build checks exercise these callers. Do not jump to ESM-only UUID versions without revisiting those integrations.

Keep these pins until the parent packages adopt safe versions, then remove them only with a regenerated lockfile, audits and build/workflow checks. Do not use `npm audit fix --force`: it proposes framework major changes and an ExcelJS downgrade rather than verifying application compatibility.

## Remaining build-only advisory

The full development-tree audit reports **nine low-severity entries derived from one `deepmerge` advisory**, GHSA-gcqx-w48m-w2h4 (`mergeObject` prototype poisoning; installed 4.3.1). At packaging time the registry's latest release is still 4.3.1 and no patched upstream 4.x release is available. Nx/Jest/Webpack tooling accounts for the propagated entries. `deepmerge` is absent from the production install; uploaded business data never reaches this build-time configuration merge. Build inputs/configuration must remain trusted, and builds should run in an isolated CI environment.

This advisory is retained visibly instead of suppressing the audit or substituting an unverified older/forked package. Monitor the upstream fix and update the build toolchain when available. `npm audit --json` shows the exact dependency paths.

## Other release components

Dana UI's complete source/development audit is clean. The SAP watcher's pinned Python packages and the standard RXO/Expedite Playwright workers are separate dependency environments; root npm audit does not scan them. Keep them on the tested versions and validate upgrades against representative SAP/RXO documents and browser flows.
