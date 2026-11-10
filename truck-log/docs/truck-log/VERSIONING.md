# Versioning

The release is the SemVer string in `VERSION` (currently **1.0.6**). It is used unchanged everywhere:

- npm manifests (`package.json`, `package-lock.json`, both RXO apps)
- Docker image tags, image labels and container release labels (`TRUCK_LOG_RELEASE`, written to `.env` by setup from `VERSION`)
- `TRUCK_LOG_VERSION` in `libs/truck-log/shared/contracts` (API health, web sidebar, generated PDFs)
- `RELEASE-MANIFEST.json` and `apps/rxo-integration/RUNTIME-MANIFEST.json`

`tests/new-host/test-release-version.mjs` checks every copy against `VERSION` and fails on any leftover release label. To release: edit `VERSION`, update the copies that test names, then run `node tools/truck-log/refresh-manifests.mjs`.

Protocol identifiers are versioned separately and only change when their format changes: the admin session format (`truck-log-admin-v1`), the admin request header (`1`), and the RXO auth-state format (`AUTH_VERSION = '1'`). Database schema versions are migration numbers (`docs/truck-log/DATABASE-MIGRATIONS.md`).
