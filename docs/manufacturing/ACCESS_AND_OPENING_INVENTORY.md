# Roles, badge login and opening inventory

Admin > Roles & Badges creates named roles and assigns individual API actions grouped by
screen/resource. Names such as Operator, Team Leader, Gear Quality, Cutter Grind,
Management and TV are ordinary configurable role names. Select the read actions needed
by each screen as well as its permitted changes. No permissions are granted by a name.

Custom roles **restrict** the existing non-admin account and department permissions.
They do not turn a user into an administrator or bypass department checks. Existing
accounts retain their permissions until assigned a custom role. An empty or disabled
role denies protected application actions; authentication remains available. Removing
the assignment restores the account's existing department access. Role saves and
assignment changes revoke affected sessions. Current permissions are checked on every
API request. Administrator-only actions remain reserved to administrator accounts.

The catalog uses stable controller resource and handler names. If an action is renamed
in a future release, review affected role grants. Missing grants fail closed.

Badge login is an alternative to email/password, as requested for the shop-floor
deployment. A keyboard reader sends a printable ASCII card UID (1–128 characters), then
Enter. Focus the badge input before scanning. UIDs are case-insensitive; prefixes,
suffixes and separators are significant. No global keyboard capture is installed.
Admin > Roles & Badges assigns, replaces or revokes a badge. One active badge per account
and one account per active UID are enforced by database indexes. Replacement and
revocation invalidate sessions. Unknown, revoked and inactive badge accounts receive
explicit errors. Badge login has a bounded per-process, per-source failed-attempt limit
of ten per minute; a successful login clears that source's failures. Multi-instance
installations should also enforce rate limits at their shared ingress.

UID hashes, role changes, assignments and revocations are persisted separately from
production inventory. Raw UIDs never appear in API responses or access audit records.
Badge-reader keyboard simulation has been tested; physical reader hardware and its
configuration still require a deployment check. Badge-only login assumes the deployment
accepts possession of the card UID as its login credential.

## Initial inventory

Admin > Launch Setup > Import opening inventory extends the existing opening-inventory
workflow. Download its CSV template, replace the example values, upload or paste, and
choose Preview and validate. The six-column header is:

```csv
tray,summary,part_type,stage,shelf,service_cycle
T0001,1010 rev A,RING,READY_FOR_COATING,CGRR-A1A,0
```

Use the exact Summary label displayed by Launch Setup, including its revision when
present. Use 1–100 rows, no quoted fields, and no commas in values. Supported stages are
READY_FOR_COATING (ground) and READY_FOR_CUTTER (coated). Service cycle is 0–99. Quantities
come from the existing enabled Summary/part-type blade requirement. Empty trays and
valid shelves must already exist; missing, in-use and duplicate trays are rejected.

Preview writes nothing. Review its quantities and shelf/stage choices, then record the
trays. Every commit rechecks the tray under its existing transaction lock. Each tray
saves independently: a failure leaves successful rows committed and shows an individual
result. Re-preview corrected failed rows before retrying; previously saved trays are
rejected. Existing journal/history and Cancel Last remain in use; no synthetic grinding
or coater events are inserted.

Admin > Locations > Mass edit location descriptions supports selection, inline
validation, save/cancel and individual results. It uses the existing administrator-only
PATCH endpoint and its audit fields. It changes descriptions only.

## Database and validation

Startup adds the idempotent `GEAR_ACCESS_SCHEMA` under the existing startup transaction
and schema lock, with `DATABASE_SYNCHRONIZE=false`. It adds `meshforge_roles`,
`meshforge_user_roles`, `meshforge_badges` and `meshforge_access_audit`; no existing user
role values, inventory or production history are rewritten. The operational-data
cleanup tool preserves these tables. Back up the database before deploying any upgrade.

Run the repository's unit tests, source contracts, lint and builds from the root.
For the additional live API/Chromium checks, use an explicitly disposable test database,
start the API and all four clients on 3333 and 4200–4203, and run:

```sh
MESHFORGE_ALLOW_TEST_ACCOUNTS=YES npx nx run manufacturing-tools:test-access-workflows
```

The test requires a database name containing `test` or `cloud_dev`, a seeded
`admin@example.com` account whose password is supplied in `SEED_ADMIN_PASSWORD`, and
Chromium at `/usr/bin/chromium` (or `CHROMIUM_PATH`). It creates isolated test accounts,
roles, locations and trays. Accounts are deactivated and badges revoked afterward;
opening-inventory records and audit history are retained for inspection. Partial-save
browser checks simulate one concurrent HTTP failure while other rows use the live API.

The shared theme selector remembers Light, Dark or System per browser origin. Different
application ports have separate browser storage. Demand planning, cutter requests and
reference-photo matching are deferred at the user's request.
