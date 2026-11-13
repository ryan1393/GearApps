# Changelog

## Unreleased — Role-based stations and the CK65 dock handheld

- Station types are now roles enforced by the server: **Guard station** (unchanged), **Dock handheld** (new; Honeywell CK65: Dock Board and Records & Paperwork only), **Management** (new; every screen, view only) and **TV display** (unchanged). A signed-in administrator can still do everything. See [Stations](docs/truck-log/STATIONS.md).
- Dock handhelds may only call an explicit list of dock routes (Dock Complete, delivery numbers, packing slips, paperwork, records); anything else is refused with `403 STATION_ROLE`. Management stations may only read.
- The navigation, route guard and buttons follow the role, and each station opens on its own start screen. On the CK65, the Dock Board and Records & Paperwork are two large tabs, with a phone layout for filters, cards and records.
- Every screen fits the window on desktop and landscape tablets. Long lists scroll inside their card, and RXO summary tiles and Dock Board counts jump to the section they describe.
- Database migration `0006_station_roles.sql` adds the two new station types. Existing stations keep their type.

## 1.0.9 — Longer confirmation before an empty Expedite list is published

- Require the second empty scan to come at least 45 minutes after the first (was ten). RXO was observed showing a settled "0 of 0" list for ten to twenty minutes while shipments existed. With the default 30-minute schedule, an empty list is published by the scan one hour after it is first seen.
- Everything else in 1.0.8 is unchanged.

## 1.0.8 — Expedite: slow Freight on the Move page and genuinely empty lists

- Wait up to 90 seconds (was 30) for RXO's loading overlay before switching Freight on the Move to List. A slow page no longer fails every scan with `FREIGHT_LIST_CONTROL_TIMEOUT`.
- Accept a genuinely empty Freight on the Move list. The scheduler publishes it only when the list shows "0 of 0" with RXO's loading overlay gone and the count steady for 20 seconds, and a second scan at least ten minutes later (within six hours, with no shipments seen between) finds the same. The first sighting reports `EMPTY_LIST_AWAITING_SECOND_SCAN` and keeps the previous batch.
- Once an empty list is published it stays published on later empty scans; the older shipments are no longer restored. The next scan that finds shipments publishes them and resets the rule.
- A "0 of 0" list that is still loading, or a partially shown list, is refused as before. Database migrations remain unchanged through 0005.

## 1.0.7 — One scan saves the number and attaches the packing slip

- **Scan Document** on the Dock Board now does both steps: it saves the Delivery Number, then attaches the uploaded PDF when exactly one validated Print Agent capture carries that number, the capture belongs to no visit, and the visit has no packing slip yet. The attachment is recorded in the visit timeline and the document history as made without preview.
- When no capture or more than one matches, or the visit already has a packing slip, the scan only saves the number as before. **Find PDF** still lists the candidates to open, review and confirm.
- Companion SAP watcher: verified slips are stored under their Delivery Number (`13246286.pdf`).
- Database migrations remain unchanged through 0005 and DANA UI at 0.3.1.

## 1.0.6 — Password changes and print agent setup fixes

- Add `CHANGE-TRUCK-LOG-PASSWORDS` (Windows and Linux) to change the administrator password, database password, Print Agent signing secret and RXO logins after setup. The database option updates PostgreSQL and `.env` together and keeps the HTTPS overlay on restart.
- Run `SETUP-PRINT-AGENT-CREDENTIAL.cmd` and `SETUP-TRUCK-LOG-ADMIN.cmd` with `docker exec`, so they work on a Windows PC whose Docker CLI has no Compose plugin.
- Companion print agents: add `REMOVE-OLD-PRINT-AGENT` to uninstall the old guard service before a fresh V4R7 install, and accept an incomplete token paste in the SAP watcher credential setup. The guard service remains V4R7 and the watcher W3.
- The server, web app and RXO workers are unchanged from 1.0.5. Database migrations remain unchanged through 0005 and DANA UI at 0.3.1.

## 1.0.5 — Scan Now in both RXO control centers

- Expose **Scan Now** on both standard RXO and RXO Expedite, with administrator authorization and pending/running feedback.
- Queue Expedite scans through the existing scheduler so scheduled and manual exports share the same browser lock and authentication holds. Keep export completion separate from database import status.
- Harden Expedite's Freight on the Move navigation: reuse a visible List export, select List once, and verify the data surface independently of page-load events. Report expired sign-in or verification screens while preserving the previous verified batch on failure.
- Keep the responsive RXO data-panel spacing improvements and consistent gaps between shipment IDs and Details buttons.
- Keep database migrations unchanged through 0005, DANA UI at 0.3.1, and the companion print agents at V4R7/W3.

