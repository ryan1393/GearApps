# Gear Apps Testing

## One-command master test

From the Gear Apps project root, run:

```powershell
npm run test:gear-apps
```

Normal test mode is fully automatic. Do not type a cutter serial, machine, part number, tray, container, summary, pull reason, or test password. The harness creates or reuses dedicated `E2E-*` test fixtures and selects the required reference data itself.

The automatic test account and E2E fixtures are development/test data only. The workflow test does not The automated workflow uses a dedicated E2E Green Shed machine and does not use production machines.

## What the master test covers

The master test validates the build, fresh-import contracts, legacy migration rules, API route manifest/runtime behavior, read-only API smoke checks, cutter-body MF-to-Dana behavior, shelf conventions, automatic test-fixture provisioning, and the Blade Tracking â†’ Cutter Builder â†’ Green Shed workflow.

The Green Shed setup tests include four compatibility rules:

| Cutter build | Part number | Machine | Expected result |
| --- | --- | --- | --- |
| PINION | PINION | PINION CUTTING | allowed |
| RING | RING | GEAR CUTTING | allowed |
| PINION | RING | PINION CUTTING | rejected |
| RING | PINION | GEAR CUTTING | rejected |
| PINION | PINION | GEAR CUTTING | rejected |
| RING | RING | PINION CUTTING | rejected |

A part number must match both the cutter build Summary and Part Type. A PINION cutter build therefore cannot use a RING part number, and a RING cutter build cannot use a PINION part number.

Machine compatibility is also enforced by manufacturing department: PINION cutter builds run only on `PINION CUTTING` machines; RING cutter builds run only on `GEAR CUTTING` machines. This validation is server-side, so it cannot be bypassed by the UI.

## Safe first run

1. Open PowerShell in the extracted Gear Apps project root.
2. Run `commands\SETUP-GEAR-APPS.cmd` after a fresh extract or dependency/environment change.
3. Run `commands\START-GEAR-APPS.cmd` and wait for the API and three applications to start.
4. Run `npm run test:gear-apps` in another PowerShell terminal.
5. Read the final test table. Every required row should show `PASS`. If a row fails, use the first failure as the starting point.

## Diagnostic modes

The normal `npm run test:gear-apps` path is zero-input and executes the complete E2E workflow using dedicated test records. `-PreflightOnly` performs a deliberate non-mutating workflow preflight. `-NoAutoTestData` is for developer diagnostics with explicitly supplied fixture values and is not the normal test procedure.

## Part and machine terminology

- `PINION` part type comes from the legacy pinion master data.
- `RING` part type comes from the legacy gear master data.
- `PINION CUTTING` is the machine department for PINION work.
- `GEAR CUTTING` is the machine department for RING work.
- Cutter Builder is the application name; Cuttergrind / `CUTTERGRIND` remains the physical department used for Cuttergrind shelf/location rules.

## Blade status casing

Tray-stage codes use uppercase reference values such as `WAITING_FOR_GRINDING`. Blade records use the lowercase `BladeStatus` enum value `waiting_for_grinding`. The automatic fixture generator and regression tests enforce that distinction so the full E2E test cannot seed an invalid blade status.

## PostgreSQL pessimistic-lock relation rule

Transactional service code must not combine a TypeORM `relations` join with a pessimistic `findOne` lock in the same query. PostgreSQL can reject the resulting `FOR UPDATE` when TypeORM uses an outer join for a nullable relation. Gear Apps now locks the base row first, then loads the required relations in a second query inside the same transaction.

`npm run test:db-lock-queries` scans the affected server services and fails if this unsafe pattern is reintroduced.

## Foreign-key and loaded-relation synchronization

When a TypeORM entity was loaded with a relation object and the workflow changes the relation's foreign-key column, Gear Apps updates both the foreign-key field and the loaded relation object before saving. This prevents an old loaded relation (for example `WAITING_FOR_GRINDING`) from overwriting the newly assigned foreign key (for example the `GRINDING` stage) during persistence.

`npm run test:fk-relation-sync` guards the stage/status transitions used by Blade Tracking, Coater, Green Shed, and Cutter Builder.

## Error-message policy

Every intentionally raised Nest HTTP exception must include an explicit human-readable message. The server logging interceptor records the correlation ID, HTTP method/path, status, message, and unexpected error stack. Database failures additionally log PostgreSQL/driver detail and the failed SQL query.

The full E2E workflow test prints the API response body for failed requests, including 4xx business-rule failures and 5xx server/database failures. `npm run test:error-messages` fails if a built-in HTTP exception is introduced without a message or if the diagnostic paths are removed.

## Cutter Builder create-build request contract

The Cutter Builder build API accepts `cutter_body_identifier`, which may be the Dana serial after etching or the manufacturer/MF serial before etching. The E2E workflow and frontend must send that exact request field. `npm run test:cutter-builder-request` fails if the workflow regresses to the obsolete `cutter_body_serial_number` request field.

### Cutter Builder build-detail response

`POST /cutter-builder/builds` returns a build card with flat `status_code`. `GET /cutter-builder/builds/:buildNumber` returns the persisted build with its related `status` object, so the workflow validates `status.code`.

## Authenticated backend mutation suite

The master command `npm run test:gear-apps` now runs a dedicated authenticated backend mutation suite before the full manufacturing workflow. It is zero-input in normal mode and creates/reuses only `E2E-*` test data.

The suite exercises backend create/update/delete or intentional-rejection behavior for blades, trays, blade-tray assignments, blade batches, locations, location-tray assignments, containers, protected container-tray routes, part summaries, cutter blade requirements, parts, roll masters, and admin user mutations. Cutter-body MF â†’ Dana mutations remain covered by the dedicated cutter-body transition test, while grinding, coating, Cutter Builder, Green Shed setup/quality/pulls, and teardown remain covered by the full E2E workflow.

Negative-path coverage includes unauthenticated 401, non-admin 403, invalid UUID, missing-record 404, duplicate-value 409, invalid workflow mutation 422, transaction rollback verification, and a concurrent duplicate-create test. Every rejected request must return a useful error message.

`npm run test:backend-mutation-coverage` accounts for every mutating API route by assigning it to the authenticated CRUD suite, cutter-body transition suite, full manufacturing workflow, or public authentication group. This prevents new write routes from being silently left untested.

## Post-workflow database integrity/reconciliation

After a successful full automatic E2E manufacturing workflow, the master test runs a read-only reconciliation pass scoped to dedicated `E2E-*` records. It checks blade/tray counts and compatibility, mutually exclusive tray placement, machine/build active-run uniqueness, completed-build cleanup, and open-build uniqueness for cutter bodies.

