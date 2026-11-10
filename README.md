# TruckLog

| Folder | What it is | Version |
| --- | --- | --- |
| `truck-log/` | Truck Log server and web app (Docker). Start with `truck-log/README.md`. | 1.0.5 |
| `print-agents/` | Windows print PC programs: guard shack print agent and SAP packing-slip watcher. Start with `print-agents/README-FIRST.txt`. | V4R7 / W3 |

DANA UI (the shared styling package) lives in its own repo. Truck Log builds from the pinned copy in `truck-log/vendor/dana-ui/`.

## Upload from Windows and run on the Linux server

Extract this complete package into a new folder. In PowerShell, open that folder and run:

```powershell
.\DEPLOY-TRUCKLOG-LINUX.cmd
```

The command uses the working `.env` in `truck-log/` when present, or opens a file picker. Choose the **old working installation's `.env`**. You can also pass it explicitly:

```powershell
.\DEPLOY-TRUCKLOG-LINUX.cmd -OldEnv "C:\path\to\old\truck-log\.env"
```

It reads the SSH destination from your current Docker context, creates a verified source ZIP, and uses **SCP** to upload the package, the configuration separately, and the Linux deployment helper. It then uses **SSH** to build and start the app directly on that server. Existing database volumes and administrator accounts are reused; HTTPS uses both Compose files.

The server needs Python 3 and access to its local Docker Engine and Docker Compose. Windows needs `ssh` and `scp` available in PowerShell. If the Docker context uses TCP instead of SSH, specify the SSH destination with `-Server user@linux-host` (or `-Server ssh://user@linux-host:2222`). Keep normal SSH host-key verification enabled and complete any sign-in prompt locally.

Uploads are stored in a private `~/truck-log-releases/<unique-id>/` folder on Linux. The uploaded configuration and extracted app `.env` are private. Native build output is redacted before display and is saved on the server as `deploy.log`; a failed build returns the actual failure code. The local source `.env` stays intact, and it is excluded from the source archive. `UPDATE-TRUCKLOG.cmd` is also an alias for this SCP/SSH deployment flow.

For a new installation, use `truck-log\SETUP-TRUCK-LOG.cmd` instead. Detailed instructions are in `truck-log/README.md`.

After deployment, sign in as an administrator and use **Scan Now** in **RXO Control Center** or **RXO Expedite**. Each button queues that integration's own scheduler; watch its last successful export and latest import to confirm completion.

## First-time `.env` and changing passwords

A first-time ZIP can include a ready-made `truck-log/.env` holding a unique generated database password and signing secret, so `DEPLOY-TRUCKLOG-LINUX.cmd` and `SETUP-TRUCK-LOG` run without choosing a file. It is for a **new** server only. A server that already has Truck Log data must keep using its existing `.env`: replace the included file with it before deploying. `.env` is never committed to Git.

After the first start, create the administrator and replace the included values, from the `truck-log` folder:

```powershell
.\SETUP-TRUCK-LOG-ADMIN.cmd --bootstrap
.\CHANGE-TRUCK-LOG-PASSWORDS.cmd --all-generated
```

Run `CHANGE-TRUCK-LOG-PASSWORDS.cmd` without options to list every password it can change (administrator, database, signing secret, RXO logins). Linux uses the matching `.sh` files. Details: `truck-log/README.md`.

## Print agent reports HTTP 401

A running Windows service can be offline in Truck Log when its saved credential is rejected. On the print PC, run `print-agents\01-Guard-Shack-Agent\REPAIR-PRINT-AGENT-CREDENTIAL.cmd` as administrator. It checks the configured server, agent identity and existing credential first. If a replacement is needed, it displays the command to create a credential on that Truck Log Docker host and accepts the new token in a hidden local prompt.

The repair validates the replacement before changing the installed credential. It preserves the configured printers and print journals and restarts a previously running service. The server application remains version 1.0.5; this repair tool runs on the Windows print PC.

## Connect an extracted ZIP to local Git

Install Git for Windows, then run this from the complete package folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Connect-TruckLog-Git.ps1
```

Complete GitHub sign-in if prompted. The helper attaches the repository history and `origin/main` while preserving your working files and local `.env`. Review `git status` before pulling or committing changes. A folder already containing Git history is left for you to inspect.