## 1.0.4 — Expedite scan reliability and diagnostics

- Observe the export click and download waiter together so a failed click cannot leave an unhandled download rejection or trigger a duplicate export.
- Record an allowlisted acquisition stage and cause for failed attempts while retaining the previous verified export and completed import.
- Show the actual next-scan countdown for a healthy waiting scheduler, even when its last attempt failed. Distinguish paused authentication and a stopped process.
- Separate the one-minute recovery cooldown from the hourly retry limit, including its expiry and remaining wait.
- Show the latest failed attempt's time and safe diagnostic details, and direct generic export failures to Exporter Health.
- Include a read-only Expedite diagnostic helper for current container, scheduler, authentication-hold and recovery-limit state. Existing authentication safeguards and database migrations are unchanged.

## 1.0.3 — RXO connection recovery

- Add an administrator **Recover connection** action to both RXO control centers, with pending feedback, cooldowns, and a Settings & Login path when credentials or interactive approval are required.
- Queue a bounded, durable session refresh and one verified login attempt; resume the matching stopped scheduler without removing credentials, browser profiles, or verified data.
- Handle slow authentication navigation by waiting for a committed document and then verifying the approved application surface.
- Serialize recovery requests and worker updates, enforce retry limits across restarts, and prevent duplicate startup/rescan attempts.
- Add recovery policy, API, UI, concurrency, and browser regression coverage. Database migrations remain unchanged through 0005; DANA UI stays at 0.3.1 and the companion print agents stay at V4R7/W3.

## 1.0.1 — Reliability and security polish

- Keep browser check-in available without optional printing; add explicit manual/automatic modes and a saved-slip fallback. Lock pending forms and upload queues, preserve accepted print tracking and action keys, and bound status requests.
- Accept corrected RXO documents without altering an original print snapshot; order location locks consistently to prevent opposite-direction deadlocks.
- Add migration 0005 for audited cancellation/replacement of never-leased automatic print jobs. Frozen destinations remain immutable; uncertain physical prints still need explicit inspection and retry.
- Preserve sparse workbook rows and multiline order IDs; display the exporter’s actual fixed yesterday/today/tomorrow coverage instead of unsupported controls.
- Bound every PDF decoding stage before allocating output and use verified transport identities for authentication/pairing limits.
- Vendor DANA UI 0.3.1 with corrected canonical styling, disabled combobox behavior, table cleanup and accessible modal focus.
- Update supported build/runtime dependencies, provide an optional verified HTTPS proxy, default the direct API port to loopback, and separate clean archive validation from installed release checks.
- Add behavioral, database concurrency/recovery, and HTTPS configuration regressions. Companion watcher W3 stages capture independently of slow printing and preserves restart/credential safety.

## Unreleased

### New: packing-slip watcher routes in the webpage
- **Administration > Printing** has a new **Packing slip watcher** panel: one row per SAP watcher route (1-8) with name, SAP capture queue, output printer, mode (Off/Test/Live) and Upload to Truck Log. It shows the version and who last changed it, and when. Without an administrator sign-in the panel is read-only.
- Switching a route to **Live** asks for confirmation and names the routes and printers that will start printing paper. That confirmation is the only switch needed; the print PC has no second "arm" setting.
- If someone else saved first, the save is refused with a clear message and the latest routes are loaded.
- The watcher reads the routes from `GET /api/v1/print-agents/packing-slip-routes`, using the packing-slip upload credential. It gets an ETag and 304 when nothing changed.
- Every saved change is audited: who, when, and before → after per field.
- Migration `0004_packing_slip_watcher_routes.sql` seeds today's eight `watcher.ini` routes, all Test with upload off.
- Details: `docs/truck-log/ARCHITECTURE.md`, "Packing-slip watcher routes".

### Styling: Truck Log on Dana UI
- Every screen now takes its look from Dana UI 0.3.0, the shared package Gear Apps also uses. Truck Log keeps only layout CSS; components have no styles of their own. The rule is in `docs/truck-log/ARCHITECTURE.md`.
- **Dropdowns:** load, origin, destination, carrier, driver and dock pickers are searchable lists with column headers (for loads: Load, Source, Direction, Carrier, Trailer, Scheduled). They work by keyboard and stay visible inside panels.
- **Pages redone:** dashboard, Check-In, Dock Board, Active Trucks, Records, RXO and RXO Expedite Control Centers, Administration (editable tables for drivers, carriers and locations), users, stations, sign-in, password and station setup.
- **TV boards:** Dockworker and Management TVs use Dana's new wall-display pieces, sized to read across a dock.
- **Phones and tablets:** the sidebar slides in from a menu button; wide tables scroll inside their panel instead of the page.
- **Docker:** both images copy `vendor/` before `npm ci`, so the vendored Dana UI package installs in the build.

