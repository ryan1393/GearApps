# Frontend Architecture

Gear Apps has three Angular frontends:

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
