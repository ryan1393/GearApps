# Changes

## 0.3.3

Move the maintained Dana UI source into the shared root Nx library. All four applications compile the same source with root Angular 20.3.35 and consume one synchronized root vendor package. Retain the complete manufacturing compatibility styles, table cleanup, keyboard focus behavior, and configurable navigation breakpoint. Standalone dependency manifests and duplicate manufacturing UI packages are retired.

## 0.3.2

Allow applications to align `danaMobileNav` with their CSS using `desktopMinWidth`, retaining 1025 as the canonical default. GearApps explicitly binds 1024 to match its existing desktop media query.

Restore the complete GearApps 70.2.0 compatibility styles and Tailwind package paths while retaining 0.3.1 table cleanup, Escape/focus, and native-modal fixes. Canonical functional table rules use low specificity so optional Gear styles retain precedence. Build with Angular 19.2.25/ng-packagr 19.2.2/TypeScript 5.7.3 for the recovered manufacturing workspace.

Source recovery is pinned in RECOVERY_PROVENANCE.json. Public component exports are retained and verified by strict Angular 19 AOT and Chromium consumer checks.

## 0.3.1

Correct the canonical component styles and package-relative icons; retain legacy class aliases. Guard disabled combobox interactions and reposition lists during overflow scrolling. Clean up table popups/listeners and delayed initialization, retain column-header semantics, and restore filter-trigger focus on Escape. Use native confirmation dialogs with focus handling, inert backgrounds, and accessible descriptions.

Build with Angular 20.3.34/ng-packagr 20.3.2/TypeScript 5.9.3 while preserving verified Angular 19.2 compatibility. Refresh compatible transitive dependencies. Add real Angular/Chromium regression tests and strict AOT consumer checks alongside the existing source contracts.
