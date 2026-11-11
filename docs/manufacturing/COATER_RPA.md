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
