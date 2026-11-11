# Configuration across all four apps

Status: recommended scope, not implemented by this PR. Existing machine, Lapper macro, scanner, DSF mapping and server settings remain editable in Admin. A shared engine for custom workflow steps, calculated variables and business rules still needs implementation.

## Recommended controls

| Control | Admin behavior | Acceptance example |
|---|---|---|
| Machine profiles | Set shared app defaults and overrides for individual machines; show which values are inherited. | Two grinders can use different inspection limits without separate code changes. |
| Scan steps and required fields | Add and order scans, measurements, checkboxes and notes; configure labels, allowed values and when a field is required. | Require an inspection measurement only for the applicable grinder or part. |
| Variables, macros and rules | Define typed variables and calculated values; configure warning and blocking conditions with clear operator messages. | Calculate scrap percentage from the actual pass quantity and compare it with a configured limit. |
| Quality intervals | Configure Greenshed's currently fixed 25-piece check interval by machine, using the same value in the API, dashboard and workstation. | A machine configured for a 50-piece interval shows the same next-check count on every screen. |
| Test, publish and rollback | Edit drafts; test with a serial number; retain clearly marked simulation history; publish a version and restore earlier versions. | A failed draft test cannot alter production history or change a running station's configuration. |

## First complete workflow

1. Configure an individual grinder and inherit the Blade Tracking defaults.
2. Override its scrap-percentage warning limit and optionally require an inspection measurement.
3. Scan the tray and record the pass against the selected grinder.
4. Calculate the scrap percentage from server-verified blade quantities; show a warning or block according to the configured rule.
5. Retain the inputs, calculated values, applicable configuration version, machine, operator and result in history.
6. Repeat the same scenario in test mode and retain a clearly marked test record without recording a production pass.

Keep the normal workstation focused on scanning. Additional fields appear only when the applicable configuration requires them.

## Implementation requirements

- Use one configuration model and evaluator for Blade Tracking, Cutter Builder, Greenshed and Lapper; document supported workflow actions and available input variables.
- Validate variable types, formulas, references and rule dependencies before publication. Define missing-value, rounding and error behavior explicitly.
- Evaluate business rules on the server as well as providing operator feedback in the client. Configuration must preserve authentication, inventory transactions, quantity accounting and machine-attribution guarantees.
- Keep existing collector API paths compatible. Changes affecting collector input must be tested against the Python/Docker collector before publication.
- Retain immutable published versions and record the version used by each operation. Reject conflicting edits and make inherited versus overridden values visible.
- Test individual-machine overrides, conditional fields, warning/blocking behavior, stale edits, rollback and production/test isolation.

## Existing work in this PR

See [UI and Lapper improvements](UI_AND_LAPPER_IMPROVEMENTS.md) for implemented changes and verification. The current Cycle Test Lab validates configured Lapper macros and persists simulations; it is not yet the shared workflow-rule test engine described above. DSF supports all machine types and individual grinder history is implemented, but live plant connectivity still needs validation. The Coater RPA workbook workflow and import tool from PR #20 are integrated; the actual dump, workbook settings and saved recipients remain on the server.
