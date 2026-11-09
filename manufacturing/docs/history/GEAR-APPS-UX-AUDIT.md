# Gear Apps — Whole UX Audit

**Audit date:** 2026-08-25  
**Source audited:** latest cumulative working tree used for the UI Body Depth pass (`gear_body_polish_full`)  
**Scope:** Blade Tracking, Cutter Builder, Greenshed, Admin, shared shell/design system, login, scan-first workflows, loading/error/success/empty states, responsive behavior, accessibility, and workflow state safety.

## Executive summary

The current UI architecture is strong: shared styling is centralized, the sidebar/topbar shell is consistent, page hierarchy is much more coherent after the design-system and body-depth passes, and the existing static UI contracts all pass. The biggest remaining UX risks are **behavioral**, not cosmetic.

The highest-priority issues are:

1. **Responsive navigation is functionally incomplete below 1024px.** The sidebar and topbar are both hidden, while the hamburger control has no working menu behavior.
2. **Several scan/workflow pages can retain stale downstream state when the operator changes the upstream scanned object.** This is most important in Greenshed Setup, Quality Check, Cutter Pull, and Cutter Builder teardown/build.
3. **Load Coater Container “Finish” does not actually finish/reset the loading session.** It only displays a success message and leaves the same container active.
4. **Find Inventory does not answer enough of the physical-location question.** Tray results do not show current location/container, container results do not show loaded trays, and location results do not show current trays/blades.
5. **Scan-first focus progression is inconsistent.** Shared scan inputs are not guaranteed to autofocus on initial entry, and Blade Intake returns focus to the tray scanner even when the operator’s next job is Summary/Part Type/quantity entry.
6. **Greenshed Lookup can become stuck busy if the nested history request fails.** The history request lacks an error handler.

## Existing regression status

The latest source passes the current static UI contracts, including:

- shared UI style source
- duplicate CSS budget
- global professional UI
- UI consistency
- deep UI route/template scan
- no raw/debug frontend UI across 128 Angular HTML/TS files
- Inventory Lookup
- Inventory Control Center
- Blade Locations/Admin Locations
- Scrap/Discarded Blade history
- UI body-depth contract
- Admin management UI

These passing tests are valuable, but they currently do not detect the workflow-state, focus, responsive-menu, or feedback issues described below.

---

# Priority 0 — Fix before shop-floor acceptance

## 1. Responsive navigation / dead hamburger

### Current behavior

The shared navigation CSS hides both `.gear-sidebar` and `.gear-topbar` below the `1024px` breakpoint. The hamburger/menu button lives inside the topbar and has no functional click handler in the current app navigation components.

### Risk

At narrower browser widths or devices, the primary navigation disappears entirely. The visible hamburger on larger screens is also a dead control.

### Recommended fix

- Keep the topbar visible at small widths.
- Convert the sidebar into a real mobile/off-canvas drawer below 1024px.
- Wire the hamburger to open/close it.
- Add overlay/click-away/Escape behavior.
- Preserve desktop sidebar/topbar appearance exactly.
- Add a focused regression contract so a menu button cannot exist without behavior and mobile navigation cannot be hidden entirely.

---

## 2. Stale workflow state when upstream scan changes

This is the biggest operator-safety UX theme found in the audit.

### Greenshed — Machine Setup

A new cutter build can be scanned while an old part remains selected. A mismatched scanned part is still retained/displayed even after the mismatch error. The final Setup button does not require a currently validated `part` object; the backend is expected to reject bad combinations, but the UI can knowingly carry invalid state to the final action.

**Fix:** scanning/changing the cutter build should clear downstream part/machine validation. A mismatched part should not remain accepted as the selected part. Final Setup should require a validated matching part and validated compatible machine.

### Greenshed — Quality Check

After saving a check, result/comments/check type remain in the form. Scanning another build resets piece count but does not reset the previous result/comments/check type. A prior `FAIL`, `HOLD`, or old comments could accidentally be carried into the next cutter.

**Fix:** use an explicit `resetCheckEntry()` when changing builds and after successful save. Preserve only the intentionally requested query-param check type when applicable; reset result to the normal default and clear comments.

### Greenshed — Cutter Pull

Scanning another cutter build does not clear a previously selected shelf. Changing pull reason can also leave an old shelf selected even when the new reason no longer needs it.

**Fix:** clear/revalidate shelf whenever build or reason changes.

