# Human-Readable Truck Log Visit ID

Truck Log operators and driver-facing paperwork must not expose the long internal `visit_number` as the visible Visit ID.

## Public / printed format

```text
TL-000123
```

The number is derived from the permanent integer primary key of `truck_visits`.

Properties:

- short enough to read aloud;
- unique within Truck Log;
- stable for the life of the visit;
- works for existing visits without data migration;
- is returned by the API as `visitReference`;
- is shown consistently on Check-In, Dock Board, Active Trucks, Dashboard, History, and the driver slip;
- does not alter document-folder keys or historical database values.

## Internal compatibility

The existing `visit_number` remains unchanged internally for search/storage/folder
compatibility. The UI and driver-facing print title/top-right Visit ID/footer use the short reference. The long internal value remains available only for compatibility and internal search/storage.

## Scope

No database migration.
No schema change.
No workflow change.
No API route change.
No dependency change.
