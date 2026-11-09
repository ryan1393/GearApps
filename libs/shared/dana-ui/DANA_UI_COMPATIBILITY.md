# Dana UI Compatibility Boundary

Dana UI is shared by independent applications. Truck Log is the visual source of truth beginning with Dana UI 0.2.0.

## Public stylesheet entries

- `@dana/ui/styles/dana-ui.css` — canonical Dana look, derived from Truck Log.
- `@dana/ui/styles/dana-core.css` — the same application-neutral Truck Log-derived core.
- `@dana/ui/styles/gear-compat.css` — explicit temporary Gear migration layer.

## Adoption rule

Truck Log must **not** depend on `gear-compat.css`.

Gear Apps may import `gear-compat.css` explicitly while its templates migrate from legacy `gear-*` selectors to the Dana-neutral component/class vocabulary. The compatibility layer must never redefine the canonical Dana visual source of truth.

## Compatibility debt

The optional Gear layer still contains legacy selectors and variables such as:

- `gear-*` classes and CSS custom properties
- Gear application shell selectors
- inventory / cutter / blade workflow selectors
- Gear semantic glyph names

These are migration debt only.

## Rule

New reusable components, selectors, tokens, and public APIs must use `dana-*` naming. Gear-domain selectors must not be added to the Dana-neutral core.
