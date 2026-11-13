# RXO worker dependencies

The standard and Expedite workers have separate `package.json` and `package-lock.json` files. Both images use `npm ci --omit=dev --ignore-scripts`, and their Dockerfile-specific ignore files include the corresponding lockfile. Root `npm audit` does not cover these independent applications.

Both workers pin Playwright **1.55.1** and the matching `mcr.microsoft.com/playwright:v1.55.1-noble` image. This is the minimum patch fixing the browser-download certificate-authentication advisory [GHSA-7mvr-c777-76hp](https://github.com/advisories/GHSA-7mvr-c777-76hp); it avoids an unrelated browser major-version upgrade.

Standard RXO pins SheetJS CE **0.20.3** from its official distribution URL:

```text
https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==
```

The npm registry's older `xlsx@0.18.5` has prototype-pollution and regular-expression denial-of-service advisories. The official tarball retains the synchronous workbook API and fixes the affected versions. Its SHA-512 integrity is pinned in the lockfile and checked by `npm ci`; a modified upstream tarball cannot silently replace it. Builds need HTTPS access to `cdn.sheetjs.com` as well as the npm and Microsoft container registries. License remains Apache-2.0.

The Expedite workbook reader remains its independent strict ZIP/XML parser; SheetJS is used only by standard RXO. The dependency change does not alter verified snapshot publication or enable a live export.

Reproduce installation/audit from the release root:

```sh
npm ci --prefix apps/rxo-integration --omit=dev --ignore-scripts
npm ci --prefix apps/rxo-expedite --omit=dev --ignore-scripts
npm audit --prefix apps/rxo-integration --omit=dev
npm audit --prefix apps/rxo-expedite --omit=dev
node tools/truck-log/test-rxo-worker-dependencies.mjs --fixtures
node tools/truck-log/expedite/test.mjs
```

At the 2026-10-29 audit, both worker dependency graphs report zero npm advisories (previously two high findings in standard RXO and one high in Expedite). This describes the audited npm graphs, not an OS-image vulnerability scan or validation against the live RXO service. Build both matching images and run their local browser fixtures before rollout. The standard image runs its fixture-only readiness suite during its build; no RXO login is performed.