### Cutter Builder — Build

Changing the cutter body after selecting a tray can leave the previous tray selected, and vice versa. The backend should protect compatibility, but the UI should not let stale paired selections survive without revalidation.

**Fix:** upstream scan changes should clear or immediately revalidate downstream selections.

### Cutter Builder — Teardown

Changing the selected build can leave an old empty tray, shelf, scrap quantity, and comments in the form.

**Fix:** scanning a new build should clear all teardown-specific downstream state.

---

## 3. Load Coater Container “Finish” is not a real finish action

### Current behavior

`Finish Loading Container` only changes the success message to indicate the container is ready. It does not clear the selected container or current tray session. The operator can continue scanning additional trays into the same session after pressing Finish.

### Risk

The UI communicates a completed transaction while keeping the workflow open.

### Recommended fix

Without inventing a new shipping state model yet:

- Rename/clarify the action around the current active-assignment model.
- On Finish, clear the session and return focus to `Scan Container`.
- Show a clear completed summary before reset, or use a completion panel with `Start Another Container`.
- If a true “shipped/at coater” event is later required, implement that as a separate domain-state change rather than pretending the current assignment is that event.

---

## 4. Find Inventory should answer “where is it?” immediately

### Current behavior

- Tray result: does not prominently show active location/container.
- Container result: does not show trays currently loaded.
- Location result: does not show trays/blades currently assigned there.

### Recommended fix

Reuse the same active relationship data already used by Inventory Control Center and Blade Locations:

- Tray → current location or container + blade count/details.
- Container → loaded trays + represented blade count.
- Location → current trays + blade count, with optional expansion.

This keeps Find Inventory as the fast scan-first answer, while Inventory Control Center remains the broad browsing/reporting surface.

---

## 5. Scan-first focus behavior is inconsistent

### Shared Scan Panel

The component exposes focus helpers but does not guarantee initial autofocus after the view is ready.

### Blade Intake

After a tray scan, focus returns to the tray scanner even when the operator’s next step is Summary, Part Type, and quantity entry.

### Recommended fix

Define a Gear Apps scan UX standard:

- Initial scan field receives focus when a scan-first page opens.
- Successful scan moves focus to the next required operator action.
- Validation failure keeps/returns focus to the failing field and selects its content when appropriate.
- Successful completion returns focus to the first field of the next transaction.
- Do not steal focus from an operator who is actively editing another field.

---

## 6. Greenshed Lookup nested history error can leave the page stuck

The build-detail request is followed by a history request. The history subscription currently has no error handler. If history fails, `busy` can remain true and the user receives no useful error.

**Fix:** add history error/finalize handling so loading always terminates and an actionable message is shown. The build detail can remain visible even if history fails.

---

# Priority 1 — High-value usability improvements

## 7. Internal Movement confirmation should identify the tray

The final confirmation currently emphasizes FROM and TO but does not prominently repeat:

- tray serial
- Summary
- Part Type
- blade count/stage

For a high-frequency physical move, the final confirmation should show **what is moving** as clearly as where it is moving.

---

## 8. Post-action next steps are weak in several workflows

After successful Greenshed Setup, Quality Check, and Pull, the page largely stops at a success result.

Add explicit next actions such as:

- `Setup Another`
- `Record Next Check`
- `Pull Another`
- `Running Machines`
- `Available Cutters`
- `Go to Cutter Builder` when relevant

These should reset state safely before starting another transaction.

---

## 9. Loading / submit locking is inconsistent

Login currently does not expose a clear submitting state and does not disable the Sign In button while the request is running.

The same principle should be reviewed across operator actions:

- disable primary commit action while request is in flight
- show concise `Saving…`, `Setting up…`, `Moving…`, etc.
- prevent accidental double submission

---

## 10. Accessibility and feedback semantics need a systematic pass

A static scan found multiple scan/search/select controls without explicit label association or `aria-label`, including global search fields and several operational scanners.

Most success/error feedback is visual only. Login is the notable page already using alert semantics.

### Recommended standard

- Every input/select has a programmatic label.
- Errors use `role="alert"` or appropriate assertive live region.
- Success/status messages use a polite live region.
- Expand/collapse buttons expose `aria-expanded`.
- Tab-like controls use tab semantics or simple buttons with clear selected state.
- Add shared `:focus-visible` styling for buttons/links, not only form fields.
- Keep touch targets approximately 44px for shop-floor/tablet use; Admin tabs currently deserve review here.

