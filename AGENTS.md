# Working in GearApps

Read [CLAUDE.md](CLAUDE.md) for the Nx layout, shared API/authentication,
Dana UI and repository verification commands.

For DSF, machine coverage or plant reporting work, first read
[DSF_DATABASE_REFERENCE.md](docs/manufacturing/DSF_DATABASE_REFERENCE.md) and
[PLANT_DASHBOARD_DSF_REFERENCE.md](docs/manufacturing/PLANT_DASHBOARD_DSF_REFERENCE.md).
The database reference records evidence levels and outstanding questions from
the November 2026 exports. Update it when new evidence resolves or changes a rule.
Do not turn a sampled interpretation into a confirmed plant-wide formula.

`maindblocal` is the DSF source, separate from MeshForge's application database.
Keep mapping, operation, line and physical-machine identifiers distinct. Preserve
read-only DSF access and existing source-identity checks. Raw exports, connection
credentials and private analysis files stay outside Git.

The plant dashboard is a separate frontend inside this Nx repository, sharing
MeshForge's server and Dana UI. Its current count/coverage screens do not yet
implement or validate the full DSF production/downtime reports. Maximum capacity
is distinct from target; the department ring center is capacity attainment,
not OEE. See the reference before adding metrics or declaring complete coverage.

Persistent RUN-count history is implemented in the existing DSF reader and the
plant dashboard's `/history` route. Read
[DSF_COUNT_HISTORY.md](docs/manufacturing/DSF_COUNT_HISTORY.md) before changing
collection or retention. Preserve whole-window replacement, identity versions,
explicit gaps and source-close-before-local-write ordering. The scan cursor is
work progress, not proof of complete source coverage.
