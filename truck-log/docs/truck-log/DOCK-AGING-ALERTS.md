# Dock Aging Alerts

Truck Log highlights trucks that remain in `DOCK_ASSIGNED` too long.

## Clock source

The timer starts at `truck_visits.dock_assigned_at`.

It does **not** use `guard_check_in_at` for this alert.

## Default thresholds

Stored in PostgreSQL `app_settings`:

- `dock_warning_minutes = 15`
- `dock_critical_minutes = 30`

Below warning: normal display.
At/above warning: yellow.
At/above critical: red.

Only `DOCK_ASSIGNED` visits are color-coded. Once the dock marks a visit `DOCK_COMPLETE`, the dock-aging color is removed.

## Manager settings

The Settings page exposes:

- Yellow after (minutes)
- Red after (minutes)

Red must be greater than yellow.

API:

- `GET /api/v1/settings/dock-aging`
- `PATCH /api/v1/settings/dock-aging`

The thresholds can be changed without rebuilding Truck Log.

## Surfaces

Dock-aging color is used on:

- Guard Dashboard on-site table
- Dock Board cards
- Active Trucks table
