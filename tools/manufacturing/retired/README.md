# Retired tests

Kept for reference only; nothing runs these.

- `test-blade-workflow-r37.cjs`: isolated R37 blade-workflow harness. Retired in 70.1.0:
  27 of its 73 checks target behaviour that was deliberately changed later (numbered
  CGRR-### rough shelves, reworded batch errors, Grinding split from Intake). The same
  flows are covered by `tools/test-data/test-start-grinding-db-contract.mjs`,
  `tools/test-post-workflow-db-integrity.mjs` and the PowerShell full-workflow suite.
- `Dana-Apps-Native-Remote-Deploy.cmd`: V70.0.2R9-D3 remote deploy (embedded base64 Node payload,
  hard-wired to one laptop path and to `/tmp/dana-apps.v0.1` on the host). Replaced in 70.1.0 by
  `Deploy-GearApps.cmd` / `tools/deploy/deploy-remote.mjs`, which keeps the same safety rules and
  moves the release to `~/dana-apps` (carrying the host `.env` over automatically).
