# Dana Apps V70.0.4 — Shared dashboard visual QA

Required starting state: the user's confirmed V70.0.3R1 source and @dana/ui 0.2.0.

## Visual changes

The Gear migration stylesheet receives one screen-only block. Dashboard content
uses the available width after the sidebar instead of a 1580px centered ceiling.
App names may wrap at spaces rather than being ellipsized. The white topbar gets
readable input, placeholder, account, search-button, menu and sign-out colors.
Dashboard table body text is 14px normally and 15px at 1500px+, with 12/13px
headers and secondary text. Related dashboard headings and KPI values scale
within the same shared adapter. Existing KPI grid arrangements are retained.

## Boundaries

No Angular template, handler, route, API, authorization, database schema, healthcheck,
Dockerfile, Compose configuration, dependency, package-lock or PowerShell source
is modified. Truck Log and the standalone Dana UI repository are not changed.
The same @dana/ui package remains the visual foundation; this is a Gear adapter
correction, not a replacement theme. Existing login and print layout rules are
preserved. No test records, counts or identifiers are removed or relabeled.

## Validation and rollback

The CMD syntax-checks the exact new Node sources before applying. The new visual
contract is called by the existing external-Dana-UI contract, already wired into
`npm run test:gear-apps`; the PowerShell test runner is not rewritten. Existing
assertions are kept byte-for-byte with an append-only test hook. If the existing
test-preservation manifest tracks that external contract, only its deliberate
hash change is recorded. Other entries are retained.

The maintained merge manifest is regenerated and checked before the full Gear
suite. Failure restores all files written by this patch and verifies their hashes.
The full suite may use its normal dedicated test fixtures; the patch itself has
no database reset, migration or Docker deployment command.

## Deployment

Run the CMD on the Windows source workspace. No npm install is required. After
PASS, use the existing D3 native remote deployment helper to deploy the current
workspace. Its older filename is the helper version, not the app source version.
Do not change the independently deployed Truck Log workspace.

## Release evidence boundary

The release report separates local syntax, patch-transaction, and recovered-CSS
browser fixtures from the user's authoritative build/database/runtime suite.
Passing fixture checks is not a claim that the live deployed dashboards have
already been visually verified at every zoom or device size.
