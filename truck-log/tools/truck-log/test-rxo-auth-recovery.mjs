// Behavioral RXO recovery regressions: temporary local state and browser mocks only.
// No credentials from the host, live RXO, browser launch, SMTP, or export actions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as auth from '../../libs/truck-log/rxo-shared/rxo-auth.mjs';
import { acquireLock } from '../../libs/truck-log/rxo-shared/process-lock.mjs';

const moduleUrl = pathToFileURL(path.join(process.cwd(), 'libs/truck-log/rxo-shared/rxo-auth.mjs'));
const roles = ['standard', 'expedite'];
const HOLD = 'rxo-auth-review.json', RETRY = 'rxo-auth-retry.json', RECOVERY = 'rxo-connection-recovery.json';
const savedEnv = Object.fromEntries(['RXO_SECRET_ROOT', 'RXO_USERNAME_FILE', 'RXO_PASSWORD_FILE',
  'TRUCK_LOG_RXO_AUTH_EMAIL_ENABLED'].map(key => [key, process.env[key]]));
let passed = 0;
async function test(name, body) { await body(); passed++; console.log(`[PASS] ${name}`); }
function json(root, name) { return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); }
function write(root, name, value) { fs.writeFileSync(path.join(root, name), JSON.stringify(value)); }
function snapshot(root) {
  return fs.readdirSync(root).sort().map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]);
}
function fixture(role) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `tl-rxo-recovery-${role}-`));
  const root = path.join(base, 'data'), secrets = path.join(base, 'secrets'), session = path.join(base, 'session');
  for (const dir of [root, secrets, session]) fs.mkdirSync(dir);
  const username = `fixture-${role}@example.test`, password = 'fixture-password-never-a-real-secret';
  let passwordFile;
  const generation = randomUUID();
  if (role === 'standard') {
    fs.writeFileSync(path.join(secrets, 'rxo_username'), username);
    passwordFile = path.join(secrets, 'rxo_password');
  } else {
    write(secrets, 'rxo_expedite_current.json', { contractVersion: 1, generation });
    const version = path.join(secrets, 'rxo_expedite_versions', generation);
    fs.mkdirSync(version, { recursive: true });
    fs.writeFileSync(path.join(version, 'rxo_expedite_username'), username);
    passwordFile = path.join(version, 'rxo_expedite_password');
  }
  fs.writeFileSync(passwordFile, password);
  process.env.RXO_SECRET_ROOT = secrets;
  delete process.env.RXO_USERNAME_FILE;
  delete process.env.RXO_PASSWORD_FILE;
  process.env.TRUCK_LOG_RXO_AUTH_EMAIL_ENABLED = 'false';
  return { base, root, secrets, session, username, password, passwordFile, generation, role,
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
    hold(code, extra = {}) {
      const credentialVersion = auth.currentCredentialVersion(role, root, secrets);
      write(root, HOLD, { version: auth.AUTH_VERSION, policyVersion: auth.AUTH_POLICY_VERSION,
        role, code, phase: 'FAILED', passwordSubmissions: 1, message: 'Fixture authentication result.',
        credentialVersion, updatedAt: new Date().toISOString(), ...extra });
    },
    changePassword() { fs.writeFileSync(passwordFile, password + '-changed'); },
  };
}
async function using(role, body) {
  const f = fixture(role);
  try { await body(f); } finally { f.cleanup(); }
}
async function clock(body) {
  const OriginalDate = globalThis.Date;
  let now = OriginalDate.now();
  class FixedDate extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  globalThis.Date = FixedDate;
  try { await body(ms => { now += ms; }); } finally { globalThis.Date = OriginalDate; }
}
function assertSafeMetadata(value, f) {
  const encoded = JSON.stringify(value);
  for (const secret of [f.username, f.password, f.password + '-changed']) assert.ok(!encoded.includes(secret));
}
function finishFixtureAttempt(f, phase = 'FAILED') {
  const record = json(f.root, RECOVERY);
  assert.equal(record.phase, 'RUNNING');
  write(f.root, RECOVERY, { ...record, phase, refreshSession: false, updatedAt: new Date().toISOString() });
}