---

## 11. Inventory Control Center needs in-view filtering

The page is structurally good, but with 300 trays and potentially large blade history/current inventory, switching to a view and paging without a local filter will get cumbersome.

Recommended per-view search/filter:

- Trays: tray, Summary, Part Type, stage, location/container.
- Containers: container, tray.
- Locations: barcode/number/description/department/type/tray.
- Blades: serial, Summary, Part Type, status, tray.

Keep Find Inventory as the fast scanner workflow; this filter is for browsing the currently selected inventory domain.

---

## 12. Admin needs scale-oriented list UX

Locations has search, but other Admin datasets can become tedious as they grow.

Recommended:

- search/filter on Users, Part Summaries, Parts, Models, Machines, Cutter Bodies
- local/sticky result feedback so Save errors/success remain visible when scrolled down
- confirmation before disabling a location/master record; enabling can remain quick
- preserve backend occupancy checks as authoritative

---

# Priority 2 — Consistency / polish

## 13. Naming consistency

The sidebar still uses wording such as `All Inventory` while the actual page is `Inventory Control Center`.

Standardize the operator-visible name to one term everywhere.

---

## 14. Topbar global search should be contextual

The same generic `Scan or search…` appears across apps, but each app has different useful entities.

Suggested placeholders:

- Blade Tracking: `Scan tray, container, location, or blade…`
- Cutter Builder: `Search build, cutter body, Summary…`
- Greenshed: `Search build, machine, cutter body…`

If the control is not actually functional global search yet, it should not look like a fully working search box; either wire it or present it as a disabled/future surface.

---

## 15. “System Online” is currently visually authoritative but static

The sidebar footer presents `System Online` even though it is not driven by API/database health.

Either:

- connect it to `/api/v1/health`, with degraded/offline states, or
- change the footer to non-status branding so it cannot falsely report health.

---

## 16. Hard-coded filter lists can drift from DB-backed master data

Some lookup screens still hard-code business status/part-type filter options. The project’s design intent is database-backed business/master values.

This is not an urgent operator bug, but these filters should eventually come from reference/master endpoints so the UI cannot drift from the backend.

---

# Page-by-page snapshot

## Blade Tracking

**Strong:** Dashboard, Locations, Scrap/Discarded, Inventory Control Center overall structure; relationship drilldowns are useful.  
**Needs work:** Internal Movement confirmation identity, Load Container finish semantics, Find Inventory relationship detail, Intake focus/mode clarity, inventory filters.

## Cutter Builder

**Strong:** Build/teardown overall guided flow and current empty-tray business logic.  
**Needs work:** clear/revalidate downstream state when the body/build/tray changes; strengthen scan focus and accessible labels.

## Greenshed

**Strong:** Running Machines task board and available-cutter dashboard concepts.  
**Needs work most:** Setup validation state, Check reset state, Pull shelf state, Lookup loading/error/empty states, clearer post-action next steps.

## Admin

**Strong:** centralized management surface, shared API service, Locations safety rules.  
**Needs work:** search at scale, local feedback visibility, disable confirmations, accessibility semantics.

## Login

**Strong:** clear labels and generic credential-error policy.  
**Needs work:** submitting state/double-submit protection.

---

# Recommended next implementation pass

Instead of another visual-only pass, the next patch should be a **Gear Apps UX Hardening Pass** with three focused contracts:

1. `test-ux-responsive-navigation-contract.mjs`
2. `test-ux-workflow-state-contract.mjs`
3. `test-ux-accessibility-feedback-contract.mjs`

Recommended first patch scope:

1. functional responsive menu while preserving desktop shell
2. stale-state clearing/revalidation in Greenshed + Cutter Builder workflows
3. scan autofocus/focus progression standard
4. Load Container real session completion/reset
5. Find Inventory relationship enrichment
6. Greenshed Lookup history error/finalize fix
7. accessible labels/live feedback/focus-visible baseline
8. commit/loading button locking where missing

Then follow with scale/polish items: inventory filters, Admin searches, next-action CTAs, contextual global search, live health indicator.

---

# Production acceptance note

This audit is source/static-UX based. It does not replace real shop-floor acceptance with scanners, gloves, production monitors/tablets, realistic latency, or operators moving through repeated transactions. Those should remain a separate acceptance step after the UX hardening changes.

## Post-audit build-gate correction — UX Hardening V4

