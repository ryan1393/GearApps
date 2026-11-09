# RXO connection recovery

Release 1.0.3 adds **Recover connection** to both the standard RXO Control Center and RXO Expedite Control Center. An administrator can request a controlled reconnect when an exporter is stopped or authentication needs review. The page keeps the previous verified data and reports a queued request until a later login/export result confirms the outcome.

## Use the button

1. Sign in as a Truck Log administrator and open the affected control center.
2. In the recovery panel, select **Recover connection**. The button is disabled while the request is pending, while a scan is active, and during the recovery cooldown.
3. Wait for the next status update. A queued request means the worker will attempt recovery; it does not mean that RXO has accepted the login.
4. If the saved login was rejected, update it under **Settings & Login**. If RXO requires MFA, access approval, or an interactive sign-in, complete that step before retrying.

The standard and Expedite connections are independent. Recovering one does not restart the other.

## Recovery policy

- A durable request authorizes one connection attempt. Repeated concurrent clicks share a request.
- Requests observe a 60-second cooldown and a limit of three explicit attempts per hour, persisted in the worker data volume. Existing manual retry paths share the limit.
- A rejected or locked credential cannot be retried unchanged. MFA, access review, and unapproved authentication origins require the administrator's attention.
- The worker refreshes only RXO session cookies and approved-origin web storage. It preserves newly created OIDC callback state during the recovery navigation.
- Authentication navigation waits for document commitment and then verifies the approved login/application surface. Slow page assets alone do not establish a navigation failure or login success.
- Missing or malformed recovery state blocks a new attempt until it can be reviewed. Worker updates are locked and bound to the current request so an old run cannot complete a newer request.
- Requesting recovery preserves credentials, browser profile directories, the existing authentication hold, and verified export data. The worker releases the hold only after the retry policy authorizes the attempt.

## API and worker lifecycle

The administrator-only endpoints are `POST /api/v1/rxo/control/recover` and `POST /api/v1/rxo/expedite/recover`. They use the application's existing session, origin, intent-header, and CSRF protection. Responses report `QUEUED` or `ALREADY_RUNNING`; policy rejections provide bounded flags for credentials, interactive login, and cooldown status.

The API verifies the exact Compose project, service, release image, and named volumes before using a helper container. The helper has no network, uses the matching installed worker image without pulling a replacement, mounts credentials read-only, and mounts data read-only for status or writable for a recovery request. Process output and execution time are bounded, and temporary helpers are removed.

A request is written before a stopped scheduler is started. A running scheduler with a fresh heartbeat is left to consume the request; a stale scheduler is rechecked before restart. An active healthy scan is allowed to finish.

## Install or upgrade

Keep the existing `.env` and all named volumes. Run setup from the new `truck-log/` folder and rebuild the API, web app, standard RXO worker, and Expedite worker together. All release labels must match `VERSION` (1.0.3). For HTTPS installations, use both Compose files for every lifecycle command; see [HTTPS deployment](HTTPS.md).

No database migration is added after 0005. DANA UI remains 0.3.1, and the companion guard V4R7 / watcher W3 print agents do not require replacement for this feature.

## Verification

The source includes local policy, API/lifecycle, UI, and cross-process scheduler regression suites. Browser fixtures use mocked RXO pages and local credentials; they do not access a customer RXO account. Passing those checks establishes recovery behavior under the tested conditions, not that a live upstream account or network is healthy.
