'use strict';
// Repairs authentication in an existing installation; activation and print journals are never rewritten.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const must = (ok, message) => { if (!ok) throw new Error(message); };
const tokenPattern = /^tlpa_[0-9a-f]{16}_[0-9a-f]{64}$/;
const clean = error => String(error && error.message || error || 'Unknown failure')
  .replace(/tlpa_[A-Za-z0-9_]+/g, '[redacted credential]').replace(/\b[0-9a-f]{64}\b/gi, '[redacted digest]')
  .replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 1200);
const shellQuote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";

function hiddenToken(input = process.stdin, output = process.stdout) {
  must(input.isTTY && typeof input.setRawMode === 'function', 'Use an interactive Administrator CMD window for private token input.');
  return new Promise((resolve, reject) => {
    let value = '', finished = false;
    const rawBefore = Boolean(input.isRaw);
    const done = error => {
      if (finished) return;
      finished = true;
      input.removeListener('data', onData); input.removeListener('end', onEnd); input.removeListener('error', onError);
      input.setRawMode(rawBefore); input.pause(); output.write('\n');
      if (error) { value = ''; reject(error); } else resolve(value);
    };
    const onEnd = () => done(new Error('Private input ended before a token was entered.'));
    const onError = () => done(new Error('Private input could not be read.'));
    const onData = chunk => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\x03' || ch === '\x1b') return done(new Error('Private input cancelled. No changes made.'));
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\b' || ch === '\x7f') value = value.slice(0, -1);
        else if (/[A-Za-z0-9_]/.test(ch) && value.length < 256) value += ch;
        else if (ch !== ' ' && ch !== '\t') return done(new Error('Unexpected character in private input.'));
      }
    };
    input.setRawMode(true); input.resume();
    input.on('data', onData); input.on('end', onEnd); input.on('error', onError);
    output.write('Paste the new Print Agent token here (hidden), then Enter: ');
  });
}

