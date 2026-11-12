# Changelog

## Unreleased

- **Setting changes are one line each.** The Lapper Dashboard's Setting changes panel showed every
  changed value of a cycle in its row, so a cycle with a dozen changes filled the screen. Each
  cycle now shows how many values changed (12 changes, every name on hover) with a Show details
  button that opens them underneath, in columns: macro, name, previous → new value and the
  difference. Cycle history has its own column.

- **DSF: Map Unique Matches.** Admin > DSF Mappings has a **Map Unique Matches** button. It lists
  each machine whose DSF source is the only active one in its department with a whiteboard name
  ending in the machine number (`132 PIN CUTTER 549` -> machine 549), and no other machine has that
  number, then maps the ones you confirm through the normal Admin save (same checks, audited).
  Machines already mapped or unmapped in Admin, sources in use and machines with cutter-crediting
  history are left alone, and the preview says why each unmatched machine was skipped. New
  `GET`/`POST /api/v1/greenshed/dsf-counts/admin-mappings/unique-matches` (Admin only).

## 70.7.0 (2026-11-12)

Lappers get their cycle time recorded and shown in Lapping Summaries, a live timer while a cycle
runs, and a Lapper Dashboard panel flagging setting changes (chosen per macro in Admin > Macros).
Cutter-body compatibility is checked the same way everywhere and unetched bodies build again; each
Summary has RING and PINION HOS, Inner and Outer blade, saved with one Save Part Summary; gearset
master fields are shown and a manual base-data import keeps administrator changes; model numbers can
be text, and DSF says why counts are not coming in. **Back up the database before deploying**: model
numbers change from integer to text on startup.

- **Setting changes on the Lapper Dashboard.** A new panel lists the cycles of the last 8 hours, on
  every machine, where a controller value changed since the previous cycle of the same machine and
  gearset: time, machine, gearset, serial, cycle number and each changed value with its previous
  and new value (#10035 Backlash axial 0.12 → 0.15), with a link to that cycle history. Every
  macro is flagged except the consec counter (#10032), which is never flagged. **Admin > Macros**
  has a new **Flag changes** tick (and column) to leave out a value that changes every cycle by
  design, such as a controller cycle time. A value's first reading on a machine and gearset is not
  a change, and machines are never compared with each other. New column
  `lapper.macros.flag_changes` (boolean, default true, migration `20261112-lapper-macro-flag-changes-v1`)
  and read-only endpoint `GET /api/v1/machine-cycle/setting-changes?hours=8` (1 to 168 hours,
  newest 100 cycles; `total` counts all of them).
- **Live cycle timer.** While a lapper is in cycle, Lapper Dashboard's machine cards (Machine I/O >
  Cycle time) and Lapping Summaries (Machine now) count up how long the cycle has been running,
  every second. Between cycles they show Not in cycle; when the collector started mid-cycle, In
  cycle · time unknown. When Lapper Read has not reported a machine for 90 seconds they show
  No update for … instead, so a stopped collector never leaves a timer running. Lapper Read now
  sends each machine's I/O at least every 30 seconds, with how long the current cycle has run
  (`cycle_elapsed_s`, measured on its own clock); the API turns it into a start time on the
  database clock, and reads return `cycle_elapsed_s` and `reported_age_s` as of the read, so the
  browser's, collector's and database's clocks never have to agree. New nullable columns
  `lapper.machine_fanuc_variables.in_cycle_since` and `reported_at` (migration
  `20261111-lapper-live-cycle-v1`); `cycle_elapsed_s` is optional on the machine I/O update, so
  older collectors keep working (they get no timer). An upgraded collector talking to an API that
  is not upgraded stops sending the field. Also fixes the Lapping Summaries Cycle time header,
  which broke into single letters when a machine and gearset had no cycles.

- **RING / PINION HOS, Inner blade and Outer blade per Summary.** Each Summary now has separate
  RING and PINION HOS, Inner blade and Outer blade (table `part_summary_part_type_blades`,
  migration `20261112-summary-part-type-blades-v1`, additive). Parts show the Inner and Outer
  blade of their own Summary + Part Type (view `part_blade_settings`, no copies on parts). A label
  is kept in the field it was assigned to: PINION 30538 keeps Outer blade `RH IB`.
  See `docs/manufacturing/SUMMARY_PART_TYPE_BLADES.md`.
  - **One Save Part Summary.** Admin > Part Summaries > Edit has one form and one button for the
    Summary fields, both Part Type groups and the Body Size rule (Required Blades preview), saved
    in one request and one transaction (`PUT /api/v1/cutter-config/summary-settings/:summaryId`).
    Omitting the Body Size keeps it; any failure saves nothing and keeps the draft. The per-card
    Save Rule button is removed.
  - **Opt-in source import** of the 216 Blade sheet cope.xlsx Sheet2 rows:
    `npm run report:summary-part-type-blades` (dry run), then `npm run apply:summary-part-type-blades`.
    Fills blank fields only, skips 30588/32414 and zero rows, creates no Summary.
  - **Fix:** a partial `PATCH /api/v1/part-summaries/:id` that left out `revision` blanked the
    Summary's revision (the update DTO inherited the create default). Revision now changes only
    when sent.

- **Gearsets: master fields visible, relationships and administrator states kept on import.**
  See `docs/manufacturing/GEARSETS.md`.
  - **A manual `npm run import:base-data` no longer undoes administrator changes.** It used to
    re-enable and reactivate every Summary, ring/pinion part, roll master and blade requirement in
    its files, including ones an administrator had disabled, and could rewrite the Summary or
    teeth of a ring or pinion already used by a gearset. Existing rows now keep their
    active/enabled state, parts used by a gearset keep their Summary, type and teeth, and the
    import lists what it kept (`[KEEP]`). A missing Summary that exists only as a disabled row is
    no longer recreated or re-enabled. Automatic deploys were never affected (they import only
    into an empty database).
  - **Gearset master fields.** The gearset API and Admin > Gearsets now show the stored model,
    customer, application, business status (Production, Service, …), cut and archived flag,
    read-only. Business status is shown apart from Status and never makes a gearset inactive.
  - **`npm run audit:gearsets`** (read-only): actual `public.gearsets` columns and constraints,
    counts by part type, shared rings/pinions/Summaries, status and archive state with linked
    parts, integrity findings, and each gearset's Summary blade rule. `--seed <file>` compares a
    historical seed and lists its import rules without applying them.
- **DSF: say why counts are not coming in.** When `DSF_COUNT_ENABLED=true` but a setting is wrong,
  the API start-up log and Admin > DSF Mappings now name the setting (for example "DSF_DB_HOST is
  empty" or "DSF_DB_SSL_MODE must be verify-full or disable"), never its value; before, both only
  said the settings were "incomplete or invalid". A failed DSF read now also explains its code in
  plain words (ECONNREFUSED: check host and port; 28P01: wrong password; SSL_NOT_SUPPORTED: set
  `DSF_DB_SSL_MODE=disable`, ...), and pg failures that carry no code (no SSL on the server,
  connection timeout) get one. If the DSF source list cannot be read or is empty, the mapping editor
  says so instead of waiting for it forever. `GET /api/v1/greenshed/dsf-counts/admin-mappings` adds
  `config_problem` and `source_options_problem`.
- **Cycle time in Lapping Summaries.** Lapper Read now also records each cycle's time (seconds in
  cycle, Y3.2) in MeshForge, not only in Argonaut. Lapping Summaries shows it in a Cycle time
  column (minutes:seconds, such as 2:04.3; exact seconds on hover) and at the top: the latest
  cycle's time, or the selected cycle's, with the average of the last 20 timed cycles of that
  machine and gearset. Cycles recorded before this, and cycles whose start or end the collector
  missed, show a dash. New nullable column `lapper.machine_cycles.cycle_time_s` (migration
  `20261111-lapper-cycle-time-v1`); `POST /api/v1/machine-cycle` accepts an optional
  `cycle_time_s` (0 to 86400, up to 3 decimals), so collectors that do not send it are unaffected;
  `history-page` returns each cycle's time and `cycle_time.average_s`. An upgraded collector
  talking to an API that is not upgraded yet sends the cycle again without the time.
- **Cutter-body compatibility: which body types a Summary + Part Type may use.** One shared check
  now answers "which cutter-body definitions can these blades be loaded into?" and the API enforces it
  everywhere. See `docs/manufacturing/CUTTER_BODY_BLADE_RULES.md`.
  - **Unetched bodies work again.** 70.6.0 made every body without a Dana S/N unbuildable. An MF-only
    body now takes its 064/076/088 rule from its explicitly linked body definition; an unetched 105
    stays unresolved because only the 8th Dana S/N character tells 105 Standard from 105 Special.
    Assigning the Dana S/N later keeps the same body row and history.
  - **One answer on screen and on the server.** The Cutter Builder body pick list did not load each
    body's definition, so it could show a body as usable that the build then refused (the scan and
    the build check did load it). It now does, and tray validation accepts the body
    (`cutter_body_identifier`) and returns the API's type compatibility (`body_compatible`) and
    availability (`body_available`) separately; the screen follows that answer. Unresolved bodies are
    shown but cannot be picked.
  - **Disabled body definitions** are no longer accepted as a permitted type (build, tray validation,
    availability).
  - **Bad Dana S/Ns are refused when entered** (create, edit, Dana assignment) instead of being saved
    and silently making the body unbuildable; a Dana S/N must also agree with the linked definition.
    Unchanged legacy values are left alone.
  - **Admin.** Cutter Bodies has a Body Definition picker and shows the definition and where the rule
    came from; Part Summaries lists each Summary's permitted cutter-body types.
  - **Matrix.** New `GET /api/v1/cutter-config/body-compatibility` and
    `GET /api/v1/cutter-builder/cutter-body-definitions` (119 routes); `npm run audit:cutter-blade-rules --
    --matrix` prints it from the live database (read-only) and `npm run report:cutter-body-matrix` from
    the packaged base data (`docs/manufacturing/CUTTER_BODY_COMPATIBILITY_MATRIX.md`).
  - Hand, supplier and Tri-ac/Pent-ac family are still not restrictions (no approved rule ties them to
    a Summary, Part Type or HOS). No schema change, no data migration, no quantity changes.