The target Windows Nx build caught an Angular `NG5002` error in the Greenshed Pull result/reset markup: one extra closing `</div>` remained in `greenshed-pull.component.html`. The markup has been corrected. A new dependency-free `tools/test-angular-template-structure-contract.mjs` now scans production Angular templates for balanced element tags before Nx compilation so this class of packaging error is caught earlier.

## Resolved follow-up — physical location identity

A post-audit shop-floor check found that Internal Movement and Tray Contents could display `locations.number` where the operator expected the actual shelf tag. Summary-derived shelves use `locations.number` as a normalized Summary/reference key, so the UI could show `1.955FC` instead of `CGDR-1.955FC`.

The corrected UX standard is: physical placement always displays `locations.serial_number`; `locations.number` is only shown as explicitly labeled master/reference metadata or used for Summary validation. A dedicated `test-location-identity-display-contract.mjs` regression now protects this distinction.


## Resolved follow-up — parent/child inventory drilldown

A later operator review clarified that inventory parent records should expose their real children in-place whenever the relationship directly answers the current task.

Blade Tracking now follows these drilldown chains:

```text
Tray -> Blade -> Blade History
Container -> Tray -> Blade
Location -> Tray -> Blade
```

Tray Contents now lists every active blade in the scanned tray and provides `View history` using the existing blade lifecycle history API. Container payloads now include the active blades assigned to each contained tray, allowing Find Inventory and Inventory Control Center to expose the full hierarchy. Blade Locations retains its existing Location -> Tray -> Blade expansion.

Regression: `tools/test-parent-child-drilldown-contract.mjs`.

## Parent/child drilldown style compliance follow-up — resolved

The parent/child drilldown implementation was held before installation for a second style-format audit. The first draft exposed the correct relationships but mixed shared design-system classes with page-local Tailwind card strings and reused `blade-location-*` classes in Inventory Control Center.

The cleaned implementation now uses the shared `inventory-child-*` vocabulary from `features/inventory-relations.css` for generic Tray/Container/Location child surfaces. Tray Contents uses a shared Gear Apps panel/table treatment and the existing `scrap-history-*` timeline for Blade → History. Inventory Control Center no longer borrows Blade-Locations-specific class names for generic container/location child trays.

The parent/child regression now checks both behavior and design-system compliance. This issue is resolved in the cleaned replacement patch and should not be reintroduced with page-local child-card styling.

## Resolved follow-up — shop-floor readability and child-row containment

An operator screenshot after the parent/child drilldown rollout showed blade child rows visually exceeding the width of their tray card. The cause was a three-column grid with fixed minimum track widths combined with very small 8px child text. Long mock/production blade serials could force the child row wider than its parent.

The shared parent/child CSS now uses zero-minimum grid tracks, explicit width containment, safe identifier wrapping, larger 11/12px child text, and roomier row/card spacing. A broader body readability scale (11/12/14/16px) also raises undersized operational text while leaving the established sidebar/topbar shell unchanged.

Regression: `tools/test-shop-floor-readability-contract.mjs`.

## Resolved follow-up — large-monitor proportionate scale

Blade Locations remained visually undersized on a full-size monitor even after the first large-screen body pass. A follow-up operator review also requested a modest increase to the sidebar/topbar so the shell and body would feel proportionate rather than leaving navigation visually smaller than the enlarged content.

The 1500px+ layer now uses a 13/15/17/20px body scale, larger table/control/KPI/drilldown spacing, a page width ceiling of 1840px, a 296px desktop sidebar, and a 76px topbar. Sidebar links, global search, avatar/user text, and shell controls scale slightly at the same breakpoint. Normal laptop/narrow-display sizing and mobile drawer behavior are preserved.

Regression: `tools/test-large-screen-readability-contract.mjs`.


## Sidebar hierarchy cleanup

The app shell now follows the simpler Truck Log-style information hierarchy: the brand area carries the app identity, and each operational app exposes one combined dashboard navigation row (`Blade Dashboard`, `Cutter Dashboard`, or `Greenshed Dashboard`) before its action groups. The previous duplicate app-name row + WORKSPACE/Dashboard row was removed.
## Branding follow-up

The shell brand mark is standardized on the Dana Diamond across Blade Tracking, Cutter Builder, and Greenshed. The mark is local inline SVG and does not rely on a live Dana.com asset. The prior `GA` placeholder is retired.

