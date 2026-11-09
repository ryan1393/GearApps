GUARD SHACK PRINT AGENT — V4R7 INSTALLER (reliability fix of recovered V4R6)

FILE: Truck-Log-Dual-Gate-Print-Agent-Service-V4R7.cmd

This is the standalone installer that deploys the guard-shack
TruckLogPrintAgent Windows service on the print host USFTWLDAPP.
It uses authenticated Truck Log API queues and prints PDF jobs for the
EAST/WEST guard gate printers using SumatraPDF. Server-side print packet
composition determines the Driver/Dock Assignment Slip and which uploaded
PDF documents follow it. The Windows agent prints the jobs it is assigned;
it does not itself choose or assemble the uploaded documents.

WHAT CHANGED IN V4R7 (agent version 4.0.7-service; core.cjs, agent.cjs,
selftest.cjs, setup.cjs labels, test PDF labels):
 1. A brief printer/share/spooler access failure no longer stalls the agent.
    - The printer reachability check now runs BEFORE the durable print-intent
      marker. An unreachable printer is retried for the same job with bounded
      backoff (2s, 4s, 8s, 16s, 30s...; at most 8 checks, never past the
      lease). If it never recovers in time the job is reported FAILED to the
      server as "Not printed" (nothing was sent to the printer); a guard can
      retry it from Truck Log as usual.
    - A renderer that could not start is retried the same way. A renderer
      that started and then failed or timed out is still UNCERTAIN: it is
      reported FAILED with an "inspect the printer before any guard retry"
      message and is never reprinted automatically.
    - No condition parks the poll loop any more. Anomalies (uncertain
      interruption, refused result, invalid job) are written to a sealed,
      bounded review journal, logged with "REVIEW:", and reported in the
      heartbeat lastError; polling continues.
    - One unreachable gate no longer takes the other gate offline: the
      heartbeat advertises only the gates LocalSystem can open right now, so
      the server keeps the down gate's jobs QUEUED until it is back.
 2. Finished print results are no longer lost when result posts/heartbeats
    fail for a while.
    - Results go to a durable outbox (data\outbox.dpapi, machine-DPAPI
      sealed like the job state; at most 200 entries) and are re-sent with
      the SAME X-Idempotency-Key and byte-identical body until the server
      acknowledges them. The server replays a stored response for a reused
      key, so a resend cannot double-count.
    - Result delivery no longer waits for a healthy heartbeat (only NEW
      claims do), and survives service restarts.
    - When the outbox is full, no new jobs are claimed (backpressure); a
      finished result is never dropped. A result still unacknowledged after
      6 days (server idempotency records last 7) moves to the review journal.
 Unchanged: ServiceHost.cs / TruckLogPrintAgent.exe (DPAPI entropy and
 credential format), token handling and log redaction, installer flow.

BEFORE INSTALLING:
 - Run the root CHECK-BOTH-READ-ONLY.cmd to inspect the live service.
 - If TruckLogPrintAgent is already installed, the installer refuses to
   replace it (fresh-install only). Either remove the old service first
   (sc stop / sc delete; the installer backs up the old folder to
   _patch_backups) or update the three agent files in place - see
   "UPDATING AN EXISTING V4R6 SERVICE" below.
 - To install on a NEW Windows print PC, use Administrator and run the
   CMD on the print PC itself (not the Windows Docker development PC).
 - Requires matching Truck Log server print-agent API, credentials, network,
   access to both printer shares, and its prompted East/West print tests.
 - Installer downloads known Node/Sumatra binaries and verifies
   their SHA256; network dependency availability is not guaranteed.
 - DO NOT distribute the host's credential file/config or API tokens.

UPDATING AN EXISTING V4R6 SERVICE IN PLACE (keeps credential/activation):
 Administrator PowerShell on USFTWLDAPP, from this folder:
   $d = Join-Path $env:ProgramData 'Dana\TruckLogPrintAgent'
   Stop-Service TruckLogPrintAgent
   # Rollback copy INSIDE the locked-down folder (never copy data\ elsewhere):
   $rb = New-Item -ItemType Directory "$d\v4r6-rollback"
   Copy-Item "$d\core.cjs","$d\agent.cjs","$d\selftest.cjs","$d\manifest.json" $rb
   Copy-Item .\original-source\core.cjs,.\original-source\agent.cjs,.\original-source\selftest.cjs $d -Force
   $m = Get-Content "$d\manifest.json" -Raw | ConvertFrom-Json
   foreach ($f in 'core.cjs','agent.cjs','selftest.cjs') {
     $m.hashes.$f = (Get-FileHash "$d\$f" -Algorithm SHA256).Hash.ToLowerInvariant() }
   $m.version = '4.0.7-service'
   $m | ConvertTo-Json -Depth 5 | Set-Content "$d\manifest.json" -Encoding ASCII
   Start-Service TruckLogPrintAgent
 (ASCII matters: a UTF-8 BOM would make manifest.json unreadable to Node.)
 The existing config.json (agentVersion 4.0.6-service) is accepted by V4R7.
 A V4R6 REVIEW hold is archived into the review journal and polling resumes;
 a V4R6 pending result is moved, unchanged, into the outbox and re-sent.

KNOWN ORIGINAL QUEUES:
 EAST: \\USFTWPLVPS03\USFTWP_E_Gate_Pass
 WEST: \\USFTWPLVPS03\USFTWP_W_Gate_Pass

SOURCE:
 - original-source/setup.cjs (embedded self-contained installer)
 - original-source/core.cjs, agent.cjs, ServiceHost.cs, selftest.cjs
 - original-source/test-EAST.pdf and test-WEST.pdf
 The .cmd embeds exactly these files (same nested-bundle and SHA-256 pinning
 mechanism as V4R6; boot, bundle and per-file hashes regenerated).

LOCAL NONPRINTING TEST:
   cd original-source
   node selftest.cjs

Expected: 'V4R7 isolated agent tests: 131/131 PASS'.
Includes simulated printer outage then recovery, printer down for a whole
lease, renderer launch failure, and result posts failing repeatedly across a
simulated service restart against a fake server with Truck Log's idempotent
result contract (result recorded exactly once).
No live guard job, API call, printer/Windows service action was part of that
isolated test. Real slip+uploaded-documents packet printing must still be
checked against the installed Truck Log server/API on both gates.