// Small stateful Playwright stand-in: selectors operate on real mock element
// identities, a new OIDC marker appears on first navigation, and later clearing
// storage destroys that marker. This catches the former goto-clear-goto bug.
function browser(role, { unapprovedRedirect = false, authenticated = false } = {}) {
  const events = [];
  const appUrl = role === 'standard' ? 'https://customer.rxoconnect.rxo.com/orders/list'
    : 'https://www.expedite.rxo.com/WebClient/#/freight-on-the-move';
  const loginUrl = role === 'standard' ? 'https://customer.rxoconnect.rxo.com/login'
    : 'https://www.expedite.rxo.com/WebClient/Account/Login';
  let currentUrl = 'about:blank', phase = 'blank', navigations = 0, oidc = null;
  const initScripts = [], localValues = new Map(), sessionValues = new Map();
  const storage = values => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key),
    clear: () => { values.clear(); oidc = null; } });
  const localStorage = storage(localValues), sessionStorage = storage(sessionValues);
  let cookies = [{ name: 'unrelated', domain: 'unrelated.example', value: 'retain' },
    { name: 'rxo', domain: '.rxo.com', value: 'old' }];
  const elements = {
    user: { kind: 'user', value: '' }, pass: { kind: 'pass', value: '' },
    submit: { kind: 'button', text: 'Sign in' }, form: { kind: 'form' },
    export: { kind: 'text', text: 'Export' }, list: { kind: 'text', text: 'List' },
  };
  function rows(selector) {
    if (selector.startsWith('xpath=ancestor::form')) return phase === 'form' ? [elements.form] : [];
    if (selector.includes('autocomplete="one-time-code"') || selector.includes('recaptcha') || selector.startsWith('h1,h2') || selector.includes('[role="alert"]')) return [];
    if (selector === 'input:not([type="password"])' || selector.includes('autocomplete="username"')) return phase === 'form' ? [elements.user] : [];
    if (selector.includes('input[type="password"]')) return phase === 'form' ? [elements.pass] : [];
    if (selector.includes('button[type="submit"]')) return phase === 'form' ? [elements.submit] : [];
    if (selector.startsWith('button,a,')) return phase === 'ready' && role === 'expedite' ? [elements.list] : [];
    return [];
  }
  function locator(getRows) {
    return {
      count: async () => getRows().length,
      nth: n => locator(() => [getRows()[n]].filter(Boolean)),
      first: () => locator(() => getRows().slice(0, 1)),
      and: other => locator(() => getRows().filter(row => other._rows().includes(row))),
      or: other => locator(() => [...new Set([...getRows(), ...other._rows()])]),
      filter: ({ hasText }) => locator(() => getRows().filter(row => hasText.test(row.text || ''))),
      locator: selector => locator(() => rows(selector)),
      getByRole: (kind, options) => getByRole(kind, options),
      isVisible: async () => getRows().length > 0,
      isEditable: async () => ['user', 'pass'].includes(getRows()[0]?.kind),
      isEnabled: async () => getRows().length > 0,
      fill: async value => { const row = getRows()[0]; assert.ok(row); row.value = value; events.push(`fill:${row.kind}`); },
      press: async () => {},
      inputValue: async () => getRows()[0]?.value || '',
      innerText: async () => getRows()[0]?.text || '',
      click: async () => {
        assert.equal(getRows()[0], elements.submit);
        assert.ok(oidc, 'Fresh OIDC state was cleared after initial navigation');
        events.push('submit');
        phase = 'callback';
        currentUrl = role === 'standard' ? 'https://customer.rxoconnect.rxo.com/signin-oidc'
          : 'https://www.expedite.rxo.com/WebClient/#/signin-oidc';
      },
      _rows: getRows,
    };
  }
  function getByRole(kind, { name } = {}) {
    return locator(() => kind === 'button' && phase === 'form' && (!name || name.test('Sign in')) ? [elements.submit] : []);
  }
  const context = {
    addInitScript: async (fn, arg) => { events.push('installInitScript'); initScripts.push([fn, arg]); },
    clearCookies: async options => {
      events.push('clearCookies');
      const domain = options?.domain;
      cookies = cookies.filter(cookie => domain instanceof RegExp ? !domain.test(cookie.domain) : domain ? cookie.domain !== domain : false);
    },
    cookies: async () => cookies,
    pages: () => [page],
    newCDPSession: async () => ({
      send: async (method, options) => {
        events.push(`cdp:${method}`);
        if (method === 'Storage.clearDataForOrigin') {
          assert.ok(auth.allowedAuthUrl(options.origin, role), 'Storage clear targeted an unapproved origin');
          oidc = null;
        }
      },
      detach: async () => { events.push('cdp:detach'); },
    }),
  };
  const frame = {
    url: () => currentUrl,
    locator: selector => locator(() => rows(selector)),
    getByRole,
    evaluate: async () => { events.push('clearFrameStorage'); oidc = null; },
  };
  const page = {
    url: () => currentUrl,
    context: () => context,
    frames: () => [frame],
    mainFrame: () => frame,
    locator: frame.locator,
    getByRole,
    getByText: pattern => locator(() => phase === 'ready' && role === 'standard' && pattern.test('Export') ? [elements.export] : []),
    evaluate: async () => { events.push('clearPageStorage'); oidc = null; },
    goto: async (url, options) => {
      assert.equal(options.waitUntil, 'commit', 'Navigation must not wait for DOMContentLoaded');
      events.push(`goto:${url}`);
      navigations++;
      currentUrl = unapprovedRedirect ? 'https://unapproved.example/login' : navigations === 1 ? (authenticated ? appUrl : loginUrl) : url;
      for (const [fn, arg] of initScripts) runInNewContext(`(${fn.toString()})(argument)`, { argument: arg, location: new URL(currentUrl), localStorage, sessionStorage, URL });
      if (unapprovedRedirect) { currentUrl = 'https://unapproved.example/login'; phase = 'form'; return; }
      if (navigations === 1) {
        oidc = 'new-oidc-state';
        currentUrl = authenticated ? appUrl : loginUrl;
        phase = authenticated ? 'ready' : 'form';
      } else {
        assert.ok(oidc, 'Fresh OIDC callback state must survive later navigation');
        currentUrl = url; phase = url === appUrl ? 'ready' : 'form';
      }
    },
  };
  return { page, events, getCookies: () => cookies, hasOidc: () => oidc !== null };
}
async function authenticate(f, b, options = {}) {
  const credentials = { username: f.username, password: fs.readFileSync(f.passwordFile, 'utf8'),
    dataRoot: f.root, timeoutMs: 5000, ...options };
  return f.role === 'standard' ? auth.authenticateStandard(b.page, credentials)
    : auth.authenticateExpedite(b.page, { ...credentials, sessionRoot: f.session,
      generation: f.generation, checkGeneration: () => f.generation });
}