### Fix: late Print Agent results
- A print that finished inside its lease but reached the server late is now recorded as it happened. This covers a Print Agent 4.0.7 result re-sent from its outbox after a network or heartbeat outage. Before, it became FAILED/"uncertain", and the real success was rejected with "A different final print result is already recorded."
- **In time** means the claim still matches and the result was submitted between `leased_at - 5 min` and `lease_expires_at + 5 min`. Such a result replaces the lease monitor's uncertain failure once, on both the automatic and the legacy print paths. The visit history records `..._LATE_RESULT`.
- Unchanged: out-of-time results stay uncertain. Agent- or human-written failures are never overwritten, and PRINTED is never downgraded. A guard retry still wins over a later late result.
- Migration `0003_late_print_agent_results.sql` lets the print-history triggers allow only this transition.
- The legacy result path and the guard's Dock Assignment confirmation no longer risk failing on PostgreSQL when they record `printed_at`: the parameter is now typed.
- Visit history shows readable labels for gate prints and late results.

## 1.0.0

First clean release. It replaces the 0.1 test builds, `truck-log` and the isolated `truck-log-nxdev`. A 0.1 database is not upgraded; see README.md, "Replacing an older test install".

### New: station sign-in
- Every guard PC, dock PC and TV is registered once in **Admin → Stations**. It is paired with a one-time 8-character code at `/station/setup`, and then stays signed in.
- Guard screens and the API now require a paired station or a signed-in administrator. Before, anyone on the plant network could check trucks out, download packing slips by guessing numbers, or replace a driver's document.
- TV stations are read-only.
- Visit history records which station did each check-in, dock-complete, upload and checkout, instead of a name sent by the browser.
- Guide: `docs/truck-log/STATIONS.md`.

### Names, version, structure
- **One version:** `1.0.0`, read from `VERSION` everywhere: npm, Docker images and labels, the UI, the API and the RXO workers. A test fails if any copy drifts.
- **Clean Docker names:** project, containers, volumes and network are all `truck-log`. Default ports are web 4300, API 3334 and RXO browser 6080.
- **Shared RXO code:** one copy of the RXO auth, locking and retention code, in `libs/truck-log/rxo-shared`, instead of byte-identical copies in each app.
- **Large files split:**
  - the RXO exporter (1,394 lines)
  - the RXO Control Center (1,216 → 242)
  - Check-in (902 → 464)
  - Admin (one component per tab)
  - the large server services
- **CSS:**
  - 1,262 fewer lines
  - `!important` down from 243 to 113
  - dead selectors down from 186 to 0
  - patch-numbered class names replaced by descriptive ones
- **Docs:** rewritten README, plus new STATIONS, DATABASE-MIGRATIONS and VERSIONING guides. Patch-era deploy notes removed.

### Database
- Migrations 001–010 and the admin-account migration are folded into one `0001_baseline.sql`, proven identical to the 0.1 schema and seed data on PostgreSQL 16. Station tables are added in `0002_stations.sql`.
- A ~150-line runner (`tools/truck-log/migrate.mjs`) replaces about 3,000 lines of per-migration scripts. It records applied migrations, runs each in its own transaction under a lock, refuses edited or unknown migrations, and refuses old 0.1 databases.
- The admin tables now exist from the first start; `SETUP-TRUCK-LOG-ADMIN --bootstrap` only creates the first account.

### Fixes: RXO workers
- **Broken export:** the standard RXO exporter called six functions it never imported, so every export failed. Fixed.
- **Two exporters at once:** a test run and the scheduler could run together, sharing one browser profile and risking an RXO account lockout. Now one export at a time.
- **Rejected password retried:** saving unchanged credentials counted as new ones, so a rejected password was tried again. Now detected by content.
- **Stuck Expedite lock:** a lock left by a crash stopped Expedite while it still reported healthy. Stale locks are now broken automatically.
- **False healthy:** health checks now fail when the scheduler loop stops making progress, not only when its heartbeat stops.
- **Crash loop:** a damaged auth-state file made both schedulers crash repeatedly. They now report "needs review" and keep running.
- **Partial `latest`:** a half-written `latest` export could be imported. It is now swapped in atomically.
- **Unbounded growth:** old export batches are now pruned.
- **Old passwords kept:** old Expedite passwords piled up on disk; only two generations are kept now.
- **VNC password:** the RXO login browser's VNC now has a password per session.
- **Container hardening:** RXO containers drop all capabilities and have memory and process limits.
- **Duplicate compose file:** the nested RXO compose file could recreate the production container with different settings. Removed.

