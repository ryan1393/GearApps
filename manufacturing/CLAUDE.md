# Recovered manufacturing workspace

This directory is the independently versioned GearApps manufacturing release.
Keep its existing @libs aliases, apps/server entry point, Angular 19/NestJS 10
configuration, and pinned dependency lock. Run its commands from this directory.
The parent Lapper workspace uses @gearapps aliases and newer frameworks; do not
replace its sources or share dependency installs implicitly. A framework/API merge
requires a separate deliberate migration.

Preserve existing manufacturing API paths and data, use Dana UI, validate DTOs,
and keep SQL parameterized. Run npm test, npm run test:contracts, and the four
production builds before changing this release. Live database tests require a
dedicated test database and GEAR_APPS_ALLOW_TEST_ACCOUNTS=YES.
