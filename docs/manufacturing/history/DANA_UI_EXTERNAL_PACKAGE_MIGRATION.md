# Dana Apps — External Dana UI Adoption V70.0.2R2

Truck Log is the visual source of truth for `@dana/ui`.

R2 deliberately preserves every existing Gear HTML template and every existing
`tools/test-*.mjs` contract byte-for-byte. The Truck Log-derived visual language
is applied through the external package plus a final CSS bridge that targets the
existing Gear selectors.

Each frontend loads:

1. Tailwind entry
2. existing Gear shared stylesheet
3. existing Gear domain/workflow stylesheet
4. `@dana/ui/styles/dana-ui.css`
5. `dana-ui-migration.css`

The patch snapshots all frontend HTML hashes and all existing Gear test-contract
hashes before mutation. It then scans the whole current test surface, batches all
static migration-sensitive contracts so every failure is reported together,
builds all three frontends, and finally runs the unchanged authoritative
`npm run test:gear-apps` when PostgreSQL is reachable.

Truck Log, Dana UI source, Gear APIs, Gear database behavior, routes and business
workflows are not modified.


## R3 test cleanup

The complete migration-sensitive audit identified four remaining failures:

- Gear merge manifest: regenerated after package/lock migration.
- Dana premerge: package devDependencies are sorted before npm writes the lock so the existing strict root dependency check remains stable.
- Dependency trim: historical stale/orphaned test; inventoried but not executed because it is not wired to the authoritative runner or a package script.
- Toast notifications: contract updated to the current Dana-owned toast implementation while preserving the Gear compatibility aliases and all transaction wiring.

The toast compatibility contract is now wired into the authoritative Gear runner.


## R4 final premerge hardening

The remaining migration-sensitive failure was `test-dana-apps-premerge-contract.mjs`.

The contract's dependency checks used raw `JSON.stringify(object)`, so equivalent
dependency maps could fail solely because npm and package.json used a different
property insertion order after adding the local `@dana/ui` dependency.

R4 preserves all other premerge assertions and changes only those two map
comparisons to canonical sorted-key comparisons. It also adds positive checks
for the vendored `@dana/ui 0.2.0` package, frontend stylesheet wiring, and Docker
vendor-copy behavior.


## R5 npm lockfile descriptor hardening

R4 required `packages["vendor/dana-ui/package"].name`, but npm's non-root
package descriptors do not guarantee a `name` field. R5 validates package
identity from the vendored package.json, validates the vendor version in the
lockfile, and validates the node_modules/@dana/ui local-link target instead.


## R6 stable local-package validation

R6 removes npm-version-specific nested lockfile assertions from the premerge
migration hardening. Root package/lock dependency maps are still compared
canonically. The local Dana UI package is validated by vendored package.json,
installed package.json, and the real filesystem target of node_modules/@dana/ui.

The migration batch runner now repeats each failed test's first Error:/[FAIL]
diagnostic in the final bottom summary.


## R7 generated-premerge syntax correction

The repeated premerge failures were traced to the patch generator itself.
The canonical dependency helper was written with literal `\n` characters
inside the generated `.mjs` source instead of real newlines, causing Node to
raise `SyntaxError` before any premerge assertion executed.

R7 writes real newlines, immediately runs `node --check` against the exact
generated premerge contract, and teaches the collected test runner to repeat
`SyntaxError`/`TypeError`/`ReferenceError` diagnostics at the bottom.


## R8 Docker build-context hygiene

R7 reached the real premerge assertions and found the live Dana Apps
`.dockerignore` missing `tools/data-import/work`.

R8 preserves the existing file and appends any missing entries from the current
generated-artifact hygiene set:

- `.angular`
- `_patch_backups`
- `tools/data-import/work`
- `swagger.json`
- `cutter-history-dynamic-migration-report.json`

The external Dana UI contract verifies the same set before builds.


## R9 read-only API smoke correction

R8 reached the final authoritative runtime gate. The only failure was the
container scan smoke probe returning 404.

The API's scan endpoint intentionally resolves enabled records only, while the
inventory collection may contain disabled historical records. The old smoke
test took the first collection serial without checking `enabled`.

R9 selects an enabled collection item before container/location scan probes.
When no enabled source exists, that dynamic scan is explicitly skipped instead
of probing an invalid historical serial. A real scan request that returns 404
still fails; the scan endpoint itself is not marked optional.
