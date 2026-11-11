# Frontend Architecture

MeshForge has three Angular frontends:

- `apps/blade-tracking`
- `apps/cutter-builder`
- `apps/greenshed`

The deployable apps remain thin. Domain UI and API-access logic live in Nx libraries such as:

- `libs/manufacturing/frontend/feature-blade-tracking`
- `libs/manufacturing/frontend/data-access-blade-tracking`
- `libs/manufacturing/frontend/feature-cutter-builder`
- `libs/manufacturing/frontend/data-access-cutter-builder`
- `libs/manufacturing/frontend/feature-greenshed`
- `libs/manufacturing/frontend/data-access-greenshed`

Shared UI/util libraries are reused where appropriate.

## Local development

```powershell
npm run serve:blade-tracking
npm run serve:cutter-builder
npm run serve:greenshed
```

Development ports are 4200, 4201, and 4202. Each app proxies `/api` to the Nest API on port 3333.

## Naming

Use **Cutter Builder** for the application and UI. Use **Cuttergrind** / `CUTTERGRIND` only when referring to the physical department or its location rules.

## Colours, fonts and status pills

Every colour and the font come from the Dana tokens (`--dana-*`, defined in
`libs/shared/dana-ui/src/styles/dana-core/tokens.css` and recoloured for MeshForge in the Gear
layer). To change a colour everywhere, change its token. In a component:

- Use a token in CSS, for example `color: var(--dana-muted)` or `border: 1px solid var(--dana-border)`.
  Do not write a hex colour in a feature library.
- Tailwind colour classes (`text-slate-500`, `bg-red-50`, `border-emerald-200`, ...) are mapped to the
  same tokens in `libs/shared/dana-ui/src/tailwind/tailwind-preset.cjs`. A shade that is not mapped
  there keeps Tailwind's fixed colour; add it to the preset instead of using it as is.
- A status pill gets its colour from its status:
  `<span class="gear-badge" [danaTone]="row.enabled ? 'Active' : 'Inactive'">`. `danaToneFor` in
  `libs/shared/dana-ui/src/lib/components/data/dana-tone.directive.ts` holds the one vocabulary
  (Active and Enabled are green, Inactive and Disabled red, waiting and review states amber,
  in-process states blue, anything unknown grey). Add a new status word there, not in a template.
  For a fixed label use `data-tone="info"` (or `success`, `warning`, `danger`, `neutral`).

The printed packing slip and the cutter card image are drawn outside the page and keep their own
fixed black-and-white colours.
