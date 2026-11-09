# Manufacturing applications

This directory belongs to the root GearApps Nx workspace. Run npm and Nx from the
repository root, using its single lockfile and shared Angular/Nest/TypeORM/Dana UI
versions. Import manufacturing libraries as @gearapps/manufacturing/....

Preserve existing manufacturing API paths, database schema, transaction locks,
authentication safeguards, and inventory rules. Use Dana UI, validate DTOs,
and keep SQL parameterized. Follow the root CLAUDE.md for dependency changes.
Run npm test, npm run test:contracts, npm run lint, and npm run build at the root.
Live database tests require a dedicated test database and
GEAR_APPS_ALLOW_TEST_ACCOUNTS=YES.
