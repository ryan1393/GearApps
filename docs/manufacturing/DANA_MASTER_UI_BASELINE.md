# Dana Apps Master UI Baseline

> **Superseded in 70.2.0.** Gear Apps styling now lives in @dana/ui (Dana UI). The paths below
> (`libs/shared/ui-tailwind`, `libs/gear/ui`) no longer exist; see the "Styling (Dana UI)" section
> of the README. This file is kept for history.


Gear Apps V69.2.9 freezes the Dana shared UI as the master presentation foundation for Dana Apps.

## Ownership

- `libs/shared/ui-tailwind` owns reusable Dana presentation and interaction primitives only.
- `libs/gear/ui` owns Gear-specific workflow presentation.
- Truck Log may consume Dana shared UI later, but Truck Log workflow presentation remains Truck Log-owned.
- Shared UI must not contain Blade Tracking, Cutter Builder, Greenshed, inventory, dock, truck, RXO, or other domain business rules.

## Required style order

Each Gear frontend loads styles in this order:

1. Application/Tailwind entry
2. `libs/shared/ui-tailwind/src/styles/gear-apps.css`
3. `libs/gear/ui/src/styles/gear-features.css`

## Responsive platform rules

- Desktop shell behavior remains intact at 1024px and above.
- Shared mobile navigation owns open/close state, overlay interaction, Escape close, and desktop reset.
- Dana responsive grids collapse through shared compact/mobile policies.
- Dana table shells own horizontal overflow and touch scrolling.
- Dana page headers, toolbars, and detail grids share one mobile stacking policy.
- Large data tables remain real tables and may scroll horizontally rather than being converted into pseudo-card rows.

## Protected shared primitives

The master foundation includes shared page headers, operation cards, tables, badges, empty/loading states, buttons, icon buttons, toolbars, alerts, detail grids, tabs, toast, confirmation dialog, mobile navigation, responsive grids, and stack primitives.

## Change rule

A future patch may extend the Dana shared UI, but must keep business-domain knowledge out of the shared library and must pass the authoritative Dana/Gear UI contracts before being accepted.
