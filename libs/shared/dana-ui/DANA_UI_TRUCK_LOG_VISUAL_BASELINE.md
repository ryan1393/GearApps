# Dana UI V0.2.0 — Truck Log Visual Baseline

Truck Log is the visual source of truth for Dana UI.

## Canonical shared entry

`@dana/ui/styles/dana-ui.css`

This resolves to the neutral Dana core and intentionally does **not** import the
legacy Gear compatibility layer.

## Visual language

The Dana core follows Truck Log's current visual direction:

- dark navy/blue fixed navigation rail
- white sticky topbar
- light cool-gray page canvas
- clean white panels with restrained borders/shadows
- plain, readable page headings rather than decorative hero cards
- simple compact tables
- blue primary actions
- green completion/success actions
- rounded status pills
- compact form controls
- operator-focused spacing and responsive collapse behavior

## Gear compatibility

`@dana/ui/styles/gear-compat.css` remains packaged only as a temporary migration
aid. It is not part of the canonical Dana UI entry.

MeshForge should move toward the Truck Log-derived Dana core, not redefine it.

## Product boundaries

Dana UI is a presentation package only. Truck Log and MeshForge remain separate
repositories, databases, Docker deployments and release cadences.
