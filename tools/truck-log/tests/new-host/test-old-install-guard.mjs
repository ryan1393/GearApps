// An older Truck Log install on the same Docker host (any Compose project) must be caught
// before Compose starts, and a stale TRUCK_LOG_RELEASE must never pick the image tag.
// Also: every PowerShell script must parse, since one syntax error breaks every .cmd.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const read = (n) => fs.readFileSync(n, 'utf8');
const compose = read('docker-compose.yml');
const manifest = JSON.parse(read('RELEASE-MANIFEST.json'));
const ps = read('tools/truck-log/compose-common.ps1');
const sh = read('tools/truck-log/compose-common.sh');
let count = 0;
const check = (ok, message) => { assert.ok(ok, message); count++; };

// Name lists match docker-compose.yml.
const containers = [...compose.matchAll(/container_name: (\S+)/g)].map((m) => m[1]).sort();
const volumes = [...manifest.persistentVolumes].sort();
const psList = (name) => [...(ps.match(new RegExp(`\\$script:${name} = @\\(([^)]*)\\)`))?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
const shList = (name) => (sh.match(new RegExp(`${name}='([^']*)'`))?.[1] ?? '').split(/\s+/).filter(Boolean).sort();
check(JSON.stringify(psList('TruckLogContainerNames')) === JSON.stringify(containers), 'PowerShell container names match docker-compose.yml');
check(JSON.stringify(shList('TRUCK_LOG_CONTAINER_NAMES')) === JSON.stringify(containers), 'shell container names match docker-compose.yml');
check(JSON.stringify(psList('TruckLogVolumeNames')) === JSON.stringify(volumes), 'PowerShell volume names match the release manifest');
check(JSON.stringify(shList('TRUCK_LOG_VOLUME_NAMES')) === JSON.stringify(volumes), 'shell volume names match the release manifest');

// The release comes from VERSION on every Compose call.
check(/\$env:TRUCK_LOG_RELEASE = Get-TruckLogRelease\s*\n\s*if \(\$script:TruckLogComposeMode -eq 'plugin'\)/.test(ps), 'PowerShell pins TRUCK_LOG_RELEASE before calling Compose');
check(/truck_log_compose\(\) \{\n[^}]*truck_log_pin_release\n/.test(sh), 'shell pins TRUCK_LOG_RELEASE before calling Compose');

// Setup and start stop on a foreign install before touching .env or Compose.
const setupPs = read('tools/truck-log/setup-docker.ps1');
const setupSh = read('SETUP-TRUCK-LOG.sh');
check(setupPs.indexOf('Assert-NoForeignTruckLogResources') > 0 && setupPs.indexOf('Assert-NoForeignTruckLogResources') < setupPs.indexOf("Write-Step 'Preparing local .env'"), 'Windows setup checks for an old install first');
check(setupSh.indexOf('truck_log_assert_no_foreign_resources') > 0 && setupSh.indexOf('truck_log_assert_no_foreign_resources') < setupSh.indexOf("log 'Preparing .env'"), 'Linux setup checks for an old install first');
check(read('tools/truck-log/compose-control.ps1').includes("if ($Action -eq 'start') { Assert-NoForeignTruckLogResources }"), 'Windows start checks for an old install');
check(read('tools/truck-log/compose-control.sh').includes('start) truck_log_assert_no_foreign_resources; truck_log_compose up -d'), 'Linux start checks for an old install');
check(/Unlabelled volumes are normal/.test(ps) && /if \(\$project -and \$project -ne 'truck-log'\)/.test(ps), 'credential volumes created outside Compose are not treated as foreign');

// Removal always asks first, and by default leaves this install's own data alone.
const removePs = read('tools/truck-log/remove-old-install.ps1');
const removeSh = read('REMOVE-OLD-TRUCK-LOG-INSTALL.sh');
check(removePs.includes("$answer -cne 'REMOVE'") && removePs.indexOf("-cne 'REMOVE'") < removePs.indexOf('docker rm -f'), 'Windows removal requires typing REMOVE before deleting');
check(removeSh.includes('[ "$answer" = REMOVE ]') && removeSh.indexOf('= REMOVE ]') < removeSh.indexOf('docker rm -f'), 'Linux removal requires typing REMOVE before deleting');
check(removePs.includes('Get-ForeignTruckLogResources') && removeSh.includes('truck_log_foreign_resources'), 'removal defaults to the other install only');
check(read('REMOVE-OLD-TRUCK-LOG-INSTALL.cmd').includes('tools\\truck-log\\remove-old-install.ps1'), 'Windows wrapper runs the removal script');
check(!/volume rm|docker rm/.test(setupPs) && !/volume rm|docker rm/.test(setupSh), 'setup itself never deletes containers or volumes');

// PowerShell: "$name:" inside a double-quoted string is a parse error ("$code: failed" broke every .cmd in 0.1).
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', 'dist', '.git', '.nx'].includes(e.name)) return [];
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : e.name.endsWith('.ps1') ? [full] : [];
  });
}
const scripts = walk('.');
const badVariable = /"[^"\n]*(?<!\$\{)\$(?!env:|script:|global:|local:|using:|private:)[A-Za-z_][A-Za-z0-9_]*:(?![A-Za-z0-9_:])[^"\n]*"/;
for (const file of scripts) {
  const bad = read(file).split('\n').findIndex((line) => !line.trimStart().startsWith('#') && badVariable.test(line));
  check(bad < 0, `${file}:${bad + 1} uses "$name:" in a string; write "\${name}:"`);
}
// Windows PowerShell 5.1 turns a native command's redirected stderr into a terminating
// error when $ErrorActionPreference is Stop ("docker container inspect x *> $null" killed
// REMOVE-OLD-TRUCK-LOG-INSTALL). Every redirected native call runs with a local Continue.
const redirect = /(\*> ?\$null|2> ?\$null|2>&1)/;
for (const file of scripts) {
  const lines = read(file).split('\n');
  const unwrapped = [];
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('#') || !redirect.test(line)) return;
    let start = i;
    while (start > 0 && lines[start - 1].trimEnd().endsWith('`')) start--;
    if (!lines[start].includes("$ErrorActionPreference = 'Continue'")) unwrapped.push(i + 1);
  });
  check(unwrapped.length === 0, `${file}: redirected native calls without a local Continue preference at lines ${unwrapped.join(', ')}`);
}
// Assigning to an automatic variable silently breaks later code ($matches = @() then
// -match turned it into a hashtable: "A hash table can only be added to another hash table").
const automatic = /^\s*\$(matches|input|args|error|host|pid|home|this|psitem|event|sender)\s*\+?=(?!=)/im;
for (const file of scripts) {
  const bad = read(file).split('\n').findIndex((line) => automatic.test(line));
  check(bad < 0, `${file}:${bad + 1} assigns to a PowerShell automatic variable`);
}
const pwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' });
if (pwsh.status === 0) {
  const list = scripts.map((f) => `'${path.resolve(f).replace(/'/g, "''")}'`).join(',');
  const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command',
    `$bad=0; foreach ($f in @(${list})) { $e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($f,[ref]$null,[ref]$e); foreach ($x in @($e)) { if ($x) { "\${f}:$($x.Extent.StartLineNumber) $($x.Message)"; $bad++ } } }; exit $bad`], { encoding: 'utf8' });
  check(result.status === 0, `PowerShell parse errors:\n${result.stdout}${result.stderr}`);
} else {
  console.log('[SKIP] pwsh not installed; PowerShell parser check skipped (string check still ran).');
}

console.log(`[PASS] Old-install guard: ${count} checks, ${scripts.length} PowerShell scripts.`);
