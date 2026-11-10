import { contractPath } from '../lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..', '..', '..');
const read=(p)=>fs.readFileSync(contractPath(root,p),'utf8').replace(/^\uFEFF/,'');
const assert=(c,m)=>{if(!c) throw new Error(m);};

const workflow=read('tools/manufacturing/test-full-workflow.ps1');
const runner=read('tools/manufacturing/run-all-tests.ps1');
const fixture=read('tools/manufacturing/test-data/ensure-workflow-test-fixtures.mjs');

// PowerShell variables are case-insensitive. $greenshedShelf and
// $script:GreenshedShelf therefore collide at script scope.
assert(
  !workflow.includes('$greenshedShelf = Invoke-Api'),
  'Workflow test still overwrites the expected Green Shed shelf tag with the API response object',
);
assert(
  workflow.includes('$greenshedShelfLocation = Invoke-Api') &&
  workflow.includes("Assert-Equal $greenshedShelfLocation.serial_number $script:GreenshedShelf"),
  'Green Shed shelf assertion must compare response.serial_number to the expected tag string',
);

assert(
  fixture.includes('ensureE2EMachine') &&
  fixture.includes("machine_number: workflowMachine.machine_number"),
  'Fixture provisioner must create/reuse a dedicated E2E Green Shed machine',
);
assert(
  fixture.includes('ensureE2ECutterBody') &&
  fixture.includes('ensureE2EPart') &&
  fixture.includes('selectWorkflowPullReasons') &&
  fixture.includes('ensureAutomaticTestUser'),
  'Fixture provisioner must automatically resolve every workflow input',
);
assert(
  runner.includes('$CutterBodySerialNumber = [string]$fixture.cutter_body_serial_number') &&
  runner.includes('$MachineNumber = [string]$fixture.machine_number') &&
  runner.includes('$PartNumber = [string]$fixture.part_number') &&
  runner.includes('$PullReasonCode = [string]$fixture.teardown_reason_code'),
  'Master runner must consume all automatically provisioned workflow inputs',
);
assert(
  runner.includes("$Password = 'GearApps-E2E-Only-2026!'"),
  'Master runner must have a no-prompt dedicated E2E login',
);

console.log('[PASS] Full-workflow harness regression contract passed.');

assert(
  runner.includes('ensure-automatic-test-user.mjs') &&
  runner.includes('Automatic test-user provisioning'),
  'Master test must provision its dedicated test login before API-authenticated tests',
);


const fixturePasswordDeclaration = fixture.indexOf("const AUTO_TEST_PASSWORD = 'GearApps-E2E-Only-2026!';");
const fixtureUserFunction = fixture.indexOf('async function ensureAutomaticTestUser');
assert(
  fixturePasswordDeclaration >= 0 && fixturePasswordDeclaration < fixtureUserFunction,
  'AUTO_TEST_PASSWORD must be module-scoped before ensureAutomaticTestUser so automatic fixture provisioning cannot fail with ReferenceError',
);
