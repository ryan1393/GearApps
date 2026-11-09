# Dana UI Boundary

Dana UI is a standalone design-system package shared by independent Dana applications.

## Owns
- design tokens and typography
- buttons, icon buttons, tables, badges
- page headers, toolbars, grids, stacks
- alerts, loading/empty states, toast, confirmation dialog
- tabs and mobile navigation
- responsive visual language and semantic icons

## Does not own
- Gear business workflows or domain rules
- Truck Log workflows, RXO, SAP, check-in, dock or checkout logic
- application databases, API clients, DTOs, routes or permissions

## V0.1 compatibility
V0.1.0 preserves existing gear-* class aliases so Gear can later adopt @dana/ui without a visual rewrite.
New reusable APIs must use dana-* names.
