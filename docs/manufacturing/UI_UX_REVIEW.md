# MeshForge UI/UX review

This review covers Blade Tracking, Cutter Builder, Greenshed, Lapper and Plant
Dashboard, including shared administration, login and recovery. It follows the current
application and Dana UI architecture. The changes address keyboard access, phone
layouts, unclear loading/failure states, stale selections and accidental repeated or
destructive actions. Authentication contracts, API paths and physical inventory rules
remain in place.

## Shared navigation and components

- The four manufacturing shells now provide a keyboard-visible Skip to main content
  link, one main landmark, and current-page announcements in navigation. Activating
  the skip link explicitly focuses the current-page target, avoiding Angular base-URL
  fragment navigation and preserving scanner autofocus.
- Mobile navigation has a named modal scope, an internal Close navigation button,
  initial focus, Tab/Shift+Tab containment, Escape handling and focus return to its
  opener. Switching to desktop releases the modal scope. A child control that already
  handles Escape keeps its own interaction.
- Dana form fields, comboboxes and table filter triggers have visible keyboard focus.
  Reduced-motion preferences apply to shared animation and scrolling.
- An unfinished pick-mode combobox search cannot submit a form using an old selection.
  Escape restores its selected label. Table header controls no longer accidentally
  trigger sorting, and replaced/renamed/static headers dispose of old controls and
  listeners while respecting application-owned attributes.
- Reusable appearance stays in Dana UI; screen-specific CSS handles layout. Shared
  Chromium regressions cover keyboard/form behavior, changing table headers, drawer
  focus, reduced motion and confirmation flows.

## Blade Tracking

- Inventory Control Center loads trays, containers, locations and blades independently.
  A failed lookup no longer discards successful tabs or blocks their searches. Errors
  and retries belong to the current view, unavailable totals display as unavailable,
  and stale responses cannot replace a newer search.
- Tray Contents clears old details/history when a new tray is selected, ignores late
  scan/history responses, announces loading and identifies each blade-history action.
  Scanning and printing cannot race each other's current selection.
- Operation pickers distinguish loading, failure and empty choices, support retry and
  Escape, and return focus after selection. Scanner help is associated with its input.
  Shipment-container choices ignore results for a draft or revision that has changed.
- Operation tabs wrap on phones. Embedded screen-reader headings no longer leak their
  wide descendants into the visible layout.

## Cutter Builder and Greenshed

- Build inputs remain stable during a pending save, and failed physical operations
  retain a visible error alongside the existing toast.
- Teardown uses a Dana confirmation identifying the validated build, tray, shelf,
  returned quantity and scrap quantity. Changing the selection dismisses an obsolete
  confirmation; saving rechecks that the confirmation and validated context still fit.
- Cancel Last uses the same confirmation component and captures the operation and
  reason being reviewed. It rechecks the current operation before sending the existing
  cancellation request, preserving the server's eligibility rules and audit behavior.
- Lookup screens provide a route back to results. Greenshed distinguishes a failed
  history load from an actual empty history and clears old build details on selection.
- Greenshed checks wait for both the validated run and reference choices before
  selecting the operator/DSF piece-count default. Choice failures have a retry; a save
  cannot use missing choices. Setup rejects an invalid or out-of-range starting count
  instead of silently substituting zero.
- Both shared Cutter Requests entry points remain part of the review. Their recovered
  workflow is documented separately in [CUTTER_REQUESTS.md](CUTTER_REQUESTS.md).

## Administration, login and recovery

- Phone administration uses a compact section selector instead of several screens of
  grouped navigation. It follows the existing `?tab=` selection/deep-link behavior;
  desktop keeps the grouped navigation. Record searches and account actions have
  explicit accessible names.
- Roles and badge assignments show loading and retry states and block edits before
  their catalog loads. Permission filtering uses readable action names and preserves
  selections outside the filter. Empty/disabled-role consequences are visible.
  Changes affecting assigned accounts require a confirmation explaining sign-out.
- Badge assignment validates the scanned value before opening its review dialog and
  identifies the destination account without displaying the UID. Disabling an account
  requires confirmation. User-form validation focuses invalid details, and failed
  saves preserve the draft and a persistent error. Department help distinguishes
  physical-operation access from shared requests and custom action grants.
