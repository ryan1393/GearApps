# Truck Log Dedicated Print PC V3 — release scan

Build validation: **PASS — 80/80 checks**. On-site Windows/paper validation: pending.

## Problem addressed

The V2 folder contains overlapping command launchers. The running
`TruckLogPrintAgent` service is the separate East/West guard printing agent.
Changing the SAP packing-slip INI does not reconfigure that service.

## Changes

- One root command, `Truck-Log-SAP-Capture-V3.cmd`, provides Check, Start,
  graceful Stop, Restart, settings editing, local capture queue setup/sharing,
  optional user sign-in startup, dependency installation and log/folder access.
- One background SAP process owns capture polling and the folder watchers.
  It starts the folder observers before moving a staged PDF into Incoming.
- Accepted work is serialized per route and drained on stop. Repeated events for
  an already accepted path are suppressed. Stop never force-kills a process.
- Detects older SAP Python copies before starting; an OS-held V3 lock prevents
  simultaneous V3 runtimes across package folders. Old Incoming documents are
  not replayed at startup. Staged documents are processed on start.
- Imports the existing V2 INI without changing its bytes. Existing V3 settings
  are not overwritten. A template is used only if no INI is found.
- Template follows the photographed eight routes: routes 1–7 in test mode,
  DGL live and pointed to `\\USFTWPLVPS03\USFTWP_DGL_Ricoh`.
- Rejects a live route aimed at a PDF/capture queue, duplicate capture names,
  overlapping document directories, and stale capture mappings.
- Capture queue setup verifies Microsoft Print to PDF, the staging port and
  sharing. Sharing failure is reported instead of silently ignored. Existing
  compatible capture share names are preserved.
- Startup migration backs up and disables identified older SAP startup tasks,
  registers one V3 task for the installing user's sign-in and starts V3. It does
  not install a Windows service. Signing out stops this user-session workflow.
- Includes the previously delivered dock-PC printer installer unchanged inside
  `Dock-PCs`. It is separate from the host's single control command.

## Preserved / protected

- The V2.3 PDF extraction, classification, print submission and retention engine
  is byte-equivalent after the single required package-root path adjustment.
- PyPDF → PyMuPDF → optional Tesseract; one unique eight-digit Delivery Number
  plus a Packing List/Slip marker are still required for a verified packing slip.
- Existing Incoming/Ready files are not cleared. The existing V2 folder is not
  patched, moved, or deleted. Settings/task/queue snapshots are stored locally.
- No Docker, web/API, RXO, database, production print-server queue, default
  printer, Spooler, printer security policy or guard-service changes.
- No automatic upload, visit association, Goods Receipt detection or new
  third-party printer driver is introduced.
- **npm install required: NO.** Python dependencies may be installed into the
  package's private `.venv` through menu option 9 when needed.

## Verification performed

| Area | Passing checks |
| --- | ---: |
| Python configuration, lifecycle and real filesystem/PDF workflow | 34 |
| Exact embedded PowerShell parser and Windows-control mocks | 31 |
| Executed bootstrap, integrity, packaging and Python compilation | 15 |
| Total | 80 |

The exact PowerShell payload was extracted from the delivered CMD using the
same line markers and newline joining as its bootstrap. Both payload and
bootstrap were parsed by a real PowerShell 7.4.19 parser. No parser errors.
The implementation uses Windows PowerShell 5.1-compatible syntax, but it has
not been run under native Windows PowerShell 5.1 in this build environment.

The actual encoded bootstrap was executed with a path containing spaces,
Unicode and metacharacters. Changed payloads, duplicate/missing markers,
parser-invalid payload with a matching hash, changed supporting code and
changed package manifests all failed before runtime execution.

The PDF integration test used a real generated packing-slip PDF, real PyPDF
classification, actual filesystem observer events, staging movement and the
Ready move. It confirmed one **simulated** print submission, preserved an older
Incoming document, and confirmed a drained stop. It did not send paper.

Windows printer/task/CIM interfaces were mocked. Tests covered share failures,
share-name collisions, wrong drivers, config import preservation, old-process
blocking, uninspectable processes, PID reuse, task scope and path quoting.
Windows `cmd.exe`, printer creation/sharing, PDF port output, Windows lock
behavior, network printer permissions, sign-in tasks and real paper output
still require on-site validation.

## Material limits retained from the current workflow

1. The capture port still writes a single staging file per route. Concurrent or
   burst jobs to one capture queue are not certified; test one job at a time.
2. Existing V2.3 behavior prints unverified/non-packing documents and deletes
   their temporary PDF after successful live submission. It does not currently
   put those documents in NeedsReview. This release preserves that behavior.
3. Sumatra's successful return is print submission evidence, not confirmation
   that a physical sheet arrived. Check paper and the correct Ready PDF.
4. A process exit or logoff during printing can leave an uncertain result.
   No automatic Incoming replay is added. Verify before manually resubmitting.
5. A queue setup failure can leave already completed capture queue changes in
   place. It reports the error and retains the old manifest until every route
   verifies; it does not silently remove printer queues during rollback.
6. Imported settings always win. If the saved V2 INI still points DGL at
   Microsoft Print to PDF in live mode, Check rejects it; edit the DGL paper
   destination and save rather than silently rewriting your settings.

## First on-site check

Extract to its own V3 folder, save the V2 INI, stop idle V2 SAP consoles, and run
the root CMD as Administrator on USFTWLDAPP. Choose Check, resolve any listed
setup requirement, then Start. Send one new DGL packing slip and verify both
the physical sheet and the correct Delivery Number PDF in DGL\Ready.
Use the existing dock-PC installer only after the host capture queues are shared.

## Build fingerprints

- CMD SHA-256: `d8d27112674f7000c831b7f7f5d4df222bbf8fb3d9ee07de32ef624f05775aeb`
- Embedded PowerShell SHA-256: `5d511b85701e2007b0226e95ef7a1c90d080253c2c08a8b52415eeaa817bb4e9`
- Runtime manifest SHA-256: `778fedc699f0a6c787352ef50313819192902975c2713a9114806206118440b4`
- Longest CMD line: 5177 characters (below 8191).

## Technical references

- Microsoft Set-Printer: https://learn.microsoft.com/en-us/powershell/module/printmanagement/set-printer
- Microsoft New-ScheduledTaskPrincipal: https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal
- Python thread shutdown behavior: https://docs.python.org/3/library/threading.html

## Final summary

V3 consolidates SAP capture controls while preserving the current document
engine and your saved settings. Build checks pass; installation and actual
printing remain to be confirmed on USFTWLDAPP.
