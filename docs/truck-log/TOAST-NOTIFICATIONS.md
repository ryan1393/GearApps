# Truck Log Toast Notifications

Truck Log uses one shared toast overlay for transient operator feedback across the entire application. One-time success, warning, and error messages should not occupy permanent page space.

## Global convention

Use toasts for transient results and failures:

- Guard Dashboard refresh / Final Guard Checkout
- Active Trucks refresh / Final Guard Checkout
- Dock Board refresh / Dock Complete
- Check-In success / check-in failure / blocked slip window / paperwork upload attention / successful paperwork retry
- Records & Paperwork search / record open / paperwork upload success or failure
- Settings dock add/enable/disable, dock-alert save, schedule import, and settings-load failures

Toast tones:

- green = success
- amber = warning / action still needed
- red = error
- blue = informational notice

## What stays inline

Persistent state or actionable conditions remain in the page instead of disappearing:

- Check-In paperwork retry panel while files are still pending
- no-active-docks warning
- invalid dock-aging threshold validation
- selected Excel file / current scheduled-load list
- system-health status
- confirmation modals for consequential workflow actions

Check-In no longer uses a green success notification panel. A small neutral `Last check-in` action row remains only to preserve the `Reprint Last Slip` capability after the success toast disappears.

## Shared implementation

- `libs/truck-log/web/ui/src/lib/toast.service.ts`
- `libs/truck-log/web/ui/src/lib/toast-host.component.ts`
- Toast styling: Dana UI (`.dana-toast`)

The toast host is mounted once in the shared application shell. Toasts render in the upper-right, do not alter page layout, can be dismissed manually, and auto-dismiss after a short delay.
