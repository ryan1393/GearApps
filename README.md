# TruckLog

| Folder | What it is | Version |
| --- | --- | --- |
| `truck-log/` | Truck Log server and web app (Docker). Start with `truck-log/README.md`. | 1.0.3 |
| `print-agents/` | Windows print PC programs: guard shack print agent and SAP packing-slip watcher. Start with `print-agents/README-FIRST.txt`. | V4R7 / W3 |

DANA UI (the shared styling package) lives in its own repo. Truck Log builds from the pinned copy in `truck-log/vendor/dana-ui/`.

## Update an existing Windows-controlled installation

Extract this complete package into a new folder. In PowerShell, open that folder and run:

```powershell
.\UPDATE-TRUCKLOG.cmd
```

Choose the **old working installation's `.env`** when the file picker opens. The helper copies that configuration into `truck-log/`, backs up any different configuration already there, and builds/starts the new app on the selected Docker context. Existing database volumes and administrator accounts are reused. HTTPS configuration keeps both Compose files. You can also provide the old file directly: `.\UPDATE-TRUCKLOG.cmd -OldEnv "C:\path\to\old\truck-log\.env"`.

For a new installation, use `truck-log\SETUP-TRUCK-LOG.cmd` instead. Detailed instructions are in `truck-log/README.md`.

## Connect an extracted ZIP to local Git

Install Git for Windows, then run this from the complete package folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Connect-TruckLog-Git.ps1
```

Complete GitHub sign-in if prompted. The helper attaches the repository history and `origin/main` while preserving your working files and local `.env`. Review `git status` before pulling or committing changes. A folder already containing Git history is left for you to inspect.
