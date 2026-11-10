# Frontend Feature: Blade Tracking

Nx Angular feature library for blade tracking shop-floor workflows.

## Structure
- `shell/` - feature shell and child router outlet
- `pages/` - one standalone routed component per workflow
- `shared/` - reusable feature UI components such as the scanner panel
- `core/` - blade-tracking API/data access service
- `models/` - feature-only UI models

The feature intentionally avoids a single all-in-one component. Each workflow owns only its local UI state while HTTP access is centralized in `BladeTrackingApiService`.
