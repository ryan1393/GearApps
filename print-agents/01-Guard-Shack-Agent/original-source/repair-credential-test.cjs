'use strict';
// No Windows, printer, network, database, credential-store or service side effects.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { repair, hiddenToken, shellQuote } = require('./repair-credential.cjs');
const C = require('./core.cjs');
const oldToken = 'tlpa_' + '1'.repeat(16) + '_' + '2'.repeat(64);
const newToken = 'tlpa_' + '3'.repeat(16) + '_' + '4'.repeat(64);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
function fixture(options = {}) {
  const config = { agentVersion: '4.0.6-service', apiBase: 'https://trucklog.example/api/v1', agentId: 'guardWindows',
    route: 'RXO_DRIVER_DOCUMENT', hostName: 'USFTWLDAPP', installId: 'b228ff77-c7fa-4d78-bfc6-9ac7f83b3f41',
    printers: [{ gate: 'EAST', printer: 'East printer', sourceQueue: 'East' }, { gate: 'WEST', printer: 'West printer', sourceQueue: 'West' }] };
  const hostPath = 'C:\\ProgramData\\Dana\\TruckLogPrintAgent\\TruckLogPrintAgent.exe';
  const operations = [], messages = [], requests = [];
  const originals = { config: JSON.stringify(config), activation: { installId: config.installId, eastConfirmed: true, westConfirmed: true },
    jobs: 'sealed pending job', outbox: 'sealed unsent result', journal: 'sealed review', polling: options.polling === false ? undefined : { installId: config.installId } };
  const snapshot = JSON.stringify(originals);
  let state = options.stopped ? 'Stopped' : 'Running', credential = 'OLD-SEALED', backup, prompts = 0, failedStart = false, changed = false;
  const d = {
    platform: 'win32', C, hostPath,
    checkStorage() { operations.push('storage'); if (options.aclFailure) throw new Error('Unsafe ACL'); },
    native(operation, input) {
      operations.push(operation);
      if (operation === '--admin') { if (options.notAdmin) throw new Error('Administrator required'); return ''; }
      if (operation === '--identity') return JSON.stringify({ machine: 'USFTWLDAPP' });
      if (operation === '--info') return JSON.stringify({ name: 'TruckLogPrintAgent', state, account: 'LocalSystem', path: '"' + hostPath + '"' });
      if (operation === '--unseal') { assert.equal(input, 'OLD-SEALED'); return oldToken; }
      if (operation === '--seal') { assert.equal(input, newToken); return 'AQIDBA=='; }
      throw new Error('Unexpected native action');
    },
    readConfig: () => JSON.parse(originals.config), readCredential: () => credential,
    output: message => messages.push(message),
    async fetch(url, init) {
      const route = new URL(url).pathname;
      requests.push({ route, method: init.method, auth: init.headers.Authorization });
      let body;
      if (route.endsWith('/gate-routing')) body = { contract: 'truck-log-dual-gate-v1', claimUsesAdvertisedPrinters: true, frozenPrinterRequired: true,
        configurationValid: true, agentId: options.wrongRouting ? 'otherAgent' : config.agentId, route: config.route,
        gates: config.printers.map(p => ({ gate: p.gate, printer: p.printer, configured: true })) };
      else if (route.endsWith('/status')) body = { heartbeatResponseContract: 'truck-log-heartbeat-rows-v1', agents: options.missingAgent ? [] : [
        { agentId: config.agentId, agentName: "Guard's $(echo private) Print Agent", enabled: !options.disabledAgent, status: 'OFFLINE' }] };
      else if (route.endsWith('/setup-check')) {
        const isOld = init.headers.Authorization === 'Bearer ' + oldToken;
        if (isOld && !options.healthy) {
          if (options.transportFailure) throw new Error('network failure');
          return new Response('{}', { status: options.oldStatus || 401, headers: { 'content-type': 'application/json' } });
        }
        if (!isOld && options.replacementRejected) return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
        body = { accepted: true, permissionsVerified: !options.missingPermissions, contract: options.wrongContract ? 'other-v1' : 'truck-log-dual-gate-v1', agentId: options.wrongTokenIdentity ? 'otherAgent' : config.agentId };
      } else throw new Error('Unexpected API path');
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    },
    activation() { operations.push('activation'); if (options.noActivation) throw new Error('Activation missing'); return { polling: !!originals.polling }; },
    prompt: async () => { prompts++; return options.invalidToken ? 'bad-token' : newToken; },
    assertUnchanged() { operations.push('unchanged'); if (options.concurrentChange) throw new Error('Concurrent credential change'); },
    lock() { operations.push('lock'); return () => operations.push('unlock'); },
    service(action) {
      operations.push(action);
      if (action === 'stop') state = 'Stopped';
      if (action === 'start') {
        if (options.restartFailure && !failedStart) { failedStart = true; throw new Error('Start failed'); }
        state = 'Running';
      }
    },
    async waitState(expected) { assert.equal(state, expected); operations.push('wait-' + expected); },
    stage(sealed) { operations.push('stage'); assert.equal(sealed, 'AQIDBA=='); return { sealed }; },
    replace(stage) {
      operations.push('replace'); backup = credential; credential = stage.sealed; changed = true;
      if (options.replaceFailure) throw new Error('Replace reported failure after publication');
    },
    restore() { operations.push('restore'); if (options.rollbackFailure) throw new Error('Restore failed'); credential = backup; changed = false; },
    cleanup(stage, preserve) { operations.push('cleanup-' + preserve); },
  };
  return { d, operations, requests, messages, snapshot, originals,
    get state() { return state; }, get credential() { return credential; }, get prompts() { return prompts; }, get changed() { return changed; } };
}
function untouched(f) {
  assert.equal(JSON.stringify(f.originals), f.snapshot);
  assert.equal(f.credential, 'OLD-SEALED');
  assert.equal(f.operations.some(op => ['stop', 'start', 'stage', 'replace'].includes(op)), false);
}
function noSecretOutput(f) {
  assert(!f.messages.join('\n').includes(oldToken)); assert(!f.messages.join('\n').includes(newToken));
}
test('HTTP401 then privately verified replacement changes only the sealed credential and restores Running', async () => {
  const f = fixture(); const result = await repair(f.d);
  assert.deepEqual(result, { changed: true, restarted: true });
  assert.equal(f.credential, 'AQIDBA=='); assert.equal(f.state, 'Running'); assert.equal(f.prompts, 1);
  assert.equal(JSON.stringify(f.originals), f.snapshot);
  assert(f.operations.indexOf('--seal') < f.operations.indexOf('stop'));
  assert(f.operations.indexOf('stop') < f.operations.indexOf('replace'));
  assert(f.operations.indexOf('replace') < f.operations.indexOf('start'));
  assert.match(f.messages.join('\n'), /Heartbeat confirmation is pending/);
  assert.doesNotMatch(f.messages.join('\n'), /confirmed ONLINE|is ONLINE|--rotate/);
  assert(f.requests.every(r => r.method === 'GET'));
  assert(f.requests.filter(r => !r.route.endsWith('setup-check')).every(r => !r.auth));
  noSecretOutput(f);
});
test('A healthy current credential causes no prompt, service action or file change', async () => {
  const f = fixture({ healthy: true }); assert.deepEqual(await repair(f.d), { changed: false });
  assert.equal(f.prompts, 0); untouched(f); assert.match(f.messages.join('\n'), /authentication and required permissions are healthy/); noSecretOutput(f);
});
for (const [name, options] of [
  ['missing identity', { missingAgent: true }], ['disabled identity', { disabledAgent: true }], ['wrong routing identity', { wrongRouting: true }],
  ['HTTP403', { oldStatus: 403 }], ['HTTP500', { oldStatus: 500 }], ['transport failure', { transportFailure: true }],
  ['unsafe ACL', { aclFailure: true }], ['nonadministrator', { notAdmin: true }], ['incomplete physical activation', { noActivation: true }],
]) test(name + ' cannot trigger replacement or stop the service', async () => {
  const f = fixture(options); await assert.rejects(repair(f.d)); assert.equal(f.prompts, 0); untouched(f); noSecretOutput(f);
});
for (const [name, options] of [
  ['invalid token', { invalidToken: true }], ['rejected replacement', { replacementRejected: true }],
  ['mismatched credential identity', { wrongTokenIdentity: true }], ['unverified permissions', { missingPermissions: true }], ['wrong API contract', { wrongContract: true }],
]) test(name + ' fails before stopping or writing', async () => {
  const f = fixture(options); await assert.rejects(repair(f.d)); untouched(f); noSecretOutput(f);
});
test('A paused polling configuration remains absent and an already stopped service stays stopped', async () => {
  const f = fixture({ stopped: true, polling: false }); const result = await repair(f.d);
  assert.equal(result.restarted, false); assert.equal(f.state, 'Stopped');
  assert.equal(f.originals.polling, undefined); assert.equal(JSON.stringify(f.originals), f.snapshot);
  assert(!f.operations.includes('start')); assert(!f.operations.includes('stop'));
  assert.match(f.messages.join('\n'), /Polling remains paused/);
});
for (const options of [{ replaceFailure: true }, { restartFailure: true }]) test('Replacement/start failure restores old sealed credential and original Running state', async () => {
  const f = fixture(options); await assert.rejects(repair(f.d), /retained or restored/);
  assert.equal(f.credential, 'OLD-SEALED'); assert.equal(f.state, 'Running'); assert(f.operations.includes('restore'));
  assert.equal(JSON.stringify(f.originals), f.snapshot); assert(f.operations.includes('unlock')); noSecretOutput(f);
});
test('Failure during a stopped installation repair leaves the original credential and service stopped', async () => {
  const f = fixture({ stopped: true, replaceFailure: true }); await assert.rejects(repair(f.d));
  assert.equal(f.credential, 'OLD-SEALED'); assert.equal(f.state, 'Stopped'); assert(!f.operations.includes('start'));
});
test('A concurrent configuration change is rejected without touching the service or credential', async () => {
  const f = fixture({ concurrentChange: true }); await assert.rejects(repair(f.d), /changed|change/); untouched(f);
});
test('Incomplete rollback reports failure and preserves protected recovery files', async () => {
  const f = fixture({ replaceFailure: true, rollbackFailure: true });
  await assert.rejects(repair(f.d), /could not restore credential/); assert(f.operations.includes('cleanup-true')); noSecretOutput(f);
});
test('The generated Linux provision command quotes the existing display name without expansion', async () => {
  const f = fixture(); await repair(f.d);
  const command = f.messages.find(line => line.startsWith('docker exec'));
  assert.equal(command, "docker exec -it truck-log-server node tools/truck-log/provision-print-agent.mjs --agent-id 'guardWindows' --name 'Guard'\\''s $(echo private) Print Agent'");
  assert.equal(shellQuote(''), "''");
});
function inputHarness() {
  const input = new EventEmitter(); input.isTTY = true; input.isRaw = false; input.paused = true;
  input.setRawMode = value => { input.isRaw = value; }; input.resume = () => { input.paused = false; }; input.pause = () => { input.paused = true; };
  let output = ''; return { input, output: { write: text => { output += text; } }, get text() { return output; } };
}
test('Private input echoes no token and restores the terminal/listeners', async () => {
  const h = inputHarness(), pending = hiddenToken(h.input, h.output);
  h.input.emit('data', newToken + '\r\n'); assert.equal(await pending, newToken);
  assert(!h.text.includes(newToken)); assert.equal(h.input.isRaw, false); assert.equal(h.input.paused, true); assert.equal(h.input.listenerCount('data'), 0);
});
test('Private input cancellation and EOF restore terminal state without leaking contents', async () => {
  for (const end of ['cancel', 'eof']) {
    const h = inputHarness(), pending = hiddenToken(h.input, h.output);
    h.input.emit('data', newToken.slice(0, 20));
    if (end === 'cancel') h.input.emit('data', '\x03'); else h.input.emit('end');
    await assert.rejects(pending); assert.equal(h.input.isRaw, false); assert.equal(h.input.listenerCount('data'), 0); assert(!h.text.includes('tlpa_'));
  }
});
(async () => {
  let passed = 0;
  for (const [name, fn] of tests) { await fn(); passed++; console.log('[PASS] ' + name); }
  console.log(`Credential repair behavioral tests: ${passed}/${tests.length} PASS (mocked; no Windows or printing).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