- **Model numbers can be text.** A model can now be numbered `S-110` or `9¼` as well as `174`.
  `models.model_number` changes from an integer to text on startup (migration
  `20261111-shared-model-number-text-v1`); existing numbers keep their digits. Numbers that
  differ only in case or spacing are the same model. Admin > Models takes any text, shows a
  model with no number by its type, and lists numbers in natural order (9, 110, 1000, S-110).
  The models API still accepts a numeric `model_number` from older clients and returns it as
  text. **Back up the database before deploying.**

## 70.6.0 (2026-11-11)

MeshForge branding and Server Settings in Admin, Launch Setup and Coater RPA for going live,
Lapper Read sending each cycle (with its cycle time) to Argonaut, shelves that set their part type
from the barcode and are picked for the tray automatically, cutter-body blade rules read from the
Dana S/N with a per-Summary Body Size Rule, and one copy of machine data. **Back up the database
before deploying**: this release drops three unused tables (see below).

- **Database: one copy of machine data, three unused tables removed.** `lapper.machines` no
  longer keeps its own copy of a machine's number, department, cell and description; Lapper reads
  them from `public.machines`, so a change in Admin shows everywhere (the Lapper production
  dashboard showed the stale cell before). A description only Lapper had is moved to the machine
  first. Lapper also stops copying a gearset's ratio into `lapper.gearsets` when it links one, and
  the dashboard's last-gearset name follows the MeshForge part number. Dropped:
  `lapper.type_of_checks` and `lapper.gearset_marriages` with their `/api/v1/toc` and
  `/api/v1/gearset-marriage` endpoints (no screen or collector used them), and
  `public.cutter_legacy_orphan_records`; the cutter-history importer now writes those unmapped
  legacy rows to `cutter-history-legacy-orphans.json` beside its report. Migrations
  `20261111-lapper-master-data-dedup-v1` and `20261111-drop-cutter-legacy-orphan-records-v1` run
  once at API start. **Back up the database before deploying**: the dropped data is gone after.

