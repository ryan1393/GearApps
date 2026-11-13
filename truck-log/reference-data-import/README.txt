TRUCK LOG REFERENCE CSV DROP FOLDER

Use reference-data-template.csv as the format example.
Create or copy the file you actually want to import as:
  reference-data.csv

Then run from the Truck Log root:
  Windows: IMPORT-TRUCK-LOG-REFERENCE-CSV.cmd
  Linux:   ./IMPORT-TRUCK-LOG-REFERENCE-CSV.sh

Accepted columns:
  Type,Name,Phone,State

Accepted Type values:
  Driver
  Carrier
  Location
  Origin       (imports as Location)
  Destination  (imports as Location)

Rules:
- Name is required.
- Phone is optional and only used for Driver rows.
- Driver Phone is normalized to digits and must contain 7-15 digits when supplied.
- State is optional for Location/Origin/Destination rows.
- Blank lines are ignored.
- Duplicate names within one type are consolidated before import.
- Import is additive and runs a rollback-only preflight before commit.
- No working reference-data.csv is shipped, so sample names cannot be imported accidentally.

Fresh Truck Log databases already contain the authoritative Fort Wayne dock master.
SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.cmd / .sh can restore that exact 9-dock master if needed.
CLEAR-TRUCK-LOG-DATA.cmd / .sh clears operational, RXO, reference-data AND dock rows after an explicit CLEAR confirmation; it preserves app/plant settings and users/auth.

These helpers run inside the Dockerized truck-log-server and do not require host Node.js.
