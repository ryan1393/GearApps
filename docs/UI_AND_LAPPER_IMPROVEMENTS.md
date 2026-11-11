# UI and Lapper improvements

The four web clients use the same Dana font token, including login and native form controls. Admin navigation is grouped by People, Product, Equipment, Inventory, and System. All Lapper setup pages are available in shared Admin; legacy Lapper URLs redirect to the appropriate tab. Back/forward navigation updates the selected tab.

Shared tables wrap long content and turn into labelled records below 900px. Sorting and filtering remain available above the records. This includes shipment and tray-availability tables. Status colors explicitly distinguish active, inactive, neutral, and informational states. Shared tokens remain in Dana UI; component layouts consume those variables.

Lapper's dashboard shows production cycles, reporting machines and missing serials over the last 24 hours, along with the last recorded cycle. These counts use production history only. Lapping Summaries offers the latest 200 cycles for a selected machine/gearset, with a serial filter and cycle selection. Selecting a cycle loads only its values. The additional configured-values section displays every recorded macro, including newly added definitions that do not appear in the legacy fixed layout.

Admin > Cycle Test Lab validates a serial number, machine, gearset and the current active macro definitions. It saves both passing and failing simulations, including a snapshot of names, types and supplied values, in `lapper.cycle_tests`. The lab does not command a machine or insert production cycles or macro logs. Admin authentication is enforced by the API. History shows the latest 100 simulations. The additive startup migration creates the table on both existing and fresh installations.

Admin > Server Settings now filters by category and by pending/unsaved changes. The environment template distinguishes the persistent Docker volume and points collector setup to Admin. Database/signing secrets remain locked to server configuration. Macro definitions and existing machine/scanner/server configuration are editable through Admin; this does not introduce arbitrary executable business rules or new configurable FANUC PLC addresses.

The Grinding Station keeps the scan box and current action prominent. Scrap defaults to zero; manual shelf selection and pass history are collapsed. History loading does not block starting the selected tray or incorrectly release an in-flight action. Each physical grinder is an Admin machine of type Grinder. Scan or select it once; the workstation remembers the selection. New start/completion requests require its ID. Completed passes retain the grinder ID and machine-number snapshot alongside blade counts and operator. A tray started on one grinder cannot be completed against another; active passes prevent changing or disabling that machine. The station offers per-tray and latest-100 per-grinder history. Historical passes without a recorded grinder are labelled explicitly. Additive columns preserve existing data. Deploy the API and web clients together: new grinding requests require `grinding_machine_id`. Configure the actual grinders in Admin before operating the station.

The collector token handoff now explicitly applies its documented file permissions before atomic replacement, so restrictive host umasks do not prevent the separate collector container from reading the token. The Lapper development target now depends on the unified API's actual project name.

## Verification

- Full `npm run build`: all current targets passed; the separate fresh-database bootstrap target also passed. Both an existing database upgrade and a newly bootstrapped PostgreSQL database contain the grinder attribution columns.
- Full `npm test`, including deployment tests: passed.
- Python collector: 55 tests passed. The retired Windows/.NET collector was removed in the final branch integration.
- Shared API, manufacturing workflow, grinding, DSF attribution/configuration and frontend unit suites: passed.
- Source contracts: 82/82 passed; workspace version validation and lint passed (existing warnings remain).
- Individual-grinder regression: 29 end-to-end API calls passed, including missing/wrong grinder rejection, active-grinder protection, saved machine identity and per-grinder history through packing, cutter setup and teardown.
- All-machine DSF tests: Department 45 grinders, Department 181 lappers, non-cutting operations and initial source discovery passed using a fake read-only source.
- Integrated Coater RPA: all 11 container-tray/RPA tests passed, including matched-set quantity regressions for 11, 13, 17 and 19. A synthetic saved workbook was prepared and downloaded through both the API and shipment UI with matching inner/outer quantities; SMTP remained disabled. The shared shipment screen passed desktop, tablet and phone checks.
- Real local PostgreSQL/API checks: login, machine/gear/macro setup, cycle ingestion, historical macro values, saved pass/fail simulations, unchanged production totals and non-admin denial.
- Chromium: all four login fonts match app fonts; Admin renders at 1440, 768 and 390 pixels without horizontal page overflow. Cycle simulation and historical selection work through the UI. Lapper dashboard, settings, blade grinding, shipments and inventory also passed responsive checks. Machine DSF Counts passed at all three widths in all four apps; grinder selection survives refresh and its saved pass history renders without overflow.

## Remaining external validation

The final branch integration includes the Windows/.NET collector removal from `892e03b`; the Python/Docker collector is the supported collector. Its Nx commands, release manifest and cloud setup no longer require .NET. The earlier `feat/lapper-app` commits (`366e319`, `228df14`) are retained in merge history. Their standalone API, Docker driver injection and automatic table synchronization were superseded by the shared PostgreSQL API, root production dependencies and explicit fresh-database bootstrap. The current `compose.yml`, database schemas, authentication and four-client deployment are preserved.

Coater RPA restoration from PR #20 is integrated with these changes. It adds workbook preparation/download, saved request history, explicit email delivery and an import tool for the server-held workbook, settings, part mappings and history. The dump and saved addresses remain on the user's server; they are not repository artifacts. See [Coater RPA](manufacturing/COATER_RPA.md) for the import preview/apply workflow. Live import against that dump and SMTP delivery are not part of this cloud validation.

DSF unit tests cover count/attribution/configuration logic. Live plant DSF connectivity, CNC controllers, scanners and printers were not tested: the cloud environment has no plant connection or credentials. DSF counts now include every public machine, including grinders, cutter builders and lappers. Each app has Machine DSF Counts, with inline counts in Admin, the grinder station, cutter build selection, Lapper live cards and summaries. Admin mappings support all numeric source departments and approved operations; the source list can load before the first mapping is made. Cutter inventory crediting remains limited to production cutters in departments 132/152. Unconfigured, inactive and stale sources are labelled and never presented as zero. The separate legacy loose-blade ledger is not required for individual grinder pass tracking.

## Cloud development

Reusable installation and startup instructions are saved in the environment draft. The isolated database, generated local credentials and helpers under `/workspace/gear-cloud` are snapshot state. Review and save the environment settings, then publish to make that prepared environment available to future tasks. Publication and fresh-task restoration have not been tested here.

## Full configurability follow-up

The recommended shared configuration engine is described in [Configuration across all four apps](CONFIGURABILITY_ROADMAP.md). Machine profiles, custom scan/measurement steps, calculated macros, configurable quality intervals and draft/test/publish/rollback are planned work, not implemented features of this change.