- **Lapper Read: cycle time to Argonaut.** Each finished lapping cycle is timed from going into
  cycle to coming out of it (Y3.2), and the seconds are sent to Argonaut as `floatData[0]`, which
  was always 0. A cycle whose start or end was missed (collector down or restarting, controller
  not answering) sends 0 rather than a wrong time. The Cycle Test Lab's
  Send to Argonaut has a matching optional Cycle time field (`cycle_time_s`).
- **Location part type comes from the barcode.** A shelf barcode's R or P now sets its part type:
  GSR/GSP, CGRR/CGRP, CGDR/CGDP and CGFR/CGFP are RING or PINION whatever is chosen, on create,
  edit and bulk shelf creation, so summary tags print the right part type. Admin shows the part
  type read-only for these barcodes. On startup, existing locations whose part type disagrees with
  their barcode are corrected once (logged); other locations keep the part type chosen for them.
- **Trays go to their shelf automatically.** When exactly one shelf the tray may go to holds its
  Summary and part type, it is selected for the operator: the destination in Move Tray, the bin
  when Grinding uses a rough shelf, and an empty finished shelf in Receive Container (one tap,
  Receive onto …). With two or more such shelves nothing is selected and the operator scans or
  chooses one, as before. Nothing is moved until the operator confirms.
- **Cutter-body blade rules corrected.** Cutter body capacity now comes only from the Dana S/N by
  position (characters 5–7 body size, 8th character `8` on a 105 = 105 Special). Previously the
  check searched the whole serial for `064/076/088/105`, removed punctuation (shifting positions)
  and fell back to the MF serial, so an MF-only body or a malformed serial could be given a
  capacity and a real 105 could be misread. Approved rules are stated in total blades
  (22/26/34/38, 105 Special 26); stored requirement and tray quantities stay in matched inner/outer
  sets (11/13/17/19) and are never doubled. Screens show both units.
  - New **Summary Body Size Rule** (Admin > Part Summaries, table `cutter_summary_body_rules`,
    migration `20261111-cutter-summary-body-rules-v1`, nothing backfilled). It controls the
    Summary-based Required Blades for RING and PINION and keeps 076 Standard and 105 Special
    apart although both are 26 blades. 26-blade Summaries without a rule are left unresolved and
    Cutter Builder refuses to build them until the rule is set.
  - Requirement API accepts only approved set counts and keeps RING/PINION of a Summary equal.
    New endpoints `GET /api/v1/cutter-config/summary-body-rules`,
    `PUT|DELETE /api/v1/cutter-config/summary-body-rules/:summaryId`.
  - Admin > Cutter Bodies cards show the decoded Dana S/N fields and Required Blades read-only.
  - Base-data rows declare `Blade_Quantity_Unit`; blank/zero rows are skipped without overwriting,
    requirement rows no longer create Summaries, and a configured rule is never overwritten.
  - `npm run audit:cutter-blade-rules` (read-only) and the opt-in
    `npm run apply:proposed-special-105`. See `docs/manufacturing/CUTTER_BODY_BLADE_RULES.md`.
- **Lapper Read: paste the Argonaut API per machine.** Admin > Lapping machines now has one
  **Argonaut API** field: paste the full address including `?locationId=…` and that machine's
  cycles are sent there as pasted. The separate location ID field is gone, and a `locationId` in
  the pasted address is never replaced by the collector's default.
- **Lapper Read: optional Argonaut post.** The collector can again send each finished lapping
  cycle to Argonaut (Track and Trace), as the original C# Lapper Read did: the same macros, serial,
  gearset and consec, posted when the cycle ends. Off by default; turn it on with
  `LAPPER_READ_ARGONAUT_ENABLED=true` in `.env` (URL, location, sign-in and certificate settings
  beside it). Argonaut has its own retry queue, so an outage never delays recording cycles in
  MeshForge. Each machine can have its own Argonaut URL and location ID in Admin > Lapping
  machines (new nullable columns `lapper.machines.argonaut_url` and `argonaut_location_id`,
  migration `20261111-lapper-machine-argonaut-v1`); a machine with a URL sends to it, and an empty
  URL uses the collector default.
- **Launch Setup.** A new Admin tab for going live: a checklist of what still has to be set up,
  barcode tags in bulk for trays, containers and numbered shelves, and recording trays that are
  already ground or already coated on the shelf where they sit (see
  `docs/manufacturing/LAUNCH_SETUP.md`). An opening-inventory tray is left in the same state the
  normal workflow produces and can be undone with Cancel Last. New admin-only endpoints
  `POST /api/v1/bladeTrays/opening-inventory` and `GET /api/v1/admin/master-data/launch-status`.
- **Lapping Summaries fits the screen.** Cycles are on the left in a paged table with a serial
  search across the whole history; the right side has tabs for Changes, Summary, Lapping paths and
  All values. Changes shows what each cycle changed (old value, new value, difference), newest
  first, or only the selected cycle's changes. Selecting a cycle shows the values as they stood
  when it finished. New endpoints `GET machine-cycle/history-page/:machine/:gearset` and
  `GET macro-log/changes/:machine/:gearset`; `macro-log/summary` accepts `upTo=<cycle id>`.
- **Lapper Read: workers no longer stay "Restarting".** After the collector restarted, a machine
  with a pending cycle that had no serial (no scanner) was rejected by its own saved cycle file
  and restarted forever. Such a cycle is valid and is now sent. A machine with no gearset loaded
  shows **Collecting** (with "No gearset loaded" beside it), and a restarting worker shows why.
- **Duplicate models.** Models that differ only in the case or spacing of the type, or that both
  have no type, are merged on startup (migration `20261111-shared-model-duplicates-v1`); Part
  Summaries that pointed at a duplicate follow the kept model. Admin refuses a new duplicate and
  flags models that share a number. `npm run db:audit` also reports duplicate tray, container and
  location barcodes, Lapper gearset numbers and scanner addresses.
- **Admin > Coater RPA.** A new Admin tab sets up RPA requests without a database dump: upload the
  Excel request form (checked before it is saved), edit the coater name, next number, prices,
  recipients and default PO, and map each Summary to the form's part numbers. The first time, the
  settings and mappings are suggested from the uploaded form. New admin-only endpoints under
  `/api/v1/admin/coater-rpa`; new table `dana_rpa_template_v1` (created on API start). An
  uploaded form is used in place of the one from an imported request.