async function runChromiumSmoke() {
  const requireWorker = createRequire(path.join(process.cwd(), 'apps/rxo-integration/package.json'));
  const { chromium } = requireWorker('playwright');
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const chromiumBrowser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  try {
    for (const role of roles) {
      for (const { cdp, suppressGuard } of [{ cdp: true, suppressGuard: false },
        { cdp: false, suppressGuard: false }, { cdp: false, suppressGuard: true }]) {
      const scenario = cdp ? 'recovers NAVIGATION_REVIEW with real CDP and stalled DOMContentLoaded'
        : suppressGuard ? 'no-CDP negative control exposes stale opaque-tab storage'
          : 'one-time guard clears opaque-tab storage without CDP and preserves OIDC';
      await test(`${role}: actual Chromium ${scenario}`,  () => using(role, async f => {
        const context = await chromiumBrowser.newContext({ serviceWorkers: 'block' });
        if (!cdp) context.newCDPSession = undefined; // Exercise the supported no-CDP fallback on a real browser.
        if (suppressGuard) context.addInitScript = async () => {}; // Negative control keeps cookie/CDP cleanup intact.
        const page = await context.newPage();
        const origin = role === 'standard' ? 'https://customer.rxoconnect.rxo.com' : 'https://www.expedite.rxo.com';
        const appUrl = origin + (role === 'standard' ? '/orders/list' : '/WebClient/#/freight-on-the-move');
        const loginUrl = origin + (role === 'standard' ? '/login' : '/WebClient/Account/Login');
        const nonce = randomUUID(), blocked = [], submissions = [], oidcReports = [];
        let verified = false, loginDomContentLoaded = 0, slowScriptRequested = false;
        const diagnosticEvents = [];
        page.on('pageerror', error => diagnosticEvents.push('pageerror:' + error.message));
        page.on('domcontentloaded', () => { if (page.url() === loginUrl) loginDomContentLoaded++; });
        await context.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url());
          diagnosticEvents.push('request:' + url.pathname);
          if (url.origin !== origin) { await route.abort('blockedbyclient'); return; }
          if (url.pathname === '/fixture-slow.js') {
            slowScriptRequested = true;
            blocked.push(route); // Deliberately never finish the parser-blocking script.
            return;
          }
          if (url.pathname === '/fixture-network-error') { await route.abort('connectionrefused'); return; }
          if (url.pathname === '/old-session') {
            await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Previous session</title>' }); return;
          }
          if (url.pathname === '/fixture-auth-callback') {
            assert.equal(req.method(), 'POST');
            const body = new URLSearchParams(req.postData() || '');
            submissions.push(body);
            const report = JSON.stringify(origin + '/fixture-oidc-report');
            await route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>OIDC callback</title>
              <script>
              const okay = localStorage.getItem('fixture_oidc') === ${JSON.stringify(nonce)} &&
                sessionStorage.getItem('fixture_oidc') === ${JSON.stringify(nonce)};
              fetch(${report}, {method:'POST', body:String(okay)}).then(() => location.replace(${JSON.stringify(appUrl)}));
              </script>` });
            return;
          }
          if (url.pathname === '/fixture-oidc-report') {
            oidcReports.push(req.postData()); verified = req.postData() === 'true';
            await route.fulfill({ contentType: 'text/plain', body: 'ok' }); return;
          }
          if (url.href === loginUrl) {
            await route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>RXO test login</title>
              <script>
                window.fixtureOldCleared = localStorage.getItem('fixture_old') === null && sessionStorage.getItem('fixture_old') === null;
                localStorage.setItem('fixture_oidc', ${JSON.stringify(nonce)});
                sessionStorage.setItem('fixture_oidc', ${JSON.stringify(nonce)});
              </script>
              <form action="/fixture-auth-callback" method="post">
                <label>Email <input type="email" name="username" autocomplete="username"></label>
                <label>Password <input type="password" name="password" autocomplete="current-password"></label>
                <input type="hidden" name="oldclear">
                <button type="submit">Sign in</button>
              </form>
              <script>
                document.querySelector('form').addEventListener('submit', event => {
                  document.querySelector('input[name=oldclear]').value = String(window.fixtureOldCleared);
                  if (sessionStorage.getItem('fixture_oidc') !== ${JSON.stringify(nonce)}) {
                    event.preventDefault(); document.body.innerHTML = '<p role="alert">Sign-in state was lost</p>';
                  }
                });
              </script>
              <script defer src="/fixture-slow.js"></script>` });
            return;
          }
          if ((role === 'standard' && url.pathname === '/orders/list') ||
              (role === 'expedite' && url.pathname.toLowerCase() === '/webclient/')) {
            if (!verified) { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><script>location.replace(' + JSON.stringify(loginUrl) + ')</script>' }); return; }
            await route.fulfill({ contentType: 'text/html', body: role === 'standard'
              ? '<!doctype html><button>Export</button>' : '<!doctype html><button>List</button>' });
            return;
          }
          await route.abort('blockedbyclient'); // No unexpected destination can reach the network.
        });
        try {
          await page.goto(origin + '/old-session');
          await page.evaluate(() => { localStorage.setItem('fixture_old', 'stale'); sessionStorage.setItem('fixture_old', 'stale'); });
          await context.addCookies([
            { name: 'fixture_old_rxo', value: 'stale', domain: '.rxo.com', path: '/', secure: true },
            { name: 'fixture_unrelated', value: 'retain', domain: 'unrelated.example', path: '/', secure: true },
          ]);
          await page.goto(origin + '/fixture-network-error', { waitUntil: 'commit', timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(50);
          assert.equal(await page.evaluate(() => location.origin).catch(() => 'null'), 'null', 'Fixture must leave an opaque network-error document');
          f.hold('RXO_AUTH_NAVIGATION_REVIEW');
          assert.equal(auth.requestConnectionRecovery(f.root, role).requested, true);
          assert.equal(auth.consumeAuthRetry(f.root, role), true);
          const goto = page.goto.bind(page), navigationOptions = [];
          page.goto = (url, options) => { navigationOptions.push(options); return goto(url, options); };
          const started = Date.now();
          let result;
          try { result = await authenticate(f, { page }); }
          catch (error) {
            console.error('Local Chromium fixture diagnostics', JSON.stringify({ role, url: page.url(),
              inputs: await page.locator('input').count(), buttons: await page.locator('button').allTextContents(),
              slowScriptRequested, loginDomContentLoaded, submissions: submissions.length,
              hold: fs.existsSync(path.join(f.root, HOLD)) ? json(f.root, HOLD).passwordSubmissions : null,
              events: diagnosticEvents }));
            throw error;
          }
          assert.equal(result.authenticated, true);
          assert.equal(result.passwordSubmissions, 1);
          assert.ok(navigationOptions.length > 0);
          assert.ok(navigationOptions.every(options => options.waitUntil === 'commit'));
          assert.ok(Date.now() - started < 5000, 'A stalled DOMContentLoaded must not consume the navigation timeout');
          assert.equal(slowScriptRequested, true, 'The slow script fixture must actually be requested');
          assert.equal(loginDomContentLoaded, 0, 'The login document must remain short of DOMContentLoaded');
          assert.equal(submissions.length, 1, 'Exactly one real password submission is permitted');
          assert.equal(submissions[0].get('username'), f.username);
          assert.equal(submissions[0].get('password'), f.password);
          assert.equal(submissions[0].get('oldclear'), suppressGuard ? 'false' : 'true', suppressGuard
            ? 'Suppressing only the one-time guard must expose stale sessionStorage to first app scripts'
            : 'Stale RXO storage must be cleared before login application scripts execute');
          assert.deepEqual(oidcReports, ['true'], 'Fresh local/session OIDC nonce must survive the callback');
          const storage = await page.evaluate(() => ({ local: localStorage.getItem('fixture_old'), session: sessionStorage.getItem('fixture_old') }));
          assert.deepEqual(storage, { local: suppressGuard ? 'stale' : null, session: suppressGuard ? 'stale' : null });
          const cookies = await context.cookies();
          assert.ok(!cookies.some(cookie => cookie.name === 'fixture_old_rxo'));
          assert.ok(cookies.some(cookie => cookie.name === 'fixture_unrelated' && cookie.value === 'retain'));
          assert.equal(json(f.root, RECOVERY).phase, 'AUTHENTICATED');
          assert.equal(auth.consumeAuthRetry(f.root, role), false);
        } finally {
          for (const route of blocked) await route.abort('aborted').catch(() => {});
          await context.close();
        }
      }));
      }
    }
  } finally { await chromiumBrowser.close(); }
}

