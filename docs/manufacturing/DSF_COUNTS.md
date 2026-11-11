# DSF production counts (Digital Shop Floor / Ignition)

MeshForge can read piece counts for the cutting machines in Departments 132 (Pinion) and 152
(Ring) from the DSF PostgreSQL database and, optionally, credit them to the cutter installed on
each machine. It is off by default.

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
`disable`), optional `DSF_DB_SSL_CA_FILE` / `DSF_DB_SSL_CA_PEM`, and `DSF_COUNT_MACHINES`.

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

## Machine mapping

Each MeshForge machine is tied to one DSF source (whiteboard + mapping + operation + line).

- **Reference list.** The archived identities in `dsf-mappings.ts`. A reference mapping is used
  only for machine numbers listed in `DSF_COUNT_MACHINES`, and never when it is marked blocked.
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
  the previous check) and no longer sets the running count. Cancelling a check puts back the
  previous check point and leaves the running count alone.
- **Review instead of guessing.** Crediting for a machine stops, and Admin > DSF Mappings shows
  why, if the DSF total goes down or if the cutter's count was changed by hand (a count update,
  or a check entered above the running count). A hand-changed cutter resumes at the next shift.
- Reads are bounded: more than 10,000 events for one machine in a read is refused rather than
  published truncated.

## Not included: Department 45 grinders

The earlier DSF integration also credited the five CutGrind grinders and debited tray and
container loads. That depends on features this codebase does not have: ANCA grinder machines
recorded on each grinding pass (`tray_grinding_runs.grinding_machine_id`), loose coater blade
sets (`dana_coater_blade_sets_v147`) with their packing trigger, and the Grinders Station page.
The grinder event importer is present and only runs when the grinder ledger tables already
exist; it has no screen here.