- **Faster Docker builds.** Every image now starts with the same lines, so Docker installs the
  build dependencies once instead of once per image, and a release that only changes the version
  number no longer reinstalls them. The web images and the API build stage no longer install a
  compiler or run install scripts; only the API's runtime dependencies do. CI cancels a run that
  a newer push to the same pull request has replaced.
- **Coater RPA works with the form as Excel saves it.** Preparing a request failed with "The RPA
  form has no part line" when the saved form came straight from Excel, because Excel stores the
  part numbers as shared text. That is fixed, and coating variants named only by the form's
  totals (for example `1700-5000 Evo`) are accepted.
  - The form's formulas are recalculated when a request is prepared and the results are saved in
    the workbook. Before, the totals, amounts, box count and packing list kept the previous
    request's numbers until someone recalculated the file in Excel.
  - The workbook no longer carries a calculation chain that pointed at cells which are now plain
    values (Excel reported such a file as damaged), and Excel recalculates it on opening.
- **Status pills are coloured the same everywhere.** Active and Enabled are green, Inactive and
  Disabled red, waiting and review states amber, in-process states blue. Before, most Admin record
  cards and the Blade Tracking inventory pills were plain grey. One rule in Dana UI (`danaTone`)
  decides the colour.
- **Lapper macro limits.** Admin > Macros has Minimum value, Maximum value and Unit for each macro
  (migration `20261111-lapper-macro-limits-v1` adds the columns; all optional). Lapping Summaries
  flags recorded values outside their limits. The Cycle Test Lab fails a test value outside them
  and names the limit; its history shows machine and gearset numbers instead of IDs.
- **Lapper dashboard: Production by Machine.** Cycles in the last hour and 24 hours, missing
  serials, last cycle and last gearset for every lapper, with a link to its cycle history.
  `GET /api/v1/machine-cycle/production` returns the new `machines` list; its other fields are
  unchanged.
- **Greenshed check interval is a setting.** `GREENSHED_CHECK_INTERVAL` (default 25, so nothing
  changes until it is edited) in Admin > Server Settings > Greenshed quality checks.
- **`.env.example` is reorganised** into required values, API settings and Docker host settings.
  `DANA_POSTGRES_USERNAME` and `DANA_POSTGRES_PASSWORD` were never read and are removed; no other
  key or default changed.
- **No sideways scroll in Inventory Control Center** at tablet width, and the Grinding Station
  numbers its scan steps 1, 2, 3.
- **UI colours come from the Dana tokens.** Feature styles and the Tailwind colour classes now
  resolve to `--dana-*` tokens instead of fixed colours.
- **Fresh installs.** The base-data import adds the Lapping department (181) when it is missing.
  The Lapper time zone is sent to PostgreSQL under its canonical name, so the default
  `America/Indianapolis` also works where PostgreSQL has no alias zone names installed.
- **The Windows Lapper Read collector is removed.** The .NET service in `apps/lapper-read`, its
  CI workflow and its version checks are gone. The Docker collector (`apps/lapper-read-py`) is
  the only collector; the API it posts to is unchanged.
- **Server settings are in Admin.** The new **Server Settings** tab of the shared Admin screen
  (`/admin?tab=server-settings`) lists every API setting from the server environment file and
  lets an administrator change it without editing `.env`.
  - A saved value is kept in the database (`gear_environment_settings`) and used in place of the
    `.env` / Docker value **the next time the API starts**; the page says when a restart is
    needed and, under Docker, offers **Restart API Now**. **Use Server Value** removes the saved
    value again.
  - Every save is checked with the same rules the API applies at startup, so a saved value cannot
    stop it starting. If saved settings ever become invalid or unreadable, the API starts on the
    environment file alone and says so in its log.
  - Passwords and other secrets are never sent to the browser and are stored encrypted with a key
    derived from `JWT_ACCESS_SECRET`; if that secret is changed they must be entered again.
  - Locked (shown, not editable): the database connection, the JWT signing secrets, the listen
    address and port, the API path, settings that name files on the server, the seed passwords
    and `DSF_PRIVILEGED_READER_ACK`. The Docker host settings (published ports, the PostgreSQL
    container, the Lapper Read collector) are not API settings and stay in `.env`.
- **MeshForge branding.** The suite is now branded MeshForge. The
  sidebar, login and password-recovery screens show the MeshForge mark and name, and browser tabs
  use the MeshForge icon. Logo files (mark, icon, lockup; dark, light and single-colour; SVG and
  PNG) are in `libs/manufacturing/assets/brand` and `branding`.
  - The MeshForge styles are recoloured from Dana blue/navy to charcoal with orange actions. The
    shared Dana core is unchanged; its colours are overridden from the Gear layer
    (`gear-compat-overrides.css`). Every colour keeps its previous contrast against its background. Warning amber moved to a yellower
    gold so it stays distinct from the orange actions.
  - On-screen wording, API messages and the printed cutter card and packing slip say MeshForge
    instead of MeshForge. Scan buttons use the orange action style.
  - **Everything is named MeshForge, including the system's own names.** There is no byline. The
    import prefix is `@meshforge/`, the API project is `meshforge-server`, launchers are
    `START-MESHFORGE.cmd` and so on. On an existing install:
    - `.env`: `GEAR_APPS_...` settings are now `MESHFORGE_...`; the default database name is
      `MeshForge`.
    - Database: renamed automatically on first start. If the API is configured for `MeshForge`,
      that database does not exist and `GearApps` does, the API renames it. The bookkeeping
      schema `gearapps_meta` becomes `meshforge_meta` with its migration history intact, and
      built-in `@gearapps.local` account addresses become `@meshforge.local`. Nothing else in
      the data changes. Close other connections to the database first (pgAdmin, psql), or the
      database itself cannot be renamed.
    - Lapper Read collector: its variables are `MESHFORGE_API_...`.
  - Not recoloured: informational blue, success, danger, the Greenshed running-machines state
    colours, and colours set in TypeScript or with Tailwind utility classes.