try {
  assert.equal(typeof auth.connectionRecoveryStatus, 'function', 'Shared module must expose readonly recovery status');
  assert.equal(typeof auth.requestConnectionRecovery, 'function', 'Shared module must expose queued recovery requests');
  for (const role of roles) {
    await test(`${role}: status is readonly and never creates a credential HMAC key`, () => using(role, f => {
      const before = snapshot(f.root);
      const status = auth.connectionRecoveryStatus(f.root, role);
      assertSafeMetadata(status, f);
      assert.deepEqual(snapshot(f.root), before);
      assert.equal(fs.existsSync(path.join(f.root, 'rxo-auth-credential-key')), false);
    }));
    await test(`${role}: status reads an unbound legacy hold without creating an HMAC key`, () => using(role, f => {
      write(f.root, HOLD, { version: auth.AUTH_VERSION, role, code: 'RXO_AUTH_FORM_NOT_READY',
        phase: 'FAILED', passwordSubmissions: 0, message: 'Legacy fixture hold.', updatedAt: new Date().toISOString() });
      const before = snapshot(f.root);
      assertSafeMetadata(auth.connectionRecoveryStatus(f.root, role), f);
      assert.deepEqual(snapshot(f.root), before);
      assert.equal(fs.existsSync(path.join(f.root, 'rxo-auth-credential-key')), false);
    }));
    await test(`${role}: connection recovery queues without requiring an auth hold`, () => using(role, f => {
      const result = auth.requestConnectionRecovery(f.root, role);
      assert.equal(result.requested, true);
      assertSafeMetadata(result, f);
      const retry = json(f.root, RETRY), recovery = json(f.root, RECOVERY);
      assert.equal(recovery.role, role);
      assert.equal(recovery.phase, 'QUEUED');
      assert.match(recovery.id, /^[a-f0-9-]{36}$/);
      assert.equal(retry.id, recovery.id);
      assert.equal(auth.consumeAuthRetry(f.root, role), true);
      assert.equal(json(f.root, RECOVERY).phase, 'RUNNING');
      assert.equal(json(f.root, RECOVERY).refreshSession, true);
      assert.equal(auth.consumeAuthRetry(f.root, role), false);
      assert.equal(fs.existsSync(path.join(f.root, RETRY)), false);
    }));
    await test(`${role}: cooldown includes redelivery, which preserves one pending ID and budget`, () => using(role, f => clock(advance => {
      assert.equal(auth.requestConnectionRecovery(f.root, role).requested, true);
      const first = json(f.root, RECOVERY);
      assert.equal(auth.requestConnectionRecovery(f.root, role).requested, false);
      assert.equal(json(f.root, RECOVERY).id, first.id);
      advance(59_999);
      assert.equal(auth.requestConnectionRecovery(f.root, role).requested, false);
      advance(1);
      const redelivery = auth.requestConnectionRecovery(f.root, role);
      assert.equal(redelivery.requested, true);
      assert.equal(redelivery.reason, 'ALREADY_QUEUED');
      const second = json(f.root, RECOVERY);
      assert.equal(second.id, first.id);
      assert.equal(second.requestedAt, first.requestedAt);
      assert.deepEqual(second.attempts, first.attempts);
      assert.notEqual(second.deliveryRequestedAt, first.deliveryRequestedAt);
      assert.equal(auth.requestConnectionRecovery(f.root, role).requested, false);
    })));
    await test(`${role}: three new attempts per hour remain capped after module reload`, () => using(role, f => clock(async advance => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = auth.requestConnectionRecovery(f.root, role);
        assert.equal(result.requested, true, `Attempt ${attempt + 1}`);
        assert.equal(auth.consumeAuthRetry(f.root, role), true);
        finishFixtureAttempt(f);
        advance(60_001);
      }
      const before = json(f.root, RECOVERY);
      const fresh = await import(`${moduleUrl.href}?policy-reload=${randomUUID()}`);
      assert.equal(fresh.requestConnectionRecovery(f.root, role).requested, false);
      assert.deepEqual(json(f.root, RECOVERY).attempts, before.attempts);
      assert.equal(before.attempts.length, 3);
      advance(3_600_001);
      assert.equal(fresh.requestConnectionRecovery(f.root, role).requested, true);
    })));
    for (const code of ['RXO_AUTH_REJECTED', 'RXO_AUTH_ACCOUNT_REVIEW']) {
      await test(`${role}: ${code} blocks unchanged credentials and allows changed credentials once`, () => using(role, f => clock(advance => {
        f.hold(code);
        const before = snapshot(f.root);
        assert.equal(auth.requestConnectionRecovery(f.root, role).requested, false);
        assert.deepEqual(snapshot(f.root), before);
        assert.equal(auth.authorizeManualRetry(f.root, role), false, 'Manual scan must not bypass rejected credentials');
        f.changePassword();
        assert.equal(auth.requestConnectionRecovery(f.root, role).requested, true);
        assert.equal(auth.consumeAuthRetry(f.root, role), true);
        assert.equal(auth.consumeAuthRetry(f.root, role), false);
        finishFixtureAttempt(f);
        f.hold(code); // A second rejection binds the changed credentials, preventing repeated guesses.
        advance(60_001);
        assert.equal(auth.requestConnectionRecovery(f.root, role).requested, false);
      })));
    }
    for (const code of ['RXO_AUTH_VERIFICATION_REQUIRED', 'RXO_AUTH_ACCESS_REVIEW', 'RXO_AUTH_ORIGIN_REVIEW']) {
      await test(`${role}: ${code} cannot be cleared by unchanged-credential reconnect`, () => using(role, f => {
        f.hold(code);
        const before = snapshot(f.root);
        assert.equal(auth.requestConnectionRecovery(f.root, role).requested, false);
        assert.deepEqual(snapshot(f.root), before);
      }));
    }
    for (const code of ['RXO_AUTH_VERIFICATION_REQUIRED', 'RXO_AUTH_ACCESS_REVIEW', 'RXO_AUTH_ORIGIN_REVIEW']) {
      await test(`${role}: administrator acknowledgement clears a ${code} hold once and queues one recovery`, () => using(role, f => {
        f.hold(code);
        const result = auth.acknowledgeAuthHold(f.root, role);
        assert.equal(result.requested, true);
        assert.equal(result.holdCleared, true);
        assert.equal(fs.existsSync(path.join(f.root, HOLD)), false, 'the review hold is released');
        assert.equal(json(f.root, RECOVERY).phase, 'QUEUED');
        assert.equal(json(f.root, RETRY).kind, 'connection');
        assertSafeMetadata(result, f);
      }));
    }
    await test(`${role}: acknowledgement never clears rejected or locked credentials`, () => using(role, f => {
      for (const code of ['RXO_AUTH_REJECTED', 'RXO_AUTH_ACCOUNT_REVIEW']) {
        f.hold(code);
        const before = snapshot(f.root);
        const result = auth.acknowledgeAuthHold(f.root, role);
        assert.equal(result.requested, false);
        assert.equal(result.requiresCredentials, true);
        assert.deepEqual(snapshot(f.root), before, 'nothing changes: new credentials are required');
      }
    }));
    await test(`${role}: acknowledgement cannot bypass the cooldown; the hold is put back`, () => using(role, f => clock(advance => {
      f.hold('RXO_AUTH_ORIGIN_REVIEW');
      assert.equal(auth.acknowledgeAuthHold(f.root, role).requested, true);
      advance(5_000);
      f.hold('RXO_AUTH_ORIGIN_REVIEW'); // the retried sign-in hit the same page again
      const result = auth.acknowledgeAuthHold(f.root, role);
      assert.equal(result.requested, false);
      assert.equal(result.reason, 'COOLDOWN');
      assert.equal(json(f.root, HOLD).code, 'RXO_AUTH_ORIGIN_REVIEW', 'the hold stays in place');
    })));
    await test(`${role}: malformed control state fails closed without replacing evidence`, () => using(role, f => {
      fs.writeFileSync(path.join(f.root, RECOVERY), '{malformed');
      const before = snapshot(f.root);
      for (const action of [() => auth.connectionRecoveryStatus(f.root, role), () => auth.requestConnectionRecovery(f.root, role)]) {
        const result = action();
        assert.equal(result.available, false);
        assert.equal(result.reason, 'STATE_REVIEW');
        assert.notEqual(result.requested, true);
      }
      assert.deepEqual(snapshot(f.root), before);
    }));
    await test(`${role}: mismatched delivery ID never starts or releases a held authentication attempt`, () => using(role, f => {
      f.hold('RXO_AUTH_FORM_NOT_READY');
      assert.equal(auth.requestConnectionRecovery(f.root, role).requested, true);
      const first = json(f.root, RECOVERY), hold = fs.readFileSync(path.join(f.root, HOLD), 'utf8');
      write(f.root, RETRY, { ...json(f.root, RETRY), id: randomUUID() });
      try { assert.equal(auth.consumeAuthRetry(f.root, role), false); }
      catch (error) { assert.equal(error?.code, 'RXO_AUTH_STATE_REVIEW'); }
      assert.equal(json(f.root, RECOVERY).phase, 'QUEUED');
      assert.equal(json(f.root, RECOVERY).id, first.id);
      assert.equal(fs.readFileSync(path.join(f.root, HOLD), 'utf8'), hold);
    }));
    await test(`${role}: competing recovery mutations respect the shared lock and consume one attempt`, () => using(role, f => {
      f.hold('RXO_AUTH_FORM_NOT_READY');
      assert.equal(auth.requestConnectionRecovery(f.root, role).requested, true);
      const held = acquireLock(path.join(f.root, '.rxo-connection-recovery.lock'), {
        staleAfterMs: 30_000, maxHoldMs: 30_000, purpose: 'recovery regression holder', log: () => {},
      });
      try {
        const before = snapshot(f.root);
        assert.equal(auth.consumeAuthRetry(f.root, role), false);
        assert.equal(auth.requestConnectionRecovery(f.root, role).requested, false);
        assert.equal(auth.authorizeManualRetry(f.root, role), false);
        assert.deepEqual(snapshot(f.root), before);
        assert.equal(json(f.root, RECOVERY).phase, 'QUEUED');
        assert.equal(fs.existsSync(path.join(f.root, HOLD)), true);
      } finally { held.release(); }
      assert.equal(auth.consumeAuthRetry(f.root, role), true);
      assert.equal(auth.consumeAuthRetry(f.root, role), false);
      assert.equal(json(f.root, RECOVERY).attempts.length, 1);
      assert.equal(fs.existsSync(path.join(f.root, HOLD)), false);
    }));
  }
  for (const role of roles) {
    await test(`${role}: consumed recovery refreshes only before initial navigation and preserves fresh OIDC`, () => using(role, async f => {
      assert.equal(auth.requestConnectionRecovery(f.root, role).requested, true);
      assert.equal(auth.consumeAuthRetry(f.root, role), true);
      const b = browser(role);
      const result = await authenticate(f, b);
      assert.equal(result.authenticated, true);
      assert.equal(result.passwordSubmissions, 1);
      const firstNavigation = b.events.findIndex(event => event.startsWith('goto:'));
      assert.ok(firstNavigation > 0, 'Recovery must refresh the old session before its first navigation');
      for (let index = firstNavigation + 1; index < b.events.length; index++) {
        assert.ok(!/^(clear|cdp:Storage.clearDataForOrigin)/.test(b.events[index]), b.events.join('\n'));
      }
      assert.equal(b.events.filter(event => event === 'fill:pass').length, 1);
      assert.equal(b.events.filter(event => event === 'submit').length, 1);
      assert.ok(b.hasOidc());
      assert.ok(b.getCookies().some(cookie => cookie.name === 'unrelated'), 'Unrelated browser cookies must be preserved');
      assert.equal(json(f.root, RECOVERY).phase, 'AUTHENTICATED');
      assert.equal(json(f.root, RECOVERY).refreshSession, false);
      assert.equal(auth.consumeAuthRetry(f.root, role), false);
    }));
    await test(`${role}: completion cannot overwrite a newer queued recovery ID`, () => using(role, async f => {
      assert.equal(auth.requestConnectionRecovery(f.root, role).requested, true);
      assert.equal(auth.consumeAuthRetry(f.root, role), true);
      const old = json(f.root, RECOVERY), newerId = randomUUID();
      const b = browser(role), goto = b.page.goto;
      let replaced = false;
      b.page.goto = async (...args) => {
        await goto(...args);
        if (!replaced) {
          replaced = true;
          const at = new Date().toISOString();
          write(f.root, RECOVERY, { ...old, id: newerId, phase: 'QUEUED', refreshSession: false,
            requestedAt: at, deliveryRequestedAt: at, updatedAt: at, attempts: [...old.attempts, at] });
          write(f.root, RETRY, { version: auth.AUTH_VERSION, role, kind: 'connection', id: newerId, requestedAt: at });
        }
      };
      assert.equal((await authenticate(f, b)).authenticated, true);
      assert.equal(json(f.root, RECOVERY).id, newerId);
      assert.equal(json(f.root, RECOVERY).phase, 'QUEUED');
      assert.equal(json(f.root, RETRY).id, newerId);
    }));
    await test(`${role}: an unapproved redirect fails before entering credentials`, () => using(role, async f => {
      const b = browser(role, { unapprovedRedirect: true });
      await assert.rejects(authenticate(f, b), error => error?.code === 'RXO_AUTH_ORIGIN_REVIEW');
      assert.equal(b.events.filter(event => event.startsWith('fill:')).length, 0);
      assert.equal(json(f.root, HOLD).code, 'RXO_AUTH_ORIGIN_REVIEW');
    }));
  }
  if (process.argv.includes('--browser')) await runChromiumSmoke();
  console.log(`[PASS] RXO auth connection recovery: ${passed} behavioral cases${process.argv.includes('--browser') ? ', including actual Chromium fixtures' : ''}; no live RXO or export actions.`);
} finally {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
