# DSF production counts (Digital Shop Floor / Ignition)

MeshForge reads current-shift DSF piece counts for machines across all departments, including individual grinders and cutter builders. Lapper machines (every machine with a Lapper profile in `lapper.machines`) are left out: they get no DSF count, cannot be mapped to a DSF source, and the Lapper app has no DSF badge or Machine DSF Counts page. Machine DSF Counts is available in Blade Tracking, Cutter Builder and Greenshed, with counts beside selected machines and in Admin. Optional cutter crediting applies only to production cutting machines in Departments 132/152. The integration is off by default.

The API **pulls** from DSF on a timer. Nothing pushes to MeshForge, and MeshForge never writes
to DSF: the DSF session is a read-only transaction running fixed `SELECT`s, and it is closed
before any MeshForge table is written.

## Two switches

| Setting | Effect |
|---|---|
| `DSF_COUNT_ENABLED=true` | Reads DSF every `DSF_COUNT_INTERVAL_SECONDS` (default 60). Running Machines gains a **DSF Count** column: RUN production for that machine in the current DSF shift. Nothing else changes. |
| `DSF_CUTTER_WRITE_ENABLED=true` (needs the first) | Also adds that production to the installed cutter's **Part Count**, so the 25-piece check becomes due without anyone entering a count. |

Turn on the first, compare the DSF Count column with the shop floor for a few shifts, then turn
on the second.

## Settings

All in the root `.env` (template in `.env.example`): `DSF_DB_HOST`, `DSF_DB_PORT`, `DSF_DB_NAME`,
`DSF_DB_USER`, `DSF_DB_PASSWORD` or `DSF_DB_PASSWORD_FILE`, `DSF_DB_SSL_MODE` (`verify-full` or
`disable`), optional `DSF_DB_SSL_CA_FILE` / `DSF_DB_SSL_CA_PEM`, and optional `DSF_COUNT_MACHINES` (archived reference mappings only; leave empty when using Admin mappings).

- The reader stays off, with a warning in the API start-up log, if a setting is missing or
  invalid. It also refuses to point at the MeshForge database itself.
- The DSF login must be a restricted read-only role. If it is not, the reader refuses with
  `READ_ONLY_ROLE_REQUIRED` unless `DSF_PRIVILEGED_READER_ACK` carries the explicit
  acknowledgment text defined in `dsf-count.service.ts`, which is accepted for the recorded
  plant source only (`10.16.80.10` / `maindblocal`, login `dana_dsf_reader` or `whiteboard`).
  `whiteboard` is the DSF application's own login and can write to DSF, so with it the only
  protection is the read-only session MeshForge opens. Prefer a dedicated read-only role.
- The API process must run in UTC (the Docker default) for cutter crediting; cutter-run
  timestamps are stored without a zone and are read as UTC.
- The working client port and SSL mode for the plant source have not been verified from this
  codebase. Admin > DSF Mappings shows the reason and driver code of the last failed read
  (for example `ECONNREFUSED`, `ETIMEDOUT`, `28P01`), which is how to find them.

The first time the reader is enabled it creates four additive tables in the MeshForge database:
`dana_dsf_machine_mapping_v1`, `dana_dsf_machine_mapping_audit_v1`,
`dana_dsf_cutter_machine_state_v1` and `dana_dsf_cutter_run_shifts_v1`. They match the original
DSF migrations, so a database that already has them keeps its mappings and ledger.

## Getting it working

1. Set `DSF_COUNT_ENABLED=true` and the `DSF_DB_*` settings (in `.env` or Admin > Server
   Settings), then restart the API.
2. Open Admin > DSF Mappings. The banner at the top says what is wrong:
   - **Reader not running: <setting> ...** a setting is missing or invalid. It names the setting.
   - **The last DSF read failed: ... (CODE)** the settings are complete but the connection or the
     checks failed. The banner explains the common codes:

     | Code | Usually means |
     |---|---|
     | `ECONNREFUSED`, `CONNECT_TIMEOUT`, `ETIMEDOUT`, `EHOSTUNREACH` | Wrong `DSF_DB_HOST`/`DSF_DB_PORT`, or a firewall (or the Docker network) between the API and DSF. |
     | `SSL_NOT_SUPPORTED` | The DSF server has no SSL: set `DSF_DB_SSL_MODE=disable`. |
     | `DEPTH_ZERO_SELF_SIGNED_CERT`, `SELF_SIGNED_CERT_IN_CHAIN`, `ERR_TLS_CERT_ALTNAME_INVALID` | `verify-full` cannot verify the DSF certificate: supply its CA in `DSF_DB_SSL_CA_PEM`, or use `disable` on a trusted plant network. |
     | `28P01` / `28000` | Wrong password / DSF's `pg_hba.conf` refuses this login from the API host (try the other SSL mode). |
     | `3D000` / `42P01` | `DSF_DB_NAME` is not the DSF database. |
     | `READ_ONLY_ROLE_REQUIRED` | The login is not a restricted read-only role; see Settings above. |
     | `CLOCK_DIFFERENCE` | The API server and DSF clocks are more than 10 seconds apart. |
3. Once the banner says **DSF reader running**, open a machine, choose its source and save. If no
   sources are listed, the editor says why (for example, no DSF department is named like `Dept. 132`).
4. Check the DSF Count against the shop floor for a few shifts before turning on
   `DSF_CUTTER_WRITE_ENABLED`.

## Machine mapping

