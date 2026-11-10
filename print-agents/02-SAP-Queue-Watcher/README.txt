SAP PACKING-SLIP CAPTURE QUEUE WATCHER - W3 (2026-10-29)

IMPORTANT: This Python implementation is an independent, safety-oriented
reconstruction, NOT the original 'Truck Log Dedicated Print PC V3 — Clean'.
The actual old package was not available to include here. The historical
V3 release scan is attached for reference. Recover the original on host:
   RECOVER-ORIGINAL-V3.cmd
The recovery utility looks in:
   C:\Temp\Truck-Log-Dedicated-Print-PC-V3\Truck-Log-Dedicated-Print-PC-V3
It creates a separate source/config ZIP and does NOT modify the installation.
If V3 is still working, keep it running and do not start this replacement.

WHAT IT DOES:
- Polls the eight existing Windows 'Microsoft Print to PDF' file-port capture
  files C:\TruckLog\CaptureStaging\route1..route8\capture.pdf.
- Waits for file-size/write-time stability, then moves the file into a
  unique per-route Incoming PDF, writes a journal entry and commits a durable
  FIFO capture-queue entry. A separate worker verifies and prints accepted
  files; slow printers, PDF extraction and OCR never block staging polling.
- Checks basic PDF structure (max 25 MiB, the Truck Log limit) and requires a
  Packing Slip/Packing List marker AND exactly one labelled 8-digit Delivery
  Number. Text is read with pypdf, then PyMuPDF, then (if ocr_enabled = yes)
  Tesseract OCR. OCR is also tried when a text layer exists but has no
  labelled Delivery Number. A text layer with two different numbers is
  rejected and OCR cannot override that.
- Verified PDFs go to Ready; unverified, malformed and uncertain outputs go to
  NeedsReview and are never printed or uploaded. Do not delete them blindly.
- Runs as the Windows service TruckLogPackingSlipWatcher (LocalSystem), so it
  works after a reboot with nobody signed in. START-WATCHER.cmd is only for a
  foreground debug run.
- Writes state/journal/log/outbox under C:\TruckLog\SAPWatcherState.
- Does NOT create/change any Windows print queue, share name, or port.

ROUTE SETTINGS COME FROM TRUCK LOG (Admin > Printing):
Per route 1..8 Truck Log holds: name, source queue (Windows SAP capture queue
name), output printer (UNC, e.g. \\USFTWPLVPS03\USFTWP_DGL_Ricoh), mode and
"upload to Truck Log". Requires a Truck Log version with database migration
0004 (packing-slip routes); the migration seeds the routes from the old
watcher.ini, all TEST with upload off.
  OFF   route ignored: its capture file is not read.
  TEST  verify, file under Ready/NeedsReview, upload if switched on; NEVER
        prints to paper.
  LIVE  as TEST, plus verified slips are printed to the output printer with
        SumatraPDF. Unverified slips go to NeedsReview, never to paper.
Switching a route to LIVE in Truck Log (admin confirmation, audited) is all
that is needed to start paper printing; there is no second switch on the
print PC. (live_print_armed and the INI route lines are gone; an old INI
that still has them is refused with a message pointing here.)
How the watcher gets them:
- GET <api_base>/print-agents/packing-slip-routes with its print-agent token,
  at start and every 60 s (If-None-Match; 304 = unchanged).
- The document is re-checked (routes 1..8 sorted, names 1-60 chars, source
  queues 1-120 chars and unique among routes that are not OFF, UNC output
  printer required for LIVE, no control characters). If anything is wrong
  the WHOLE document is rejected, logged (CONFIG-REJECT) and the current
  settings stay.
- The last good document is kept in C:\TruckLog\SAPWatcherState\
  route-config.json (written atomically). If Truck Log cannot be reached
  (network, credential, 401/403, 404 = server without migration 0004) the
  watcher keeps running on that copy and logs it once per outage
  (CONFIG-OFFLINE). With no copy yet, every route runs TEST with upload off
  (SAFE DEFAULT) - nothing is printed.