function serviceState(info, expectedPath) {
  must(info && info.name === 'TruckLogPrintAgent', 'The existing TruckLogPrintAgent service was not found. Use this helper only for an installed agent.');
  must(info.account === 'LocalSystem', 'The installed service must use LocalSystem. No changes made.');
  const executable = String(info.path || '').replace(/^"(.*)"$/, '$1');
  must(executable.toLowerCase() === expectedPath.toLowerCase(), 'The Windows service points to a different installation. No changes made.');
  must(['Running', 'Stopped'].includes(info.state), 'The service is changing state or paused. Wait for Running or Stopped before repairing.');
  return info.state;
}
function verified(result, config) {
  must(result && result.accepted === true && result.contract === 'truck-log-dual-gate-v1'
    && result.permissionsVerified === true && result.agentId === config.agentId,
  'The credential identity, API contract, or required permissions were not confirmed. No changes made.');
}
async function repair(d) {
  must(d.platform === 'win32', 'Run this helper on the installed Windows print host.');
  d.checkStorage();
  d.native('--admin');
  const config = d.C.validConfig(d.readConfig());
  const identity = JSON.parse(d.native('--identity'));
  must(identity.machine && identity.machine.toUpperCase() === config.hostName, 'Run this helper on the configured print host. No changes made.');
  serviceState(JSON.parse(d.native('--info')), d.hostPath);
  d.output('Selected Truck Log API: ' + config.apiBase);
  d.output('Installed agent identity: ' + config.agentId);
  const publicApi = new d.C.Api(config.apiBase, '', d.fetch);
  const routing = await publicApi.request('GET', '/print-agents/gate-routing', null, null, { auth: false });
  must(d.C.mappingMatches(routing, config), 'The server identity, gate mappings, or signing configuration differs from this installation. Check the selected server/database before repairing credentials.');
  const status = await publicApi.request('GET', '/print-agents/status', null, null, { auth: false });
  must(status && status.heartbeatResponseContract === 'truck-log-heartbeat-rows-v1' && Array.isArray(status.agents), 'The server did not return the expected Print Agent status contract. No changes made.');
  const matches = status.agents.filter(agent => agent && agent.agentId === config.agentId);
  must(matches.length === 1 && matches[0].enabled === true, 'The installed agent identity is missing or disabled on this server. Check the selected server/database or enable the existing identity before repairing. No credential was created or changed.');
  const original = d.readCredential();
  let current = d.native('--unseal', original).trim();
  must(tokenPattern.test(current), 'The stored credential could not be validated locally. No changes made.');
  let unauthorized = false;
  try { verified(await new d.C.Api(config.apiBase, current, d.fetch).request('GET', '/print-agents/setup-check'), config); }
  catch (error) {
    if (error instanceof d.C.HttpFailure && error.status === 401) unauthorized = true;
    else throw new Error('Current credential verification failed without HTTP 401. This helper will not replace credentials for a transport, TLS, permission, contract, or server failure. ' + clean(error));
  } finally { current = ''; }
  if (!unauthorized) {
    d.output('[PASS] Current credential authentication and required permissions are healthy. No files or service state changed. Check the latest heartbeat/service log if the webpage still reports offline.');
    return { changed: false };
  }
  const activation = d.activation(config);
  d.output('The current credential was rejected with HTTP 401. Create one additional key on the Linux Docker host:');
  const name = typeof matches[0].agentName === 'string' && matches[0].agentName.trim() ? matches[0].agentName : config.agentId;
  d.output('docker exec -it truck-log-server node tools/truck-log/provision-print-agent.mjs --agent-id ' + shellQuote(config.agentId) + ' --name ' + shellQuote(name));
  d.output('Run that command in a separate terminal connected to the same server. It adds a key without revoking other keys. Copy its token privately into the hidden prompt below.');
  if (config.apiBase.startsWith('http:')) d.output('This installation uses its existing acknowledged HTTP connection; the token travels over that internal connection.');
  let replacement = await d.prompt(), sealed;
  try {
    must(tokenPattern.test(replacement), 'The replacement token format is invalid. No changes made.');
    verified(await new d.C.Api(config.apiBase, replacement, d.fetch).request('GET', '/print-agents/setup-check'), config);
    sealed = d.native('--seal', replacement).trim();
    must(/^[A-Za-z0-9+/]+={0,2}$/.test(sealed), 'Windows did not return a sealed credential. No changes made.');
  } finally { replacement = ''; }
  let unlock, stage, wasRunning, attempted = false;
  try {
    unlock = d.lock();
    d.checkStorage(); d.assertUnchanged(config, original); d.activation(config);
    wasRunning = serviceState(JSON.parse(d.native('--info')), d.hostPath) === 'Running';
    if (wasRunning) { d.service('stop'); await d.waitState('Stopped'); }
    stage = d.stage(sealed);
    attempted = true;
    d.replace(stage);
    if (wasRunning) { d.service('start'); await d.waitState('Running'); }
  } catch (error) {
    const rollback = [];
    if (attempted) {
      try {
        if (serviceState(JSON.parse(d.native('--info')), d.hostPath) === 'Running') { d.service('stop'); await d.waitState('Stopped'); }
        d.restore(stage, original);
      } catch { rollback.push('credential restoration'); }
    }
    if (wasRunning !== undefined) {
      try {
        const state = serviceState(JSON.parse(d.native('--info')), d.hostPath);
        if (wasRunning && state !== 'Running') { d.service('start'); await d.waitState('Running'); }
        if (!wasRunning && state !== 'Stopped') { d.service('stop'); await d.waitState('Stopped'); }
      } catch { rollback.push('previous service state'); }
    }
    if (stage) d.cleanup(stage, rollback.length > 0);
    if (rollback.length) throw new Error('Repair failed and could not restore ' + rollback.join(' and ') + '. Sealed recovery files remain only in the protected agent data folder. Inspect the service locally. ' + clean(error));
    throw new Error('Repair did not complete. The previous credential and service state were retained or restored. ' + clean(error));
  } finally { if (unlock) unlock(); }
  d.cleanup(stage, false);
  d.output('[PASS] Replacement credential identity and permissions verified; the machine-sealed credential was replaced in place.');
  d.output(wasRunning ? 'The service was restarted. Heartbeat confirmation is pending; this does not yet confirm ONLINE or paper output.' : 'The service was already stopped and remains stopped. Heartbeat confirmation is pending until it is started normally.');
  d.output(activation.polling ? 'Existing activation, polling and print journals were preserved. No setup test pages were submitted by this helper.' : 'Existing activation and print journals were preserved. Polling remains paused; no polling file was created.');
  return { changed: true, restarted: wasRunning };
}

