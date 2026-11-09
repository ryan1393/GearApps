# Scheduled Load Excel Import

Excel scheduling workflow:

1. Manager opens **Settings > Scheduled Loads**.
2. Click **Download Excel Template**.
3. Fill the `Scheduled Loads` worksheet using exactly these headers:
   - `Load Number`
   - `Scheduled Date`
   - `Scheduled Time`
4. Upload the `.xlsx` file.

Import rules:

- Entire workbook is validated before database changes.
- Duplicate Load Numbers inside the same workbook reject the upload.
- Invalid/missing date/time values reject the upload.
- Existing active Load Numbers are updated.
- New Load Numbers are inserted.
- Loads not present in the upload remain unchanged.
- Imported rows use source `EXCEL_UPLOAD:<filename>`.
- Maximum workbook size is 5 MB and maximum data rows is 5,000.

API:

- `GET /api/v1/scheduled-loads`
- `GET /api/v1/scheduled-loads/template`
- `POST /api/v1/scheduled-loads/import`
- `GET /api/v1/scheduled-loads/lookup?loadNumber=...`

The schedule remains authoritative only for `truck_visits.scheduled_at`; if a required check-in Load Number has no active schedule row, the visit schedule is `NULL`.