- A change is applied between captures, never in the middle of one file.
  watcher.log shows each applied version and every change per route, e.g.
    [CONFIG] route 8 DGL: TEST -> LIVE (version 9 by mlopez)
- Local safety net: a LIVE route whose printer looks like a PDF/capture
  queue (name contains pdf/capture or equals a route's source queue) runs as
  TEST on this PC, with a warning, to avoid a print loop.
- A file left in capture.pdf while a route was OFF is filed in NeedsReview
  (not printed) when the route is switched on. Capture provenance is persisted.
  At EVERY service/console start, pre-existing staging files have unknown
  creation mode and go to NeedsReview; they are never printed automatically.
- Pending captures retain their route settings from capture time. If a queued
  LIVE route is switched OFF/TEST or its printer changes before processing
  or while extraction runs, that capture goes to NeedsReview. Authorization
  is checked again at renderer handoff; an already-started print may finish.
  A TEST capture never becomes LIVE later.
- Uploads already queued in the outbox are still sent if upload is later
  switched off for that route.
watcher.ini now holds only machine-local settings: folders (per-route folders
derive from the route number; [routeN] may override capture_file / incoming /
ready / needs_review only), sumatra_path, timings, max_pdf_mb, ocr_enabled and
the [truck_log] connection.

WINDOWS SERVICE (why a small C# host):
INSTALL-WATCHER-SERVICE.cmd compiles WatcherServiceHost.cs with the .NET
Framework compiler that is part of Windows
(%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe) - the same
compiler and service pattern the guard agent TruckLogPrintAgent already uses
on this PC. pywin32 was not used: it is not otherwise needed, and its
pythonservice.exe/DLL registration is fragile inside a venv under LocalSystem.
The host starts
  <install>\.venv\Scripts\python.exe -I -u sap_capture_watcher.py run --service ...
in a kill-on-close Job object (no orphaned Python), stops it gracefully by
writing state_dir\service-stop.request (the watcher finishes the current
capture first) and exits when Python dies unexpectedly so Windows restarts it.
- Service name TruckLogPackingSlipWatcher, LocalSystem, Automatic (Delayed
  Start), depends on Spooler, restart after 10 s / 30 s / 60 s.
- Program, its own venv and the service's watcher.ini live in
  %ProgramFiles%\TruckLog\PackingSlipWatcher (only Administrators can change
  them; LocalSystem must not run code a normal user can edit). Python must
  therefore be installed for ALL USERS (the installer refuses a per-user
  Python under C:\Users unless -AllowPerUserPython).
- Logs (all in state_dir): watcher.log (watcher), service-host.log (host
  start/stop/crash), watcher-service-console.log (Python tracebacks).
  Logs roll over to *.1 at about 10 MiB.
- state_dir ACL is set to SYSTEM + Administrators full, Users read.
- Network printers: the service prints to \\USFTWPLVPS03\... as LocalSystem,
  exactly like the guard service does for the gate printers. Printing uses
  the PC's computer account, so the print server must allow this PC (it
  already does for the guard queues; check the route queues the same way).
  A printer added only for one signed-in user is not needed - the UNC path is
  used directly.
- use_system_proxy = yes under LocalSystem means the SYSTEM account's proxy
  settings, not the signed-in user's. Default no = direct connection.

CREDENTIAL (DPAPI LocalMachine + ACL):
The token is needed for the route settings AND for uploads. A CurrentUser
DPAPI credential (used by earlier packages) cannot be decrypted by
LocalSystem. The credential is therefore sealed with DPAPI LocalMachine
(dpapi_scope = LocalMachine) and the file C:\TruckLog\SAPWatcherState\
truck-log-upload.credential is restricted to SYSTEM and Administrators
(icacls; the restriction is applied before the token is written). This is
the same model as the guard agent's machine-sealed credential.
- INSTALL-WATCHER-SERVICE.cmd migrates an existing CurrentUser credential
  automatically when run by the Windows user who stored it. Otherwise run
  SETUP-TRUCK-LOG-UPLOAD.cmd (as Administrator) and paste the token again, or
  issue a new one with --rotate on the Truck Log host.
- The service re-reads the credential within a minute after
  SETUP-TRUCK-LOG-UPLOAD.cmd; no restart needed. While it has no usable
  credential it runs on the cached settings (or the safe default).
- CHECK-WATCHER.cmd / START-WATCHER.cmd need an elevated prompt to read it.

PROVISION THE TRUCK LOG AGENT (once):
It needs its OWN Print Agent identity. Do NOT reuse the guard shack agent's
id or token: the two agents would overwrite each other's status and rotating
one would break the other.
 a) On the Truck Log host (folder with docker-compose / the Truck Log code):
      SETUP-PRINT-AGENT-CREDENTIAL.cmd --agent-id trucklog-sap-watcher-01 --name "SAP packing slip watcher (USFTWLDAPP)"
    (Linux: ./SETUP-PRINT-AGENT-CREDENTIAL.sh with the same arguments, or
     docker exec truck-log-server node tools/truck-log/provision-print-agent.mjs --agent-id trucklog-sap-watcher-01 --name "SAP packing slip watcher (USFTWLDAPP)")
    It prints "Bearer token (shown once): tlpa_...". The watcher uses
    documents:upload (route settings and uploads) and the read-only
    setup-check. Use --rotate only to replace a lost/leaked token for this
    same agent id; it revokes that agent's previous tokens.
 b) In watcher.ini [truck_log]: set api_base (https://<truck-log-host>/api/v1)
    and keep agent_id = trucklog-sap-watcher-01 (must match step a).
 c) On USFTWLDAPP run SETUP-TRUCK-LOG-UPLOAD.cmd as Administrator and paste
    the token (hidden). It confirms the token and agent id with Truck Log.
