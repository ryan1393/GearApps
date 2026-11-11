# Coater RPA

Start the MeshForge API once to create the RPA tables. Keep `gearapps-current.dump` on the database host or on the machine running the import. The dump holds the saved Excel form, recipient lists, purchase order, part mappings, numbering, and historical requests.

From the repository root, preview the import against the intended database.

```bash
node tools/manufacturing/data-import/import-coater-rpa.mjs \
  --dump /path/to/gearapps-current.dump \
  --container POSTGRES_CONTAINER --database MESHFORGE_DB --user DB_ROLE
```

Omit `--container` if `pg_restore` and `psql` are installed locally. Add `--apply` to commit after checking the target and counts. Existing settings, mappings and delivery outcomes take precedence on repeat imports. Archived shipments are imported as history and the import does not replay dispatch or send email.

In **Blade Tracking → Coater Shipments**, open a reviewed shipment and select **Prepare RPA**. Enter a PO to override the configured default. The default expires at the end of its configured date in Indianapolis. The RPA uses the saved workbook layout and the part mappings for the shipment’s trays. Each shipment revision has one saved request.

Download the Excel workbook or use **Email RPA** with the API’s existing SMTP configuration. A failed request can be retried explicitly. If delivery is unconfirmed, check with the recipient before sending a copy. Coater dispatch and RPA email are separate operator actions.

Tray counts represent matched inner/outer sets. A tray count of 13 produces 13 inner blades and 13 outer blades on the RPA; two such trays produce 26 of each. The exporter preserves that count per side and does not divide it by two.

## The Excel form

The form is the workbook saved with the earliest imported request. It can be a file saved by Excel itself: part numbers stored as shared text, formulas with saved results and a calculation chain are all handled.

- A line's inner and outer part must be a name the form can total: one of its part lines (`B32`, `B35`, ... `B47`) or a name one of its `SUMIF` totals counts. That is how a coating variant such as `1700-5000 Evo`, which shares a part number with another line, is accepted.
- After the request is written into the form, every formula is recalculated and its result saved in the file, so quantities, amounts, the box count and the packing list are correct in mail previews, Protected View and on a phone, not only after Excel recalculates. Excel is also told to recalculate when the workbook opens.
- The calculator covers what the form uses (arithmetic, comparisons, `SUM`, `SUMIF`, `IF`, `OR`, `AND`, `INT`, `ISBLANK`, `CONCAT`, `TODAY`, shared formulas). A formula using anything else keeps no saved result and is calculated by Excel on opening.

