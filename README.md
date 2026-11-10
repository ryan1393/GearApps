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

## Connect an extracted ZIP to local Git

Install Git for Windows, then run this from the complete package folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Connect-TruckLog-Git.ps1
```

Complete GitHub sign-in if prompted. The helper attaches the repository history and `origin/main` while preserving your working files and local `.env`. Review `git status` before pulling or committing changes. A folder already containing Git history is left for you to inspect.