- Settings refresh/discard warns before losing unsaved edits or replacement secrets.
  API restart uses a Dana confirmation and requires unsaved edits to be resolved first.
- Opening-inventory import reports row progress and partial results. A late file read
  cannot overwrite newly pasted/cleared CSV, and a rejected file cannot leave an old
  import ready to use. Clear import explicitly leaves recorded inventory intact.
  Launch Setup's grid and file input shrink within narrow screens.
- Login/recovery inputs identify their errors and focus the first invalid field.
  Password-length feedback is accurate; badge sign-in has its own pending state and
  restores scanner focus after failure. Credentials remain stable during submission,
  duplicate submissions are blocked, and the authentication request contracts remain
  unchanged.

## Lapper and Plant Dashboard

- Lapper machine/gearset choices, cell machines and recorded cycle values distinguish
  loading, failure and empty results and provide retries. Changing the selected
  machine/cycle clears old evidence; outstanding loads are disposed on exit. Slow
  controller reads no longer continuously cancel one another during live polling.
- Segmented selectors support arrow/Home/End keys and one tab stop. Scanner commands
  identify their group, announce pending work and block duplicate sends. Configuration
  dialogs stay open during saves. Cycle Test Lab freezes its inputs during work and
  uses the same captured input for the reviewed Argonaut request and the actual send.
- Plant Dashboard uses direct page titles, announces filtered counts, and provides
  Clear filters and a useful filtered-empty-state action. Cards and login fit narrow
  screens, and login fields stay stable while the request is pending.

## Repeatable verification

Use the pinned root Node/npm versions and preserve the existing `.env`. Run the normal
checks with `npm test`, `npm run test:contracts`, `npm run lint` and `npm run build`.
The focused shared-component browser suite is `npx nx run dana-ui:test-browser`.

For the integrated audit, run the local API on 3333 and serve the current production
frontend builds with SPA fallback and their normal `/api` proxy:

| Frontend | Local port |
| --- | --- |
| Blade Tracking | 4200 |
| Cutter Builder | 4201 |
| Greenshed | 4202 |
| Lapper | 4203 |
| Plant Dashboard | 4204 |

Provide the local administrator password through `SEED_ADMIN_PASSWORD` or
`MESHFORGE_ADMIN_PASSWORD`; `MESHFORGE_ADMIN_EMAIL` overrides `admin@example.com`.
The Nx target reads the root `.env`. `MESHFORGE_BASE_URL` can override the default
`http://127.0.0.1:3333/api/v1` and must remain a loopback API. Chromium defaults to
`/usr/bin/chromium`, overridden by `CHROMIUM_PATH`.

```sh
npx nx run manufacturing-tools:test-ui-ux-review
```

The read-only audit checks 60 route/tab states at 1920, 1024 and 390px plus four auth
states at 320px: 184 route/viewport checks. It examines document overflow, control
names, main landmarks, duplicate IDs, browser exceptions and API server failures.
Alerts are recorded for review. Interactive checks exercise drawer focus/closing, skip links,
current navigation, the mobile Admin selector and Plant filters/reports. It does not
submit inventory or configuration mutations. Results are in
`tmp/ui-ux-review/results.json`; screenshots are in `tmp/ui-ux-review/`.

## Verification record

Passed: 50 project test targets plus deployment checks, 58 lint targets, 83 source
contracts, and all seven production builds. Shared Dana UI passed 72 Chromium
assertions and four consumer/AOT checks. The final skip-link change also passed all
10 shared workflow/focus tests and affected-shell lint checks.

The integrated sweep passed all 180 desktop/tablet/phone route checks with no document
overflow, unnamed visible controls, duplicate IDs, browser exceptions or API server
failures. It caught Angular treating the initial skip link as navigation; after fixing
that behavior, a focused interaction retry passed all five interaction groups and the
four 320px authentication screens, completing 184/184 screen checks. The retry keeps
the successful layout sweep in the report and is available as
`node --env-file=.env tools/manufacturing/test-ui-ux-review.mjs --interactions-only`.
Blade Intake's scanner focus after mobile navigation was also checked in Chromium.

These are local development checks;
they do not establish production deployment, physical badge/scanner/printer behavior,
controller connectivity or exhaustive coverage of every account and data state.
