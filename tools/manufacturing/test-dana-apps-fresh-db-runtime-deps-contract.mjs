import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(contractPath(process.cwd(), p), 'utf8');
const must = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const seed = read('libs/manufacturing/server/data-access/src/lib/database/seeds/users.database-seed.ts');
const bootstrap = read('apps/server/src/fresh-db-bootstrap.ts');
const dockerfile = read('apps/server/Dockerfile');
const pkg = JSON.parse(read('package.json'));
const runner = read('tools/manufacturing/run-all-tests.ps1');

must(
  !seed.includes("@ngneat/falso"),
  'Production UserDatabaseSeedService must not import dev-only @ngneat/falso.'
);
must(
  seed.includes("from 'node:crypto'"),
  'Production UserDatabaseSeedService must use Node runtime crypto for fallback random values.'
);
must(
  seed.includes('createRandomPassword'),
  'Production UserDatabaseSeedService is missing its runtime-safe password helper.'
);
must(
  seed.includes('populateRandomUsers'),
  'Development/test random-user helper must remain available.'
);

must(
  bootstrap.includes('UserDatabaseSeedService'),
  'Fresh DB bootstrap no longer uses the maintained user seed service.'
);
must(
  bootstrap.includes("DANA_FRESH_DB_BOOTSTRAP"),
  'Fresh DB bootstrap guard is missing.'
);

must(
  pkg.devDependencies?.['@ngneat/falso'],
  '@ngneat/falso should remain a devDependency for tests that still use it.'
);
must(
  !pkg.dependencies?.['@ngneat/falso'],
  '@ngneat/falso must not be promoted to a production dependency.'
);

must(
  dockerfile.includes("npm ci --omit=dev"),
  'Runtime dependency image must continue installing production dependencies only.'
);
must(
  dockerfile.includes(".includes('@ngneat/falso')"),
  'Docker build is missing the bootstrap-bundle dev-dependency regression guard.'
);
must(
  dockerfile.includes('Fresh DB bootstrap') && dockerfile.includes('test-only falso'),
  'Docker build is missing the positive fresh-bootstrap dependency audit marker.'
);

must(
  runner.includes('test-dana-apps-fresh-db-runtime-deps-contract.mjs'),
  'Authoritative Gear runner does not include the fresh DB runtime dependency contract.'
);
must(
  runner.includes("Add-MasterResult 'Dana Apps fresh DB runtime dependencies contract' 'PASS'"),
  'Authoritative Gear runner does not record the fresh DB runtime dependency PASS result.'
);

console.log(
  '[PASS] Dana Apps fresh DB runtime dependencies contract: production seed/bootstrap path has no dev-only falso dependency and Docker runtime remains production-deps-only.'
);
