TRUCK LOG — TWO WINDOWS PRINT AGENTS
Updated 2026-11-10 (credential repair; services remain V4R7 / W3). Target print PC: USFTWLDAPP.

RUNNING GUARD SERVICE WITH HTTP 401 / OFFLINE:
 Run 01-Guard-Shack-Agent\REPAIR-PRINT-AGENT-CREDENTIAL.cmd as administrator
 on the print PC. It checks the installed server address and credential, then
 guides an in-place credential replacement when authentication is rejected.
 Its token prompt is hidden and local; the existing V4R7 service stays installed.

THIS ZIP HAS TWO SEPARATE COMPONENTS:

1. 01-Guard-Shack-Agent
   Truck-Log-Dual-Gate-Print-Agent-Service-V4R7.cmd: the recovered V4R6
   service with two reliability fixes (a brief printer outage no longer
   stalls polling; finished print results are kept on disk and re-sent until
   the server confirms them), plus its embedded Node/C# sources and test
   PDFs. This is the Windows service that polls authenticated Truck Log PDF
   print jobs for the two guard gate printers. See its README for what
   changed and how to update an existing V4R6 service in place.

2. 02-SAP-Queue-Watcher  (W3)
   A NEW, INDEPENDENTLY RECONSTRUCTED SAP capture watcher implementation,
   its machine-local INI template, Windows-service installer, check/status/
   start scripts and local tests. Its route settings are now managed in
   Truck Log > Admin > Printing and it runs as a Windows service.
   THIS IS NOT THE ORIGINAL V3 CLEAN SOURCE. The original V3 release scan is
   included for comparison, and RECOVER-ORIGINAL-V3.cmd can archive the
   original V3 files already on USFTWLDAPP if they are still present.

DO NOT RUN BOTH THE ORIGINAL V3 WATCHER AND THE RECONSTRUCTED WATCHER.
DO NOT REINSTALL THE GUARD SERVICE ON AN ALREADY RUNNING HOST WITHOUT PLANNING
THE CHANGE. The V4R7 installer (like V4R6) is for a fresh install and
refuses to overwrite an existing service; 01-Guard-Shack-Agent\README.txt
describes the in-place update of an existing V4R6 service.

FIRST:
  - Extract this ZIP on the Windows print PC USFTWLDAPP.
  - Run CHECK-BOTH-READ-ONLY.cmd. This does not print or change settings.
  - To recover the exact original SAP V3 code, run:
      02-SAP-Queue-Watcher\RECOVER-ORIGINAL-V3.cmd
    It creates a SEPARATE local ZIP if the original V3 folder exists.
  - See each component's README for controlled installation/testing.

GUARD SERVICE:
  - Approved EAST: \\USFTWPLVPS03\USFTWP_E_Gate_Pass
  - Approved WEST: \\USFTWPLVPS03\USFTWP_W_Gate_Pass
  - Windows service: TruckLogPrintAgent, runs as LocalSystem.
  - Requires current Truck Log print API and host-specific credential setup.
  - No live tokens, local encrypted credentials, or printer drivers in this ZIP.
  - Agent prints PDF jobs supplied by the server; server application controls
    which slip and uploaded documents are queued and their order.

SAP WATCHER (W3):
  - REQUIRES a Truck Log version with database migration 0004 (packing-slip
    routes). Upgrade Truck Log first.
  - ROUTE SETTINGS NOW LIVE IN TRUCK LOG > ADMIN > PRINTING: per route
    name, SAP capture queue, output printer, mode OFF / TEST / LIVE and
    "upload to Truck Log". The migration seeds them from the old INI with
    every route TEST and upload off. Switching a route to LIVE there (audited
    admin confirmation) starts paper printing; live_print_armed is gone.
  - The watcher fetches the settings every 60 s with its own print-agent
    token, keeps the last good copy on the PC and keeps running on it when
    Truck Log is unreachable. With no copy yet, every route is TEST with
    upload off (prints nothing). watcher.ini holds only PC-local settings
    (folders, SumatraPDF, timings, OCR, Truck Log address, capture queue limit).
  - RUNS AS A WINDOWS SERVICE: TruckLogPackingSlipWatcher, LocalSystem,
    Automatic (Delayed Start), restarts on failure, works after a reboot with
    nobody signed in. Install with 02-SAP-Queue-Watcher\INSTALL-WATCHER-
    SERVICE.cmd (Run as administrator); it removes the old sign-in task
    (asks first), migrates the stored token to a machine-sealed credential
    readable only by SYSTEM/Administrators, and refuses while another SAP
    watcher runs. STATUS-WATCHER-SERVICE.cmd / REMOVE-WATCHER-SERVICE.cmd.
    START-WATCHER.cmd remains for a foreground debug run.
  - Like the guard service it prints to the \\USFTWPLVPS03 queues as
    LocalSystem (the PC's computer account).
  - W3 captures into a bounded durable FIFO independently of verification
    and printing, so slow printers/OCR do not block other route polling.
    READY entries resume; interrupted ACTIVE entries require manual review.
    Pre-existing staging captures at startup are quarantined, never printed
    automatically. At QUEUE-FULL stop SAP submissions and investigate.
  - W3 upgrades protect the credential BEFORE applying any nonsecret state
    permissions; recursive ACL resets are removed.
  - Reads the 8 local Microsoft Print to PDF staging files at:
      C:\TruckLog\CaptureStaging\route1..route8\capture.pdf
  - Verifies Packing Slip/List and a unique 8-digit Delivery Number;
    organizes PDFs under C:\TruckLog\PackingSlips\<route>.
  - The reconstructed watcher quarantines unverified PDFs instead of printing
    them. This intentionally differs from historical V3 behavior.
  - Uploads VERIFIED slips to Truck Log on routes with upload switched on,
    with its OWN print-agent identity (never the guard agent's token).
    Does NOT create printer queues; it uses already-configured Windows PDF
    capture queues.

TESTED IN THIS ZIP:
  - Guard V4R7 isolated Node tests: 131/131 PASS (includes printer outage
    and recovery, and result posts failing across a simulated restart).
  - Reconstructed queue watcher W3: 90 Python tests run on Linux; 88 passed,
    2 Windows-administrator NTFS ACL tests skipped. Includes slow-printer
    multi-route capture, FIFO, restart replay prevention, queue backpressure,
    changed-PDF rejection, startup quarantine and renderer cancellation.
  - V4R7 installer boot/bundle/nested hashes regenerated with the original
    mechanism and re-verified; the build tool reproduces the original V4R6
    installer byte-for-byte from its sources.
  - NOT tested on USFTWLDAPP, Windows printer interfaces, live API, or paper.
    The watcher's C# service host and PowerShell installer were not compiled
    or run (no Windows here); they follow the guard's proven pattern.

NOTE: The guard V4R7 installer is the recovered V4R6 production source plus
the two documented reliability fixes.
The SAP watcher is a safe reconstruction until its V3 source is recovered from
USFTWLDAPP. Do not treat this ZIP as an on-site-accepted replacement for V3.

DEPENDENCIES: Exact-pinned Python requirements audited with pip-audit 2.10.1;
no known vulnerabilities in all five pinned packages. Optional OCR now needs
Python 3.11+ for patched Pillow 13; text-only remains Python 3.10+. See
02-SAP-Queue-Watcher/DEPENDENCIES.md and DEPENDENCY-AUDIT.json for scope.
Actual PDF/raster/OCR smoke tests passed on Linux; Windows x64/Python 3.11
wheels resolved/downloaded, but native Windows execution is not validated.
