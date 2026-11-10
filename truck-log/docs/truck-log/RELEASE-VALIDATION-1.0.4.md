# Truck Log 1.0.4 verification

The user reported a live successful RXO export and import, followed by an Expedite acquisition failure. The deployed 1.0.3 worker discarded the original exception behind `EXPEDITE_ACQUISITION_FAILED`, so that old error alone cannot establish its cause.

This patch fixes a reproduced unhandled download-waiter rejection after an export-click failure. Tests execute the actual download orchestration in separate Node processes for both rejection orders and a synchronous click failure. Each attempt still performs one export click. A failed attempt retains the previous verified batch; no authentication retry limits or account safeguards are removed.

## Focused verification

- 21 acquisition diagnostic/download regressions and 64 existing Expedite workbook/acquisition cases passed.
- 21 actual service/API cases passed, including positive enum allowlisting for acquisition diagnostics and removal of unexpected source fields.
- 33 frontend behavioral regressions passed. Healthy waiting schedules show their real countdown after a failed attempt; actual paused/stopped states and explicit authentication blocks remain distinct. Hourly recovery limits and one-minute cooldowns show separate messages, expiry, and remaining wait.
- Source builds, all 40 TypeScript projects, full validation, and clean archive/checksum validation are run for the release.
- Six production-browser fixtures passed using the compiled Angular app with mocked APIs, covering failure countdowns, safe diagnostics, hourly limits versus cooldowns, genuine authentication holds and retained data. They do not sign in to RXO or change production data.
- Nine diagnostic-helper cases passed with real Node evaluation and fake Docker, including secret suppression, unchanged state files, stopped containers, malformed data, and Legacy/CRLF input.

The root read-only `DIAGNOSE-RXO-EXPEDITE` helper reports bounded, allowlisted container and worker metadata using the selected Docker context. It omits credentials, auth messages, hashes, environment variables, raw logs, and source data; it does not change worker state or request another login.

## Deployment and limits

Deploy the complete 1.0.4 package using the SCP/SSH helper and retain the working `.env` and named volumes. A future acquisition failure will carry a fixed stage/cause diagnostic and timestamp. Confirm scheduled exports on the actual server after deployment; automated tests do not prove the upstream service is healthy.

Dependency versions and the five database migrations remain unchanged. The three moderate dependency advisories recorded for 1.0.3 remain a separate dependency-maintenance item. DANA UI stays at 0.3.1 and print agents stay at V4R7/W3.
