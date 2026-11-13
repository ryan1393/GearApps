# Truck Log Reference Data — Drivers, Carriers, Locations

## Purpose

Truck Log now keeps common guard-shack values reusable without changing the historical truth of an individual truck visit.

The reusable master lists are:

- Drivers
- Carriers
- Locations

Drivers and carriers are intentionally independent. A returning driver can arrive under a different carrier on any visit.

## Driver Phone

Driver Phone is required for every **new** guard check-in.

Existing historical rows are not rewritten or forced to have a phone number. The database insert trigger requires Driver Phone only on new visits.

The professional Driver / Dock Assignment Slip prints the phone number with the driver information.

## Snapshot + master-data rule

A visit stores both reusable IDs and snapshot text:

- `driver_id` + `driver_name` + `driver_phone`
- `carrier_id` + `carrier_name`
- `origin_location_id` + `origin_name`
- `destination_location_id` + `destination_name`

This is intentional. Editing a master record later must not change the driver/carrier/location information that was recorded on an older truck visit.

## Driver / carrier independence

There is no permanent `carrier_id` on the Driver master record.

The driver and carrier are selected independently at Check-In and their relationship exists only on that visit.

## Check-In behavior

Check-In provides browser-native reusable suggestions for:

- Driver Name
- Carrier
- Origin
- Destination

Free-text entry remains allowed. When a new value is used successfully, the server creates or updates the reusable master record.

Selecting a known driver can populate the saved phone number when the phone field is still blank.

Disabled master records are hidden from Check-In suggestions but remain available in Administration and historical visit links remain intact.

## Administration

Administration includes full reusable lists with:

- add
- edit
- enable / disable
- filter
- Last Used

Locations can additionally store:

- street address
- city
- state
- ZIP / postal code
- country

Location address fields are reference metadata; the visit snapshot currently keeps the operational Origin/Destination name used at Check-In.

## Current Truck Log backfill

The current schema migration seeds reusable master lists from distinct values already present in the **Truck Log PostgreSQL database** and links existing visits to those master rows where names match.

This does not overwrite historical snapshot text and does not guess historical Driver Phone values.

## Legacy SQL Server reference import

The old `InboundOutboundLoads` SQL Server database is **not imported automatically by Truck Log setup or migrations**.

If that legacy source is imported, use a controlled process:

1. deep-scan legacy Driver / Carrier / Origin / Destination values;
2. normalize whitespace/capitalization;
3. identify exact duplicates and likely near-duplicates;
4. produce a cleanup review;
5. approve canonical values;
6. import only the cleaned master data.

Do not blindly copy every legacy spelling variant into these master tables.