function safeTree(target) {
  for (let current = path.resolve(target);;) {
    if (fs.existsSync(current)) must(!fs.lstatSync(current).isSymbolicLink(), 'Refusing a linked installation path.');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
function windowsDependencies() {
  must(process.platform === 'win32', 'Run this helper on the Windows print host.');
  must(process.argv.length === 2, 'This helper accepts no arguments. Enter the token only in its private prompt.');
  const root = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Dana', 'TruckLogPrintAgent');
  const data = path.join(root, 'data'), credential = path.join(data, 'credential.dpapi');
  const hostPath = path.join(root, 'TruckLogPrintAgent.exe');
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
  function run(executable, args, input = '') {
    try { return execFileSync(executable, args, { input, encoding: 'utf8', windowsHide: true, timeout: 80000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { throw new Error('Windows operation failed: ' + path.basename(executable) + ' ' + (args[0] || '') + '. No credential content is logged.'); }
  }
  function powershell(source) {
    return run(path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop'; " + source, 'utf16le').toString('base64')]);
  }
  function checkStorage() {
    safeTree(root); safeTree(data);
    for (const file of [credential, hostPath, path.join(root, 'core.cjs'), path.join(root, 'config.json'), path.join(root, 'manifest.json')]) {
      safeTree(file); must(fs.lstatSync(file).isFile(), 'A required installed agent file is missing or invalid.');
    }
    // DPAPI LocalMachine alone is not an ACL: sealed credentials remain private to SYSTEM/Administrators.
    powershell(`foreach ($p in @(${[root, data, credential].map(literal).join(',')})) {
      $acl=Get-Acl -LiteralPath $p;
      $owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;
      if ($owner -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Unexpected owner' };
      foreach ($r in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) {
        if ($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Broad agent permissions' }
      }
    }`);
  }
  checkStorage();
  const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const configFile = path.join(root, 'config.json');
  const configBytes = fs.readFileSync(configFile);
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const manifest = readJson(path.join(root, 'manifest.json'));
  for (const file of ['core.cjs', 'config.json', 'TruckLogPrintAgent.exe']) must(manifest.hashes && manifest.hashes[file] === sha(fs.readFileSync(path.join(root, file))), 'Installed file hash mismatch: ' + file + '. Repair installation integrity first.');
  const C = require(path.join(root, 'core.cjs'));
  const native = (operation, input = '') => run(hostPath, [operation], input);
  return {
    platform: process.platform, C, hostPath, native, checkStorage, fetch: global.fetch, output: console.log,
    readConfig: () => JSON.parse(configBytes.toString('utf8')),
    readCredential: () => fs.readFileSync(credential, 'utf8'),
    prompt: () => hiddenToken(),
    activation(config) {
      const activationFile = path.join(data, 'activation.json'); safeTree(activationFile);
      let value; try { value = readJson(activationFile); } catch { throw new Error('Existing physical gate activation is missing. Credential repair will not restart an unactivated installation or trigger setup test pages.'); }
      must(value.installId === config.installId && value.eastConfirmed === true && value.westConfirmed === true, 'The existing physical gate activation does not match this installation. No changes made.');
      const pollingFile = path.join(data, 'enable-polling.json'); safeTree(pollingFile);
      if (fs.existsSync(pollingFile)) must(readJson(pollingFile).installId === config.installId, 'The existing polling state belongs to another installation. No changes made.');
      return { polling: fs.existsSync(pollingFile) };
    },
    assertUnchanged(config, original) {
      must(fs.readFileSync(configFile).equals(configBytes) && fs.readFileSync(credential, 'utf8') === original, 'The installed configuration or credential changed during repair. No changes made.');
    },
    lock() {
      const file = path.join(data, '.credential-repair.lock');
      let fd; try { fd = fs.openSync(file, 'wx', 0o600); } catch { throw new Error('Another credential repair is active or its lock remains. No changes made.'); }
      fs.closeSync(fd); return () => { try { fs.unlinkSync(file); } catch {} };
    },
    service: operation => run(path.join(system, 'sc.exe'), [operation, 'TruckLogPrintAgent']),
    async waitState(expected) {
      const deadline = Date.now() + 75000;
      while (Date.now() < deadline) {
        const info = JSON.parse(native('--info'));
        if (info && info.state === expected) return;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('The Windows service did not reach ' + expected + '.');
    },
    stage(sealed) {
      const id = crypto.randomBytes(12).toString('hex');
      const stage = { temp: path.join(data, '.credential-repair-' + id + '.dpapi'), backup: path.join(data, '.credential-before-' + id + '.dpapi') };
      const fd = fs.openSync(stage.temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, sealed); fs.fsyncSync(fd); }
      catch (error) { fs.closeSync(fd); try { fs.unlinkSync(stage.temp); } catch {} throw error; }
      fs.closeSync(fd);
      return stage;
    },
    replace(stage) {
      // File.Replace preserves the destination's security descriptor; the temp gets the same ACL first.
      powershell(`Set-Acl -LiteralPath ${literal(stage.temp)} -AclObject (Get-Acl -LiteralPath ${literal(credential)}); [System.IO.File]::Replace(${literal(stage.temp)},${literal(credential)},${literal(stage.backup)},$false)`);
    },
    restore(stage, original) {
      if (fs.existsSync(stage.backup)) powershell(`[System.IO.File]::Replace(${literal(stage.backup)},${literal(credential)},$null,$false)`);
      must(fs.readFileSync(credential, 'utf8') === original, 'Previous sealed credential was not restored.');
    },
    cleanup(stage, preserveBackup) {
      if (!stage) return;
      for (const file of [stage.temp, ...(!preserveBackup ? [stage.backup] : [])]) {
        try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') console.log('[REVIEW] A sealed repair file remains in the protected agent data folder.'); }
      }
    },
  };
}
if (require.main === module) {
  Promise.resolve().then(() => repair(windowsDependencies())).catch(error => { console.error('[FAIL] ' + clean(error)); process.exitCode = 1; });
}
module.exports = { repair, hiddenToken, serviceState, shellQuote, windowsDependencies };