Each MeshForge machine is tied to one DSF source (whiteboard + mapping + operation + line). Admin mappings allow every numeric DSF department and its approved operation, including grinding. Lapper machines are not listed and a mapping for one is refused; any mapping saved for one is deleted when the API starts, recorded as an `UNMAP` (reason `LAPPER_MACHINE`) in `dana_dsf_machine_mapping_audit_v1`, and its DSF source is free to map to another machine. Until that start-up runs, such a mapping is ignored. Source discovery works before the first mapping is configured. The machine and source departments must match.

DSF departments are named like `Dept. 132`. Some have a plain name instead: the CutGrind
grinders (`CutGrind 3 1-24-79`) are in the DSF department `CUTTER GRIND`, which is MeshForge
Department 45. `DSF_DEPARTMENT_NAMES` lists those as `NAME=department` pairs, comma separated
(case and extra spaces ignored); empty means `CUTTER GRIND=45`. Setting it replaces the default,
so keep `CUTTER GRIND=45` in the list when adding others. Sources in any other department are not
listed.

- **Reference list.** The archived identities in `dsf-mappings.ts`. A reference mapping is used
  only for machine numbers listed in `DSF_COUNT_MACHINES`, and never when it is marked blocked.
- **Map Unique Matches** (Admin > DSF Mappings). Lists every machine whose DSF source is the
  only active one in its department with a whiteboard name ending in the machine number
  (`132 PIN CUTTER 549` -> machine 549 in Department 132), where no other machine has that number.
  Machines already mapped or unmapped in Admin, sources already used by another machine and
  machines with cutter-crediting history are left out, and the preview says why each unmatched
  machine was skipped. Confirming saves each match through the normal Admin save, with its
  checks and audit row.
- **Rough Match** (Admin > DSF Mappings). Lists every DSF source against every active machine,
  matched loosely by machine number: the number anywhere in the whiteboard name, or in the line
  name (not counting the department number). Words and numbers are compared apart, ignoring case,
  punctuation and leading zeros, so machine `1-24-79`, `79` or `CutGrind 3` all match
  `CutGrind 3 1-24-79`; a lettered number whose digits alone match (`G03`) is the weakest match. Only
  free, eligible sources in the machine's own department are offered. When one source is clearly
  the best for one machine it is picked; otherwise the administrator chooses from the candidates.
  Machines that already have a working source are shown (flagged when the source name does not
  look like the machine) but not changed; machines unmapped in Admin and machines with
  cutter-crediting history are left to map by hand. The full DSF source list says where each
  source goes, including sources whose number belongs to a machine in another department.
  Confirming saves each pick through the normal Admin save, with its checks and audit row.
- **Admin > DSF Mappings.** An administrator can choose the source for a machine from the live
  DSF source list. An admin mapping replaces the reference; unmapping a machine stops its
  counts. Every change is audited. A machine that already has crediting history can only be
  re-mapped to the same source.

Every read re-checks the source identity. If the DSF mapping, line, operation or department no
longer matches, or another mapping on the same operation carried production, the machine shows
**Mapping review** and publishes no count.

## What the numbers mean

DSF holds timestamped events, each with a `part_count` increment; it is not one cumulative
counter. MeshForge sums the increments of RUN events (reason code 1 for the mapped operation).

| Number | Meaning |
|---|---|
| DSF Count | RUN pieces for the machine from the start of the current DSF shift to the last read. |
| Part Count | The cutter's retained total. It can include a starting count and earlier runs. |
| Shift Count | With cutter crediting on: pieces DSF credited to the installed cutter this shift. Otherwise the machine's recorded increases, as before. |

Cutter crediting works from a ledger keyed by **machine + cutter run + shift start**. Each read
works out how many RUN pieces the shift holds for the installed cutter (from the later of shift
start and installation), compares that with what the ledger already credited, and adds only the
difference. A new shift starts a new ledger row and the cutter total keeps growing; a new cutter
is a new run.

- **Activation.** The first time a machine is credited, crediting starts at that moment.
  Production earlier in that shift is not added; the cutter's existing count stands.
- **Changeover.** A cutter that returns from a Greenshed shelf continues with the piece count
  and last-check count of its previous run. Pieces made while no cutter was recorded on the
  machine are not credited to anyone.
- **Quality checks.** With crediting on, a check records the count it was taken at (at or after
  the previous check) and never changes the running count, even when entered above it; the next
  check is due from the check's count. Cancelling a check puts back the previous check point and
  leaves the running count alone. A typed running-count update (`POST greenshed/machines/:machine/piece-count`)
  is refused while crediting is on.
- **Review instead of guessing.** Crediting for a machine stops, and Admin > DSF Mappings shows
  why, if the DSF total goes down or if the cutter's count was changed outside DSF crediting.
  A hand-changed cutter resumes at the next shift.
- Reads are bounded: more than 10,000 events for one machine in a read is refused rather than
  published truncated.

## Legacy loose-blade balances

The earlier DSF integration also credited a fixed set of five CutGrind grinders and debited loose coater loads. That separate stock ledger is only used when its legacy tables already exist. Individual grinder tracking and current-shift counts work without that ledger and are not limited to five grinders.

## Individual grinders

Create each physical grinder under Admin > Machines with type Grinder and its actual machine number. Select its DSF source in Admin > DSF Mappings. On the Grinding Station, scan or select that machine once, then scan trays. The workstation remembers the selection and displays its current-shift DSF count; unavailable counts appear as a dash with status. Pass history records the grinder ID, number at completion, tray, operator and blade disposition. Earlier passes without a grinder remain unassigned.
