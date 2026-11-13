# Truck Log 1.0.1 verification

Reviewed and fixed together with DANA UI 0.3.1 and print bundle V4R7/W3. Source ZIPs exclude credentials, live documents, installed dependencies and caches. Existing migrations 0001–0004 are unchanged.

## Verified

- Frozen npm installation with Node 22/npm 10; npm 11 clean-install planning also accepts the lockfile. All four Nx applications build and all 39 TypeScript projects type-check.
- `validate:all`, installed `validate:release`, clean-package `validate:archive`, package SHA-256 and vendored Dana SHA-512 checks.
- Behavior regressions for PDF decoding budgets/corruption, login throttling/proxy trust, sparse workbooks/multiline IDs, check-in uploads and polling, and manual/automatic printing.
- Real PostgreSQL concurrency and queued-print recovery tests: opposite-direction upserts, explicit cancellation/replacement, immutable snapshots, idempotent replay and protected history.
- Upgrade from the original 1.0.0 database: only migration 0005 applies, existing sentinel data and all nine seeded docks remain, repeat is a no-op.
- API and web Docker images build; API/PostgreSQL/Nginx start. Loopback health probes explicitly bypass inherited HTTP proxy settings. Through Nginx, health, station authorization, manual check-in without an agent, duplicate-submit replay and printable slip work.
- HTTPS overlay merges with the real Compose CLI; its rendered Nginx configuration validates with a throwaway test certificate. Auth regressions verify trusted IP plus key and header overwrites; Secure HTTPS cookies remain enabled. A real administrator login/session succeeded through the certificate-verified TLS listener, and direct callers with forged assertions were refused.
- Chromium smoke against the compiled UI: valid manual check-in, pending native/combobox/file controls locked, saved-slip action, no browser errors. Dana UI has strict AOT and browser interaction checks under Angular 19 and 20.
- Standard RXO local browser fixtures: 61 pass; Expedite fixtures: 64 pass; worker dependency/workbook fixtures: 6 pass. No upstream account is used.
- Guard selftests: 131 pass. W3 pinned-environment watcher tests: 88 pass, two Windows ACL tests skipped; actual text PDF, raster and OCR checks included. Bundle/embedded payload hashes verify.

## Dependency results

Application production graph, both RXO worker graphs, full Dana UI graph and all five pinned watcher Python packages have zero known registry advisories at the 2026-10-29 audit. The full Truck Log build graph retains nine low entries propagated from one unpatched development-only deepmerge advisory; see DEPENDENCY-SECURITY.md. This is not an OS image/native executable scan.

## Remaining acceptance work

Native Windows services, NTFS/DPAPI under service accounts, SAP/PDF24 queues, actual printers/drivers and live RXO authentication/export need a staging host and representative traffic. Optional watcher OCR now needs Python 3.11+; text-only mode supports 3.10+.

Matching Playwright worker Docker builds were attempted but this managed environment exhausted its 32 GB disk while registering the large Microsoft base image on its VFS Docker storage. The source/npm/browser fixture checks passed; the matching worker image builds must be completed on a normal Docker host. No TLS verification was disabled. For the API/web builds here, this environment's public proxy CA was mounted only during dependency fetches, not shipped inside the images or ZIPs.

For production TLS, supply a trusted certificate and use both Compose files for every lifecycle command; see HTTPS.md. Remote agents now use the web origin's `/api/v1` route because direct API port 3334 defaults to loopback. Read the README upgrade notes before replacing an existing installation.