The token never goes into watcher.ini (the watcher refuses a token= key) and
is redacted from logs and stored errors. http:// is refused unless
allow_http = yes. HTTP redirects are refused (fix api_base instead).

INSTALL ON USFTWLDAPP (first time, or replacing the sign-in task):
1. Truck Log must already run a version with migration 0004. In Truck Log >
   Admin > Printing check the 8 routes (seeded from the old INI, all TEST,
   upload off).
2. Extract this package to a NEW folder. Do not extract into the old V3
   folder or overwrite any old INI, PDFs or Python environment. If the
   original V3 watcher is still the one in use, keep it and do not install
   this one (RECOVER-ORIGINAL-V3.cmd archives V3's source read-only).
   DO NOT stop TruckLogPrintAgent (separate guard service).
3. Install Python 3.10+ (Python 3.11+ for optional OCR) for all users
   if it is not (python.org installer,
   "Install for all users"). Optional: INSTALL-PYTHON-DEPS.cmd creates a venv
   in this folder for CHECK-WATCHER.cmd before the service exists.
4. Edit watcher.ini here: [truck_log] api_base / agent_id; folders only if
   they differ. Nothing about routes.
5. Close a running console watcher (Ctrl+C) and stop any original V3 watcher.
6. Right-click INSTALL-WATCHER-SERVICE.cmd > Run as administrator. It:
   refuses if another SAP watcher process or a foreign SAP watcher startup
   task exists; offers to remove this package's old sign-in task
   (TruckLogSAPCaptureWatcher-Restored); copies the program to
   %ProgramFiles%\TruckLog\PackingSlipWatcher with its own venv (pip needs
   network once; -WithOcr adds the OCR packages); validates watcher.ini;
   sets the state folder ACL; migrates/locks down the credential; compiles
   the host; registers and starts the service and shows the log.
7. If it reports no usable credential: SETUP-TRUCK-LOG-UPLOAD.cmd as
   Administrator.
8. STATUS-WATCHER-SERVICE.cmd (as Administrator): service Running, Automatic
   (Delayed), LocalSystem; Truck Log REACHABLE with the expected version;
   each route's mode/printer/upload; cache age.
9. Print a test slip on each route: a PDF appears in its Ready folder.
10. In Truck Log switch upload on where wanted, then DGL to LIVE when ready;
    within a minute watcher.log shows "route 8 DGL: TEST -> LIVE ...".
    Print one DGL slip and physically check the printer.
11. Reboot the PC without signing in, then check from another session (or
    after signing in) that the service is Running and watcher.log shows
    START after the reboot.
UPGRADE an installed service: extract the new package, run
INSTALL-WATCHER-SERVICE.cmd again (stops, updates program and venv, keeps
the installed watcher.ini unless -ReplaceConfig, restarts).
REMOVE: REMOVE-WATCHER-SERVICE.cmd (keeps state, credential and all PDFs;
-DeleteProgramFiles also removes the program folder).
After installing, edit %ProgramFiles%\TruckLog\PackingSlipWatcher\
watcher.ini (as Administrator) and restart the service for machine-local
changes; START-WATCHER.cmd, SETUP-TRUCK-LOG-UPLOAD.cmd use the installed copy
when it exists.

FOREGROUND DEBUG RUN:
Stop the service (net stop TruckLogPackingSlipWatcher, as Administrator),
then run START-WATCHER.cmd from an elevated prompt; Ctrl+C to stop; start
the service again. START-WATCHER.cmd refuses while the service runs, and the
watcher itself refuses to run next to another watcher process (process
check + lock file).

UPLOAD OUTBOX (C:\TruckLog\SAPWatcherState\outbox):
- pending\  verified slips waiting to upload. Written before any network call,
            survives restarts. Network errors, 5xx, 401/403 (credential),
            404 (server not upgraded), 408/429 and refused redirects are
            retried with backoff (30 s doubling to 15 min).
- sent\     accepted by Truck Log (response with documentId kept).
- failed\   permanently rejected (400/409/413/415/422, e.g. validation) or the
            filed PDF changed/disappeared. Each is also listed with the server
            message in outbox\UPLOAD-FAILED.txt.
The local PDF in Ready/NeedsReview is NEVER deleted or moved because of an
upload result. Retries reuse the same X-Idempotency-Key and sourceCaptureId,
so a retry after a lost response cannot create a duplicate. To retry failed
entries after fixing the cause (elevated prompt, installed copy):
   cd /d "%ProgramFiles%\TruckLog\PackingSlipWatcher"
   .venv\Scripts\python.exe -I sap_capture_watcher.py requeue-failed --config watcher.ini
Every upload lands in Truck Log as NEEDS_REVIEW / UNMATCHED until associated
with a visit there (server behaviour).

KNOWN LIMITATION - SHARED capture.pdf PER ROUTE (NOT SOLVED):
Each capture queue writes the SAME file name. If a second job is printed to
the same route before the watcher has moved the first one (about 2-3.5 s:
settle_seconds plus one poll), Windows overwrites the first file.
Mitigation in this watcher: as soon as a staged file looks complete
(%PDF header and %%EOF trailer) it is copied to SAPWatcherState\snapshots.
If the staged file is then replaced (size/time/content change, or SHA-256
differs at the final check) or disappears, the earlier snapshot is filed in
NeedsReview as RECOVERED_AFTER_OVERWRITE_NOT_PRINTED (logged as OVERWRITE),
never printed automatically, and uploaded with a review reason if verified.
This cannot help when the second job overwrites the first before the
watcher ever saw a complete first file (within one poll, ~1.5 s), or when
the spooler holds the file exclusively. Print slips one at a time per route.
If the capture printer/port can write unique file names (e.g. a PDF printer
with an auto-save naming pattern), that is the real fix; this watcher would
need a folder-watching mode for it, which is not implemented.

OTHER DIFFERENCES FROM ORIGINAL V3:
- In historic V3, nonmatching PDFs could still be printed live; this
  reconstruction quarantines them instead.
- It uses file polling instead of the watchdog observer library.
- A durable READY capture has not entered processing and resumes after a
  restart (with its frozen route settings and an unchanged PDF hash).
- Processing marks the queue entry ACTIVE before extraction/printing. Any
  ACTIVE entry left by a crash is quarantined for MANUAL investigation and
  is never automatically reprinted. Unqueued/orphan Incoming files also go
  to NeedsReview. Snapshots left by a stop/crash are preserved and reported
  at startup for manual review, including those deferred by queue saturation.
- capture-queue/ holds pending .json and active .active descriptors;
  capture-queue/review/ holds interrupted records. Do not delete these or
  retry uncertain paper output without checking the physical printer.
- max_pending_captures in watcher.ini defaults to 500 (valid 1..10000).
  At the limit, QUEUE-FULL is logged and new capture acceptance pauses:
  stop SAP submissions and investigate disk/printer health. No accepted
  PDF is dropped. Fixed capture.pdf ports can still overwrite arrivals
  faster than polling, or while the queue is full; this is not a Windows
  spool queue replacement.
- Service shutdown stops new processing, cancels its owned renderer if
  necessary and preserves pending work. Interrupted output stays uncertain,
  never an automatic reprint. Extraction still running at shutdown retains
  its ACTIVE descriptor for manual review on restart.
- Runs as a Windows service (V3 ran in a user session).
- The older-watcher check ignores this process's own launcher/parent
  python.exe (venv launcher) and ancestors, but refuses to start if any
  other SAP watcher Python process is running.
- No Print Agent heartbeat is sent; Truck Log may show the SAP watcher agent
  without a recent heartbeat. Upload results are visible per document.

TEST WITHOUT WINDOWS OR PRINTER (no paper, no network):
   python -I -m unittest discover -s tests -v
Uses mocks and a local 127.0.0.1 HTTP server (route settings fetch/304/
cache/offline/invalid document, modes, uploads). It does not exercise the
real Print Spooler, printer shares, Windows DPAPI, the compiled C# service
host or PowerShell process listing on Linux. The two installer ACL tests
require a Windows administrator and run the actual ACL helper against
temporary nonsecret files (including an interrupted upgrade); they skip
on Linux. They do not install services or change real printer settings.

W3 UPGRADE FROM W2:
1. Keep watcher.ini and all state/PDF folders. Do not remove the guard agent.
2. Run INSTALL-WATCHER-SERVICE.cmd as Administrator from this W3 package.
   It upgrades only the SAP service and keeps the installed INI by default.
   max_pending_captures defaults to 500 if omitted from an existing INI.
3. The installer protects an existing credential with an exact private
   SYSTEM/Administrators ACL BEFORE granting read access to nonsecret state.
   It never recursively resets child ACLs or temporarily exposes the token.
4. Review pre-existing staging/Incoming captures in NeedsReview after startup.
   Existing Ready PDFs, upload outbox, route cache and credentials are retained.
5. Run STATUS-WATCHER-SERVICE.cmd. The read-only check now reports pending,
   active and review capture counts and the configured queue limit.

The guard installer, its service version and all embedded payloads are unchanged
from V4R7. This package has no claim of live Windows/site acceptance.

DEPENDENCY UPDATE (W3): requirements are exact-pinned and pip-audit reports
no known vulnerabilities across all five runtime packages. Optional OCR now
requires Python 3.11+ because the patched Pillow version requires it. Existing
OCR installs must upgrade their service venv and use -WithOcr to update the
optional packages. See DEPENDENCIES.md / DEPENDENCY-AUDIT.json for the exact
versions, real PDF/OCR test evidence and audit scope.
