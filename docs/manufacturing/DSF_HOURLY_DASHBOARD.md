# Hour-by-hour machine comparison

The plant dashboard's **Hour by hour** screen (`/hourly`) shows several machines
on one screen. Each selected DSF source has its own hourly RUN-piece chart.
The shared source catalog includes Cutter Grind, named departments and sources
without an approved physical-machine link.

## Use the screen

1. Open **Hour by hour** from Plant overview or Count history.
2. Choose one date in Indianapolis time. **Following today** advances to the next
   plant-calendar date after midnight; choosing a historical date keeps it fixed.
3. Add or remove sources, up to six at once. Department filtering narrows the
   available choices; the Cutter Grind action selects its active sources.
4. Use **Wall display** for a compact view on a plant-floor monitor.

Four active sources are selected initially, with Cutter Grind first. Clear this
selection or add and remove individual sources to choose a different comparison.
All charts share a vertical count scale. Inspect an hour with the pointer or
left/right arrow keys, or expand its exact hourly-values table.

The layout adapts to the available width. Normal desktop views use two columns;
wider views and the wall display can show three columns. Phones use one column.
The wall display is intended for several charts on one monitor, rather than a
playlist of separate dashboard pages or different TV configurations.

## What the charts mean

Charts read retained production from MeshForge's existing
[count history](DSF_COUNT_HISTORY.md). Bars represent accepted RUN pieces in a
UTC hour, labeled in `America/Indiana/Indianapolis`. Each selected day therefore
has 23, 24 or 25 real hourly windows. Repeated fall-back hours keep distinct UTC
identities and timezone labels.

- A recorded zero is real evidence of zero RUN pieces in that captured window.
- Partial coverage shows the accepted count for the captured portion.
- Missing or future coverage stays unknown; it is not drawn as verified zero.
- Review or duplicate-operation evidence is excluded from accepted production.
- Incomplete or truncated evidence cannot produce a complete day total.

The chart is a production-count view. It does not infer machine running state,
downtime, targets, maximum capacity or OEE from the shape of the bars. Physical
machine links remain subject to the existing approval and identity rules.
See the [database reference](DSF_DATABASE_REFERENCE.md) before adding metrics.

## Data and request limits

This screen introduces no server endpoints or source queries. It uses the
authenticated history status/catalog APIs and requests one calendar day with
`group=hour` and one `source_key` for each selected chart. At most six report
requests are active per refresh. This avoids relying on a plant-wide response
whose 5,000-row limit could omit selected equipment.

The browser refreshes local reports every 30 seconds. Each request times out
after 20 seconds so a hung source cannot indefinitely hold up successful charts.
Changing the date or source
selection cancels old report requests. Each source has its own failure state, so
a failed chart does not substitute zero or hide successful charts. Leaving the
screen or signing out destroys its polling and retained response state.

Deploy the rebuilt plant dashboard to add the screen. Collection still uses the
existing `DSF_COUNT_ENABLED=true` and `DSF_HISTORY_ENABLED=true` settings on the
MeshForge API. No additional DSF connection or password is required. Existing
saved history can be viewed while collection is disabled.

## Verification

From the repository root:

```sh
npx nx test plant-dashboard
npx nx run-many -t lint --projects=plant-dashboard,frontend-feature-plant-dashboard,frontend-data-access-plant-dashboard,frontend-util-plant-dashboard
npx nx build plant-dashboard --configuration=production
```

Coverage tests include verified zero, missing/partial/review evidence,
source-filter isolation, DST days, request cancellation and polling cleanup.
Browser checks use clearly labeled preview responses; they do not establish a
live plant connection or complete physical-machine inventory.