- **Lapping master data is in Admin.** The shared Admin screen (every app's `/admin`) now edits
  everything Lapper's own Machines, Parts & Gearsets and Part Summaries pages did, and those
  pages are gone; their old links open the matching Admin tab (`/admin?tab=…`).
  - New **Gearsets** tab: assemble a pinion and ring from one Part Summary, change revision and
    status, delete pending collector gearsets.
  - New **Lapping Machines** tab: the Lapping setup of a shared machine (FANUC IP, type, builder,
    cell, scanner, status). Removing it keeps the shared machine and its history.
  - **Parts** can now be edited (number, Summary, type, teeth). The GEARSET type is no longer
    offered: gearset parts are created with their assembly. The parts API refuses a bare GEARSET
    part, a change to or from that type, and identity changes (number, type, Summary, teeth) on a
    part used by a gearset; its status can still change.
  - As in the other apps, master data is for administrators only: they reach it through Admin
    in the sidebar (Lapper has no separate Master Data group), and the dashboard links to the tabs.
- **Lapper Read records every cycle, scanner or not.** A cycle gets the scanned serial when the
  machine's scanner is online; with no scanner, an offline scanner or nothing scanned it is
  recorded without a serial instead of being dropped. An offline scanner is pinged and its port
  retried every 30 seconds in the background (it no longer stalls machine polling or floods the
  log), and serials resume when it answers. Lapper > FANUC Variables shows each scanner as Online,
  Offline (answers ping or not, last seen) or No scanner.
- **Idle lappers are not errors.** A control that answers but has no program loaded (#10020 or
  #10032 is 0) shows as **No gearset loaded** (connected and idle) instead of Controller
  unavailable, is logged once instead of every few seconds, and starts collecting by itself once
  a program is loaded.
- **Deploy keeps the collector current.** When the Lapper Read collector already runs on the host,
  the deploy rebuilds its image and restarts it with the release; before, it kept running the old
  image until it was rebuilt by hand. A host that never started the collector is left alone.
- **Connect the Docker collector from Lapper.** Configuration → Collector Tokens has a
  **Connect Docker collector** button: the API issues the collector its own token on a private
  volume shared only with the `lapper-read` container (new `lapper_read_credentials` volume),
  revokes the previous one, and the collector picks it up by itself. No `.env` entry, and the
  token is never shown. New endpoints `GET`/`POST /api/v1/collector-token/docker` (admins);
  migration `20261111-lapper-collector-token-purpose-v1` adds `lapper.collector_tokens.purpose`.
- **Lapper Read (Python) without a scanner.** Every Active machine with a FANUC IP now gets a
  worker. Without an Active scanner its completed cycles are recorded with no serial (gearset,
  consec, time and changed macros); with one, the strict scanned-serial rule is unchanged.
- **Lapper Read (Python) on real FANUC controls.** FOCAS longs are read as 32-bit (the 64-bit
  Linux library stores them that way) and PMC signal bytes as unsigned bytes; the image makes
  its code readable by the collector user.
- **Deploy.** Weak or placeholder JWT secrets in the host `.env` are now a warning, not a stop,
  matching the API's own startup warning (it still requires 16+ characters).
- **Repository layout.** The `manufacturing/` folder is gone (`libs/manufacturing`,
  `tools/manufacturing`, `docs/manufacturing`, `commands/`); manufacturing commands are targets of
  the `manufacturing-tools` Nx project; `npm test` runs through Nx; Dana UI has one copy (the
  `libs/shared/dana-ui` source, no vendored package); release archives and stale reports are no
  longer committed.

## 70.5.0 (2026-11-10)

Lapper joins the shared MeshForge experience, and gets a collector that runs in Docker.

- **Lapper in the shared shell.** Lapper uses the shared sign-in, password recovery, session
  and Admin pages, and the same sidebar, top bar and page vocabulary as Blade Tracking, Cutter
  Builder and Greenshed. The other apps link to it under SHARED APPS and it links back.
- **Lapper forms.** A machine's department is required and chosen from real departments. A
  gearset's pinion and ring lists narrow to one summary family and the ratio is read-only. Part
  summary is required. Parts and part summaries have no Delete action (the API refuses to
  delete shared master data from Lapper); set one Inactive instead.
- **Lapper configuration.** New Scanners, Macros and Fanuc Variables pages. Setup edits appear
  only for MeshForge administrators, because the API rejects them from anyone else.
- **Python Lapper Read collector in Docker** (`apps/lapper-read-py`, compose profile
  `collectors`). One container keeps a worker for every Active machine that has a FANUC
  controller IP and an assigned scanner, and follows the C# worker's rules. FANUC's licensed
  `libfwlib32.so` is mounted, never committed. Not yet verified against a real controller.
- **Collector tokens.** Administrators create and revoke tokens in Lapper > Configuration >
  Collector Tokens. A token is shown once, stored only as a hash, reaches only the endpoints a
  collector needs, and stops working when revoked. New table `lapper.collector_tokens`.

## 70.4.1 (2026-11-10)

Label fixes from the first tags printed on a Zebra.

- **Tag layout.** The barcode is centred and wider (three-dot bars for T and C serials, two for
  a typical location serial) with the serial centred under it, instead of a small barcode in
  the top corner. The first prints landed about 2.5 mm high and 2.9 mm left, with the top of
  the barcode in the gap before the label; ZPL tags are positioned to allow for that, and the
  layout leaves room for a printer that registers exactly.
- **Position adjustment per printer.** Admin > Label Printers > Edit has Move right and Move
  down, in dots, for a printer whose labels do not sit squarely. It applies to tags and cutter
  cards in both IPL and ZPL. Two columns are added to `gear_label_printers` at startup.
- Tags fit serials of up to 30 characters (was 32), so a long barcode keeps its quiet zones.
- `Deploy-To-usftwvmdocker.cmd` in the repository root deploys to the plant Docker host in one
  step.

## 70.4.0 (2026-11-10)

Label printers with IPL or ZPL, DSF production counts, and a workflow and UI review.
API changes are additive. New tables are created at startup when missing; no existing table
or data is changed.

- **Label printers.** Admin has a Label Printers tab: add each network printer with its
  address, its language (IPL for Intermec, ZPL for Zebra) and what it is loaded with, test the
  connection, print a test tag, and choose the default for tags and for cutter cards. Print
  screens show "Print tags to" / "Print cards to", so a workstation can pick its own printer;
  the choice is remembered on that computer. Tags and cutter cards are generated in the chosen
  printer's language. Print Cutter Card now sends the card to the card printer instead of only
  saving files. A failed print says what to check (no answer, refused, name not found). The
  IPL tag layout was corrected: it was laid along the 0.625 in feed, where it cannot fit.
  New table `gear_label_printers`, created at startup; `GEAR_LABEL_PRINTER_HOST` remains the
  fallback tag printer. See docs/printing/LABEL-PRINTERS.md.
- **Printing.** Creating a tray works again; the API was rejecting the Admin screen's own
  request, so no new tray could be added or tagged. Every Print Tag button now reports the
  outcome in a notice that stays visible on long lists, and a tag the printer did not accept
  is a warning rather than a green "sent" message. A serial too long for the 2.125 in tag is
  refused instead of printing a barcode that runs off the label. The cutter card prints its
  build date in plant time instead of the API host's UTC clock, and its PNG preview has a
  scannable barcode and a build number that fits. Coater packing slips and container labels
  read "1 tray", not "1 trays".
- **Dashboards.** KPI tiles on all three dashboards are back in a row (4 across, 3 + 3,
  3 + 2). A Dana core grid rule had been overriding the Gear tile geometry, so every tile
  sat on its own line.
- **Shell.** The drawer button is hidden on desktop, where the sidebar is always docked.
  The dashboard link only looks selected, and only says ACTIVE, on the dashboard. A closed
  mobile drawer no longer casts a shadow on the page or takes keyboard focus. Cancel pages
  have a proper header and browser-tab title. Blade Tracking operations are listed in
  process order: Intake, Grinding, Load, Ship, Receive, then Internal Movement.
- **Scanning.** The cursor now returns to the scan field an operator needs next on every
  scan screen, including after a rejected scan. It was being lost whenever the page was
  busy, which silently dropped the following scan. Scanned text is selected so the next scan
  replaces it.
- **Blade Intake.** After adding blades the cursor returns to the tray scan. It used to sit
  in Quantity, where scanning the next tray could add blades to the previous one. Enter in
  Quantity no longer submits. Top-ups default to the missing count, and a rejected quantity
  says why.
- **Grinding.** A tray left short after grinding reads "Needs replacement blades" with the
  next step, instead of READY_FOR_COATING.
- **Coater Shipments.** One rejected container scan no longer locks the draft.
- **Machine Setup.** The part list is no longer cut off at 250 parts, and the build list no
  longer drops older shelf stock. "Setup Another Cutter" after a setup started from the
  board works. A list that fails to load says so instead of reading as "none configured".
- **Cutter Pull.** A reason must be chosen; the first reason in the list (a teardown) is no
  longer preselected. Results and history show the reason name, not its code.
- **Running Machines.** A FAIL or HOLD check is red, not green. A failed auto-refresh says
  the board is stale, and a later good refresh clears the message.
- **Search.** The Greenshed and Cutter Builder top-bar search accepts a machine number, body
  serial or Summary as well as a build number, and works when Lookup is already open. Find
  Inventory and Tray Contents follow the Blade Tracking search the same way.
- **Build / Tear Down.** Pick lists reload after each transaction and a changed upstream
  choice clears the dependent one.
- **Admin.** An administrator cannot disable or demote their own account, and the last
  active administrator cannot be removed (enforced by the API). Editing a record no longer
  re-enables it. Users without an email can be edited. Part Summary cards show their Model.
  Saving one Roll Master row keeps unsaved edits in the others.
- **Sign-in.** The local test-account hint appears in development builds only. Forgot
  Password says to contact an administrator when the server has no outgoing email
  (`/auth/capabilities` now reports `passwordResetEnabled`).
- **Lapper.** A slow scanner image no longer stops the live card updating. Edit dialogs show
  the current status. Delete is no longer offered for parts and part summaries, which the
  API never allows from Lapper.
- **API.** Piece counts above the integer column range return a validation error instead
  of a database error. "Cancel last tray transaction" accepts a serial in any letter case.

DSF (Digital Shop Floor / Ignition) production counts for cutting Departments 132 and 152,
restored from the earlier integration. Off by default; see `docs/DSF_COUNTS.md`.

- **Reader** (`DSF_COUNT_ENABLED`). The API pulls RUN production from the DSF PostgreSQL source
  in a read-only session and Running Machines shows a **DSF Count** column. Nothing is written
  to DSF, and nothing else changes.
- **Cutter crediting** (`DSF_CUTTER_WRITE_ENABLED`). DSF production is added to the installed
  cutter's Part Count through a machine + cutter run + shift ledger, so the 25-piece check comes
  due without a count being entered. Crediting starts at activation and does not back-fill; it
  stops for review rather than guess when the source total drops or a count is changed by hand.
- **Admin > DSF Mappings.** Choose, change or remove the DSF source for each machine, with
  the reader's status and the reason for its last failed read. Changes are audited.
- **Changeover.** A cutter returning from a Greenshed shelf continues with the piece count and
  last-check count of its previous run instead of the typed starting count.
- With crediting on, a quality check records the count it was taken at and cancelling a check
  leaves the running count alone. With it off, both behave exactly as before.
- Four additive tables are created the first time the reader is enabled. Department 45
  grinder balances are not included: they depend on grinder tracking and loose blade sets that
  this codebase does not have.

## 70.3.0 (2026-11-09)

- Fixed clean Linux Docker builds when a native dependency's prebuilt download
  fails: dependency stages now include the Python/Make/C++ toolchain, and CI
  builds every application image with a forced native-compilation check.
- The bootstrap services use the locally built API image without attempting to
  pull its unpublished tag from Docker Hub.

All four applications now belong to one root Nx workspace and use one dependency
manifest and lockfile. Application releases share the root version constant.

- All application and end-to-end projects now live under root `apps/`, including
  the shared API and the Lapper Read collector.
- One root `compose.yml` and existing root `.env` configure the whole stack.
  Deployments retain the `dana-apps` project and PostgreSQL volume identity.
- Every web client and Lapper Read uses `meshforge-server` on port 3333, the shared
  email login and PostgreSQL connection. The standalone Lapper API is removed.

- Aligned Angular 20.3.35, NestJS 11.2.9, TypeORM 1.1.2, Nx 24.0.5,
  TypeScript 5.9.3, Jest 30, Node 24.22.1, and npm 11.9.0.
- Dana UI 0.3.3 source is included under libs/shared/dana-ui and built with the
  root Angular compiler. Every client uses this source and one generated package.
- Removed the manufacturing dependency install, lockfile, Nx configuration,
  duplicate UI package, obsolete UI adapters, and unused crypto/UUID packages.
- Migrated Angular application builds, backend webpack builds, Jest configuration,
  flat ESLint configuration, Docker contexts, CI, Windows tools, and deployments.
- Updated JWT decoding, Nest configuration typing, public health tests, template
  resolution, and keyboard/focus handling for the shared framework versions.
- Retained the 70.2.1 authentication and inventory safeguards, API routes,
  PostgreSQL data preservation, Lapper history and collector retry/checkpoint rules.

Upgrade: install once at the repository root with npm ci. Keep the existing root
.env for the shared API and Compose stack. Use
npm run test:versions to detect dependency or release-version drift.

## 70.2.1 (2026-11-09)

Recovered from the original 70.2.0 upload and rebuilt with security, inventory,
deployment, and user-interface fixes. The original archive and this source are
retained in the MeshForge GitHub repository alongside the existing Lapper app.

- Department relations load during authentication, restoring operator permissions.
- Refresh tokens use complete digests, unique IDs, token purposes, and atomic
  rotation. Expiring single-use recovery codes revoke existing sessions on reset.
- Verified Google sign-in requires a preapproved account bound to that identity;
  recovery and database errors are sanitized. Legacy email casing is supported.
- Working shared password-recovery pages, keyboard login, and invalid-session
  redirects are available in all three apps.
- Inventory mutations protect assigned blades and occupied trays, containers,
  shelves, and machines. Cutter compatibility and stale machine-run checks are
  enforced by the server. Scan selection, pagination, and response races are fixed.
- Optional empty Sentry configuration now starts. Automatic imports initialize empty
  master data while preserving existing operational edits. Deploy uploads use private
  staging. Additive user schema changes work with runtime synchronization disabled.
- Dana UI 0.3.2 is built for Angular 19 and retains Gear's compatibility styles,
  with table cleanup, Escape/focus behavior, and modal accessibility corrections.
- Build-only dependencies moved out of the production install and compatible
  vulnerable dependencies were updated. Remaining framework advisories are recorded
  separately; this release does not claim a clean dependency audit.
- Portable unit/configuration/source-contract runners and behavioral regressions
  are included. The parent repository adds dedicated manufacturing CI.

Upgrade: users must sign in again and request new recovery links. Configure SMTP
and PUBLIC_WEB_BASE_URL (Docker GEAR_PUBLIC_WEB_BASE_URL) for recovery email links.
Use the dedicated workflow endpoints rather than generic blade-assignment PATCH.

## 70.2.0 (2026-10-28)

All MeshForge styling now comes from **@dana/ui 0.3.0** (Dana UI). No screen looks different:
the compiled stylesheet has the same 1,496 rules in the same order, and 86 screenshots (every route,
every admin tab, login and an error toast, on desktop and phone) are pixel-identical to 70.1.2.

Deploy as usual with `Deploy-MeshForge.cmd`. There is no database change.

### Changed

- **Styling moved into Dana UI.** Gear's own design-system libraries (`libs/shared/ui-tailwind`
  and `libs/gear/ui`) are gone. Their CSS now ships in @dana/ui 0.3.0 as an optional Gear
  compatibility layer (`gear-compat.css`, `gear-compat-features.css`,
  `gear-compat-overrides.css`) that only Gear loads. Truck Log's Dana UI stylesheets are
  byte-identical to 0.2.0.
- Components import Dana UI from `@dana/ui` (29 files), and the Tailwind preset comes from
  `@dana/ui/tailwind/tailwind-preset.cjs`.
- **Internal Movement** tray details use Dana UI's detail grid, and the **Green Shed Setup**
  button uses `danaButton`, instead of Gear-only colors and a Gear-only button class.
- Contract tests now read the Dana UI component source from the vendored package's source map,
  and check that every shared stylesheet comes from `@dana/ui`.
- README: new "Styling (Dana UI)" section with the styling rules and the Dana UI update steps.
  The older design-system docs are marked as superseded.

### Tested

- 88 contract tests, typecheck and the Angular template compiler (all projects), production builds
  of all three apps.
- Frontend Jest specs ran for the first time in this review (6 tests, all pass).
- `apps/server-e2e` was not run: it uses SQLite, and the uploaded `node_modules` holds the
  Windows build of `better-sqlite3`. Unchanged since 70.1.0.

## 70.1.2 (2026-10-28)

The 70.1.1 deploy stopped on the next summary with the same condition (Summary 30163, revisions
blank and B). The plant confirmed blade requirements are the same for every revision, so this is
now a rule instead of per-summary mappings:

- **A blade requirement with no revision applies to every enabled revision of that Summary.**
  The import no longer stops on "N enabled revisions exist". Tested with 102 summaries carrying
  several revisions; every revision receives the same blade counts, and re-running changes nothing.
- **Supplemental summaries** (`summary_additions.json`) no longer stop the import when several
  revisions already exist; that step only ensures the summary exists.
- `cutter_blade_requirements.json` is back to exactly the Excel export (216 rows); the 70.1.1
  manual 30135 rows are no longer needed. `Summary_Rev` still accepts an explicit revision, or
  `(blank)` for exactly the blank revision, if a requirement ever needs to differ by revision.

## 70.1.1 (2026-10-28)

Hotfix for the first 70.1.0 deploy, which stopped at the reference-data import.

- **Summary 30135 blade requirement.** Production has two enabled revisions of Summary 30135
  (blank and B), and the import refused to guess which one the 19-blade RING/PINION requirement
  belongs to. It now applies to both, as decided on 2026-10-27. `Summary_Rev` in
  `tools/base-data/data/cutter_blade_requirements.json` accepts `(blank)` to mean exactly the
  blank revision; use one row per revision when a requirement covers several.
- **Deploy shows the real error.** If a setup step (database bootstrap or reference-data import)
  fails, the deploy now prints that step's last 40 log lines instead of only `bash -s failed`.
- **Rollback on the first deploy.** With no newer previous release yet, `--rollback` now falls
  back to the pre-70.1.0 release in `/tmp/dana-apps.v0.1`.

## 70.1.0 (2026-10-28)

The first release with a single version number. Earlier builds were labelled V68.x to
V70.0.8R61R23 in comments and patch folders, while `package.json` said `0.0.0` and the UI said
`v1.0.0`.

### Do these in production

1. **Check for test accounts.** Earlier test scripts created `admin@meshforge.local` and
   `e2e.admin@meshforge.local` (role admin) and `test@meshforge.local` with passwords published in
   this repository, in whatever database `.env` pointed at. The development `.env` in the upload
   points at `DATABASE_HOST=usftwvmdocker`, the Docker host. Run this against production:
   `SELECT email, role, active FROM users WHERE email ILIKE '%@meshforge.local';`
   Disable or delete any rows it returns.
2. **Rotate the JWT secrets** if the production `.env` uses the template placeholders or anything
   under 32 random characters. The deploy script checks this for you and stops if they are weak.
   Rotating signs everyone out once.
3. **Use `Deploy-MeshForge.cmd` from now on.** The first run moves the release from
   `/tmp/dana-apps.v0.1` to `~/dana-apps` and carries the `.env` over.
4. **After deploying**, run `npm run db:check-drift` against production (read-only).

### Fixed

- **Startup deadlock.** Three startup schema routines (master data, workflow journal, Green Shed
  shift counts) ran in parallel under separate locks and could deadlock on `cutter_builds`. They now
  take one shared lock first. In a stress test the old code deadlocked 2 times in 40 runs; the new
  code ran 190 times with none.
- **Generic pull reasons came back on every restart.** The base-data import deletes DULL, DAMAGED,
  CHANGEOVER, QUALITY and OTHER in favour of Dana's `PCR_*` reasons, but the API re-created them on
  every start, so operators saw both sets. Startup now seeds them only into an empty table. Rows
  that are not referenced by cutter history disappear at the next base-data import, which runs on
  every `compose up`.
- **Changeover shortcut.** Running Machines → *Changeover* asked for the code `CHANGEOVER`. Without
  that generic row the Pull page fell back to the first reason in the list, a teardown reason. It
  now selects the configured return-to-shelf reason (e.g. `PCR_002`).
- **Strict type errors** in `workflow-reversal.ts` (40) and the asset-tag service (3). These stopped
  11 server libraries from compiling under their own strict settings and stopped most server unit
  tests from running. Runtime behaviour is unchanged.
- **Intake:** after a tray scan the cursor goes to the first field that still needs input (Summary,
  Part Type, then Quantity), including after each batch.
- **Internal Movement:** the confirmation shows the tray's Summary, Part Type and blade count again.
- **Green Shed Setup** uses the shared workflow layout like Pull and Check. All bindings are unchanged.
- **Garbled characters:** `Empty â€” Available` on Cutter Teardown and the `â€¢` bullet in the Running
  Machines footer.
- The Running Machines table had two `class` attributes; the dead one was removed (compiled output
  unchanged).

### Added

- `MESHFORGE_VERSION`, shown in all three sidebars, Swagger and `GET /api/v1/health/live`;
  `npm run version:set` and `npm run test:version`. Docker images are tagged with the version.
- `Deploy-MeshForge.cmd` / `tools/deploy/deploy-remote.mjs`: backup before deploy, release kept for
  `--rollback`, `--check` preflight, refuses weak secrets and test-account opt-in, verifies the
  deployed version. It replaces `Dana-Apps-Native-Remote-Deploy.cmd`, now in `tools/retired/`.
- `npm run db:check-drift`: a read-only comparison of the entities with a live database. Two
  indexes created at startup are now declared on the entities, so a fresh install has zero drift.
- `npm run test:workflow`: a cross-platform 23-call end-to-end test. Fixtures now create numbered
  E2E shelves (`-990`), the rough shelf and an E2E Cutter Builder machine.
- `MESHFORGE_ALLOW_TEST_ACCOUNTS=YES` opt-in for the fixture scripts. The API warns at startup about
  placeholder or short JWT secrets.

### Changed

- Read-side queries moved out of the three largest services into `cutter-build.queries.ts`,
  `greenshed.queries.ts` and `tray.queries.ts`. The services delegate to them. All 50 read endpoints
  returned identical data before and after on a live database.
- `greenshed-running-machines.css` (1,144 lines) was split at its section markers into four files
  that load in the same order. The resolved CSS is identical.
- Tests: 17 contract tests that had drifted from the code were updated. Brittle exact-count and
  file-hash checks now assert the real rule. The R37 harness was retired. Server unit-test mocks and
  build-number expectations were fixed.
- Root clean-up: reports, old manifests and deploy logs moved to `docs/history/`. Generated test
  output is no longer shipped. `.dockerignore` was rewritten for this project (it was copied from
  Truck Log). `pagination.contants.ts` was renamed to `pagination.constants.ts`.

### Known follow-ups

- `tools/test-full-workflow.ps1` (PowerShell master suite) still uses per-summary Cuttergrind shelves
  and has no coater shipment or Cutter Builder machine steps. Use `npm run test:workflow` until it is
  updated.
- Four tables (three on Coater Shipments, one on the Blade Tracking dashboard) don't use the shared
  `danaTable`. They are listed as exceptions in the test, and should be moved only after checking
  screen and print output.
- `frontend-feature-admin-users.component` (1,005 lines TS, 831 HTML) should be split into
  per-tab components.
- Frontend Jest specs and the Angular production build were not run in this review: the review
  machine could not install the Linux build tools. The Angular template compiler (`ngc`) was run
  on all three apps and reports no errors.