### Fixes: API
- **RXO import never worked (since 0.1):** the import read the export's summary file under a different name from the one the copy step writes, so every import stopped with "RXO ingestion boundary is missing". Both now use one shared name, a check keeps them in step, and an import of a six-file snapshot was run end to end.
- **Docker floods:** each RXO status poll started several Docker containers. Concurrent polls now share one run and reuse it briefly.
- **RXO login name:** shown only to administrators.
- **Expedite size cap:** a 64 KiB output cap broke Expedite once there were more than about 200 shipments. Raised to the size the database allows.
- **Admin lockout:** anyone could lock all administrators out with wrong-password requests. Now only failed attempts count, per account and per client address. Password checks queue instead of failing with "busy".
- **Deleted files:** a stored PDF could be deleted after a save whose commit actually succeeded. It is now kept unless proven unused.
- **Completed batch overwritten:** a failed RXO import could mark a completed batch as failed.
- **Tokens after restart:** checkout and scan tokens broke whenever the API restarted. Their keys now come from the configured secret.
- **"No match" read as success:** the database driver returns UPDATE and DELETE results wrapped as `[rows, count]`, and 38 places read them as plain rows. So checks like "is this Print Agent still enabled?" or "is this credential still active?" never failed, a password reset for a missing account reported success, editing an administrator returned garbage, and station sign-in could never recognise a paired browser. All 38 now unwrap the result, and a check fails if a new one doesn't.
- **Admin tool out of date:** the admin command-line tool was built from an older version of the sign-in code. It is regenerated, and a check now fails if they drift.

### Fixes: web app
- **Expedite login couldn't be saved:** it needed a separate "Expedite control origin" setting that setup never filled in, so the Username and Password boxes stayed greyed out. It now follows the administrator sign-in address, and still needs a signed-in administrator. The screen also says exactly what is missing (sign in, or which address to use).
- **PDF memory leak:** PDFs piled up in memory on the dashboard and Active Trucks, which stay open all shift.
- **Overlapping polls:** polls could pile up on the dashboard, Active Trucks, RXO and Expedite. One shared poller now prevents overlap and shows "data may be out of date" when a refresh fails.
- **Stale screens:** the Expedite Data tab never refreshed. Searches could be overwritten by background refreshes. Clearing the global search didn't clear Records.
- **Printer polling:** print-status polling ran forever. It now backs off and reports "Printer not responding".
- **Admin edits:** saving one admin row discarded unsaved edits in other rows.
- **Materials token:** it was typed into a browser prompt and kept in session storage. Now it uses an in-app dialog and is kept in memory only.
- **Accessibility:** dialogs are announced to screen readers, close on Escape and manage focus. Error messages stay until dismissed.
- **Tables fit the screen:** on a 1440px monitor, Active Trucks and Records no longer cut off the action buttons, and trailer and dock numbers no longer break in the middle. The Dock Board filter bar wraps instead of hiding the counts off-screen.
- **Small fixes:** "No RXO or Expedite loads" is a plain note instead of a red error. A TV station opens the Dockworker TV after pairing.
- **nginx:** the page shell is never cached, security headers are set, and missing files return 404. TV screens reload themselves after an upgrade.

### Setup
- **Windows scripts didn't run:** a syntax error in a shared PowerShell file (present since 0.1) stopped `SETUP-TRUCK-LOG.cmd`, `START`, `STOP`, `STATUS` and `LOGS` before they did anything. Fixed, and every PowerShell script is now checked.
- **Windows PowerShell 5.1 stopped on harmless Docker messages:** commands like "does this volume exist?" write to stderr when the answer is no, and Windows PowerShell 5.1 treated that as a fatal error. About 40 Docker calls across the setup and RXO scripts now tolerate it, and a check keeps it that way.
- **Setup crashed writing `.env`:** a helper stored its results in `$matches`, a name PowerShell reserves, so setup failed with "A hash table can only be added to another hash table". Renamed, and a check now rejects assignments to PowerShell's reserved variables.
- **Older installs are caught:** setup and start stop with a clear list when another install's containers or volumes use Truck Log's names. `REMOVE-OLD-TRUCK-LOG-INSTALL` removes them after you type `REMOVE`.
- **Image version can't drift:** the image tag always comes from `VERSION`. Before, an old `TRUCK_LOG_RELEASE` setting could build 1.0.0 code tagged `0.1`.
- **Ports:** setup uses the web port configured in `.env`.
- **Old databases:** setup stops, with instructions, when an old test database volume exists.
- **Newline check:** the check meant to catch multi-line values didn't work. Fixed.
- **Print Agent credential script:** it was a `.cmd` file with hidden base64-encoded JavaScript. It is now a readable wrapper, and a Linux version was added.
- **Permissions:** shell scripts ship executable.
