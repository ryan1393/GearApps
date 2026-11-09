# Frontend Architecture

Gear Apps has three Angular frontends:

- `apps/blade-tracking`
- `apps/cutter-builder`
- `apps/greenshed`

The deployable apps remain thin. Domain UI and API-access logic live in Nx libraries such as:

- `libs/frontend/feature-blade-tracking`
- `libs/frontend/data-access-blade-tracking`
- `libs/frontend/feature-cutter-builder`
- `libs/frontend/data-access-cutter-builder`
- `libs/frontend/feature-greenshed`
- `libs/frontend/data-access-greenshed`

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
