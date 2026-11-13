# Driver Slip Print Fit + Plant Identity

## Goal

Keep the Dana Driver / Dock Assignment Slip on one Letter page without clipping footer or Visit Reference content, while using the available page height efficiently.

## Plant identity behavior

The top-left header reads the existing database setting `app_settings.plant_location_name` and renders a Dana plant identity such as `Dana Fort Wayne`. If the stored plant name already begins with `Dana`, the brand prefix is not duplicated.

## Current print-fit behavior

The print-only layout uses:

- Letter portrait margins of `0.22in` top/bottom and `0.32in` left/right;
- a printed slip minimum height of `10.56in`;
- a small internal print-safe inset of `0.02in 0.04in 0.03in`;
- compact fixed vertical spacing in the header, hero, sections, fields, notes, checkout, and footer;
- a flexible signoff spacer so spare page height is consumed intentionally;
- a small horizontal inset for bottom print metadata while keeping Visit Reference on one line.

This provides bottom-edge safety without hiding overflow or cropping content.

## Preserved behavior

- Dana Diamond / plant identity
- Driver / Dock Assignment Slip title
- human-readable Visit Reference (`TL-000123`)
- Driver Phone
- dock/load hero area
- routing and driver instructions
- Guard / Dock Notes
- Final Guard Checkout signoff
- final checkout warning and configured footer

No PostgreSQL writes or schema changes are required for this layout behavior.
