import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const must = (ok, msg) => { if (!ok) throw new Error(msg); };

const packager = read('tools/package-dana-apps-source.ps1');
const routes = read('libs/frontend/feature-cutter-builder/src/lib/cutter-builder.routes.ts');
const runner = read('tools/run-all-tests.ps1');
const buildTs = 'libs/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.ts';
const buildHtml = 'libs/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.html';

must(fs.existsSync(buildTs), `Live Cutter Builder source missing ${buildTs}`);
must(fs.existsSync(buildHtml), `Live Cutter Builder source missing ${buildHtml}`);
must(routes.includes("./pages/build/cutter-build.component"), 'Cutter Builder build route no longer references the protected build page.');
must(packager.includes('$ExcludedRootPaths'), 'Source packager does not use root-only Robocopy exclusions.');
must(!packager.includes(') + $ExcludedDirectories + @('), 'Source packager still has bare-name Robocopy /XD exclusions.');
must(packager.includes('Assert-StagedSourceCompleteness'), 'Source packager is missing staged-source completeness validation.');
must(packager.includes(buildTs), 'Source packager does not explicitly protect Cutter Builder nested build-page source.');
must(runner.includes('test-dana-apps-source-package-completeness-contract.mjs'), 'Authoritative Gear runner does not include source-package completeness contract.');
must(runner.includes("Add-MasterResult 'Dana Apps source package completeness contract' 'PASS'"), 'Authoritative Gear runner does not record source-package completeness PASS status.');

console.log('[PASS] Dana Apps source package completeness contract: root-only exclusions and staged inventory preserve legitimate nested build source.');
