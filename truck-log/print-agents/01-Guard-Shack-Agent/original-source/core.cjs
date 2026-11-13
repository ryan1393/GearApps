'use strict';
// Truck Log native service V4R7. No third-party npm modules.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const VERSION = '4.0.7-service';
// A V4R6 installation's config.json (and its pending claim body) stays valid after an in-place update.
const CONFIG_VERSIONS = ['4.0.6-service', VERSION];
const MAX_PDF = 25 * 1024 * 1024;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function must(ok, message) { if (!ok) throw new Error(message); }
function sha(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function key(kind) {
  must(/^[a-z]{1,12}$/.test(kind), 'Invalid request operation.');
  return 'tl4-' + kind + '-' + crypto.randomBytes(24).toString('hex');
}
function cleanError(error) {
  return String(error && error.message || error || 'Unknown failure')
    .replace(/tlpa_[A-Za-z0-9_]+/g, '[redacted credential]')
    .replace(/\b[0-9a-f]{64}\b/gi, '[redacted digest]')
    .replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 1200);
}
function apiBase(input) {
  const u = new URL(String(input).trim());
  must(['http:', 'https:'].includes(u.protocol), 'Use an HTTP or HTTPS Truck Log address.');
  must(!u.username && !u.password && !u.search && !u.hash, 'API address cannot contain credentials, a query, or a fragment.');
  must(['', '/', '/api/v1', '/api/v1/'].includes(u.pathname), 'Enter the site address or its /api/v1 base only.');
  return u.origin + '/api/v1';
}
function validConfig(c) {
  must(c && CONFIG_VERSIONS.includes(c.agentVersion), 'Unrecognized service configuration version.');
  must(apiBase(c.apiBase) === c.apiBase, 'API base is not canonical.');
  must(/^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(c.agentId), 'Invalid agent ID.');
  for (const [field, max] of [['route',120]]) {
    must(typeof c[field] === 'string' && c[field].trim() === c[field] && c[field].length > 0 && c[field].length <= max && !/[\x00-\x1f\x7f]/.test(c[field]), 'Invalid ' + field + '.');
  }
  must(c.hostName === 'USFTWLDAPP', 'This configuration belongs to the Windows VM host USFTWLDAPP.');
  must(Array.isArray(c.printers) && c.printers.length === 2, 'Exactly two gate printers are required.');
  must(new Set(c.printers.map(p=>p.gate)).size===2 && c.printers.every(p=>['EAST','WEST'].includes(p.gate)), 'East and West gate labels must be distinct.');
  for(const p of c.printers) for(const f of ['printer','sourceQueue']) must(typeof p[f]==='string' && p[f].trim()===p[f] && p[f].length>0 && p[f].length<=255 && !/[\x00-\x1f\x7f]/.test(p[f]), 'Invalid gate '+f+'.');
  must(new Set(c.printers.map(p=>p.printer.toLowerCase())).size===2, 'East and West cannot use the same physical printer.');
  must(GUID.test(c.installId), 'Invalid installation ID.');
  must(c.apiBase.startsWith('https:') || c.allowHttp === true, 'HTTP transport has not been acknowledged.');
  return c;
}
function validateJob(j, c, now = Date.now()) {
  must(j && GUID.test(j.itemId) && GUID.test(j.packageId), 'Invalid server print-job identifiers.');
  must(Number.isSafeInteger(j.attemptNumber) && j.attemptNumber > 0, 'Invalid print attempt.');
  must(j.route === c.route && c.printers.some(p => p.printer === j.printer), 'Frozen print route/printer do not match either approved gate.');
  must(/^[0-9a-f]{64}$/.test(j.sha256) && /^[0-9a-f]{64}$/.test(j.claimToken), 'Invalid document hash or claim.');
  must(Number.isSafeInteger(j.fileSizeBytes) && j.fileSizeBytes > 8 && j.fileSizeBytes <= MAX_PDF, 'PDF exceeds the supported size.');
  must(j.downloadUrl === '/api/v1/print-agents/jobs/' + j.itemId + '/document', 'Unexpected download path; refused.');
  must(Number.isFinite(Date.parse(j.leaseExpiresAt)) && Date.parse(j.leaseExpiresAt) > now, 'Print lease is expired or invalid.');
  return j;
}
function verifyPdf(bytes, job) {
  must(Buffer.isBuffer(bytes) && bytes.length <= MAX_PDF && bytes.length === job.fileSizeBytes, 'PDF size does not match the frozen job.');
  must(bytes.subarray(0,5).toString('ascii') === '%PDF-' && bytes.subarray(-2048).includes(Buffer.from('%%EOF')), 'Downloaded content is not a complete PDF.');
  must(sha(bytes) === job.sha256, 'PDF SHA-256 does not match the frozen job.');
}
function exactOnline(response, config, since) {
  const matches = Array.isArray(response && response.agents) ? response.agents.filter(a => a.agentId === config.agentId) : [];
  if (matches.length !== 1) return false;
  const a = matches[0];
  return a.enabled === true && a.status === 'ONLINE' && a.agentVersion === VERSION &&
    Number.isFinite(Date.parse(a.lastSeen)) && Date.parse(a.lastSeen) >= Date.parse(since) &&
    Array.isArray(a.configuredRoutes) && config.printers.every(p=>a.configuredRoutes.some(r => r.route === config.route && r.outputPrinter === p.printer));
}
function atomicWrite(file, bytes) {
  const temp = file + '.tmp-' + crypto.randomBytes(10).toString('hex');
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    fs.renameSync(temp, file);
  } finally { if (fd != null) fs.closeSync(fd); try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
class HttpFailure extends Error {
  constructor(op, status) { super(op + ': HTTP ' + status + '.'); this.status = status; }
}
class Api {
  constructor(base, token, fetchImpl = global.fetch) { this.base = base; this.token = token; this.fetch = fetchImpl; }
  async request(method, route, body, requestKey, options = {}) {
    must(/^\/[A-Za-z0-9_./-]+$/.test(route) && !route.includes('..'), 'Unsafe API route.');
    const headers = { Accept: options.pdf ? 'application/pdf' : 'application/json' };
    if (options.auth !== false) headers.Authorization = 'Bearer ' + this.token;
    if (requestKey) headers['X-Idempotency-Key'] = requestKey;
    if (options.claim) headers['X-Print-Claim-Token'] = options.claim;
    if (body != null) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 12000);
    let r;
    try {
      r = await this.fetch(this.base + route, { method, headers, body: body == null ? undefined : JSON.stringify(body), redirect: 'error', signal: controller.signal });
      if (!r.ok) { if (r.body) await r.body.cancel(); throw new HttpFailure(route, r.status); }
      const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      must(ct === (options.pdf ? 'application/pdf' : 'application/json'), 'Unexpected response type for ' + route + '.');
      const limit = options.pdf ? MAX_PDF : 2 * 1024 * 1024;
      const len = r.headers.get('content-length');
      if (len != null) must(/^\d+$/.test(len) && Number(len) <= limit, 'Response exceeds permitted size.');
      const pieces = []; let total = 0;
      for await (const p of r.body) { total += p.length; must(total <= limit, 'Response exceeds permitted size.'); pieces.push(Buffer.from(p)); }
      const bytes = Buffer.concat(pieces);
      if (options.pdf) return bytes;
      try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid JSON response for ' + route + '.'); }
    } catch (e) {
      controller.abort();
      if (e instanceof HttpFailure || e.message.startsWith('Unexpected') || e.message.startsWith('Response') || e.message.startsWith('Invalid JSON')) throw e;
      throw new Error('API transport failed for ' + route + ' (network, TLS, redirect, or timeout).');
    } finally { clearTimeout(timer); }
  }
  // advertise: true = both gates, false = none, or the array of currently reachable gate printers.
  heartbeat(c, lastError, advertise = true) {
    const gates = advertise === true ? c.printers : Array.isArray(advertise) ? advertise : [];
    const body = { agentVersion: VERSION, configuredRoutes: gates.length ? gates.map(p=>({route:c.route, sourceQueue:p.sourceQueue, outputPrinter:p.printer})) : [] };
    if (lastError) body.lastError = cleanError(lastError);
    return this.request('POST', '/print-agents/heartbeat', body, key('heartbeat'));
  }
  claim(body, k) { return this.request('POST', '/print-agents/jobs/claim', body, k); }
  pdf(j) { return this.request('GET', j.downloadUrl.slice('/api/v1'.length), null, null, { pdf:true, claim:j.claimToken, timeout:30000 }); }
  report(j, body, k) { return this.request('POST', '/print-agents/jobs/'+j.itemId+'/result', body, k); }
}
// ---- V4R7 reliability ------------------------------------------------------
// Job phases (durable, sealed on disk): CLAIM -> ACQUIRED -> PRINT_INTENT -> (result handed to outbox).
// There is no transition from PRINT_INTENT back to printing, EXCEPT when the failure provably
// happened before the renderer started (NotPrinted): then the same lease may be retried.
// Finished results live in a separate durable, bounded outbox and are re-sent with the SAME
// X-Idempotency-Key and body until the server acknowledges them. Nothing parks the poll loop:
// anomalies go to a bounded review journal (reported in the heartbeat) and polling continues.
const PRINT_RETRY = { firstMs: 2000, maxMs: 30000, maxTries: 8, leaseReserveMs: 25000 };
// Server keeps result idempotency records for 7 days; never resend a key after 6.
const OUTBOX = { maxEntries: 200, maxAgeMs: 6 * 24 * 60 * 60 * 1000, firstMs: 5000, maxMs: 120000 };
const JOURNAL_MAX = 200;
const REQUEST_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const PHASES = ['CLAIM', 'ACQUIRED', 'PRINT_INTENT', 'REPORT', 'REVIEW'];
function backoff(n, first, max) { return Math.min(max, first * 2 ** Math.min(Math.max(0, n - 1), 20)); }
// A failure that provably happened before anything reached the renderer/spooler.
class NotPrinted extends Error { constructor(message) { super(message); this.notPrinted = true; } }
function jobSummary(j) {
  const s = v => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 255) : (Number.isSafeInteger(v) ? v : null);
  return j && typeof j === 'object' ? { itemId: s(j.itemId), packageId: s(j.packageId), attemptNumber: s(j.attemptNumber), printer: s(j.printer) } : null;
}
class ReviewJournal {
  constructor({ load, save, now = Date.now }) { Object.assign(this, { save, now }); const v = load(); this.items = Array.isArray(v) ? v : []; }
  add(message, job) {
    const items = [...this.items, { at: new Date(this.now()).toISOString(), message: cleanError(message), job: jobSummary(job) }].slice(-JOURNAL_MAX);
    this.save(items); this.items = items;
  }
  clear() { this.save([]); this.items = []; }
}
class ResultOutbox {
  constructor({ load, save, now = Date.now }) { Object.assign(this, { save, now }); const v = load(); this.items = Array.isArray(v) ? v.filter(e => e && typeof e === 'object') : []; }
  write(items) { this.save(items); this.items = items; }
  // Backpressure, not loss: when full, no new jobs are claimed; finished results are always kept.
  full() { return this.items.length >= OUTBOX.maxEntries; }
  add(entry) {
    const dup = this.items.some(e => e.key === entry.key || (e.job && entry.job && e.job.itemId === entry.job.itemId && e.body && entry.body && e.body.claimToken === entry.body.claimToken));
    if (dup) return false;
    this.write([...this.items, { key: entry.key, job: entry.job, body: entry.body, createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : this.now(), attempts: 0, nextAt: 0 }]);
    return true;
  }
  update(key, patch) { this.write(this.items.map(e => e.key === key ? { ...e, ...patch } : e)); }
  remove(key) { this.write(this.items.filter(e => e.key !== key)); }
}
function checkResult(e, config, now) {
  must(e && typeof e.key === 'string' && REQUEST_KEY.test(e.key) && e.job && e.body, 'Invalid saved result entry.');
  validateJob(e.job, config, Math.min(now, Date.parse(e.job.leaseExpiresAt) - 1));
  must(typeof e.body.success === 'boolean' && e.body.printer === e.job.printer && e.body.claimToken === e.job.claimToken
    && Number.isFinite(Date.parse(e.body.submittedAt)) && (e.body.success || typeof e.body.error === 'string'), 'Invalid saved result body.');
}
class Worker {
  constructor({ config, api, load, save, printer, preflight = async () => {}, outbox, journal, now = Date.now, log = () => {}, retry = PRINT_RETRY }) {
    must(outbox instanceof ResultOutbox && journal instanceof ReviewJournal, 'Durable result outbox and review journal are required.');
    Object.assign(this, { config, api, load, save, printer, preflight, outbox, journal, now, log, retry });
    this.state = load() || null; this.unsaved = null; this.options = { credentialOk: true };
  }
  persist(s) { this.save(s); this.state = s; }
  review(message, job) { this.journal.add(message, job); this.log('REVIEW: ' + cleanError(message)); }
  error() {
    const parts = [], n = this.journal.items.length, waiting = this.outbox.items.filter(e => e.attempts > 0).length;
    if (n) parts.push(n + ' print record(s) need REVIEW (REVIEW-UNCERTAIN-PRINT.cmd with the service stopped). Latest: ' + this.journal.items[n - 1].message);
    if (waiting) parts.push(waiting + ' print result(s) awaiting server confirmation; resending unchanged.');
    if (this.state && this.state.phase === 'ACQUIRED' && this.state.lastError) parts.push('Printer retry pending: ' + this.state.lastError);
    return parts.length ? cleanError(parts.join(' ')) : null;
  }
  failure(job, message) { return { claimToken: job.claimToken, success: false, submittedAt: new Date(this.now()).toISOString(), printer: job.printer, error: cleanError(message) }; }
  // Durable handoff of a finished job: outbox first, then clear the job slot. If the disk write
  // fails the result stays in memory and is retried; the renderer is never run again for it.
  handoff(entry) {
    this.unsaved = entry;
    this.outbox.add(entry);
    this.persist(null);
    this.unsaved = null;
  }
  async finish(job, body) { this.handoff({ key: key('result'), job, body, createdAt: this.now() }); await this.flush(); }
  settle(e, message) { this.review(message, e.job); this.outbox.remove(e.key); }
  // Re-send every due result until acknowledged. Never throws for delivery problems.
  async flush() {
    const credentialOk = this.options.credentialOk !== false;
    for (const e of [...this.outbox.items]) {
      const now = this.now();
      if (Number.isFinite(e.nextAt) && e.nextAt > now) continue;
      const expected = e.body && e.body.success ? 'PRINTED' : 'FAILED';
      if (!Number.isFinite(e.createdAt) || now - e.createdAt > OUTBOX.maxAgeMs) { this.settle(e, 'A ' + expected + ' result was not acknowledged within 6 days and was moved to review instead of being resent.'); continue; }
      try { checkResult(e, this.config, now); } catch (err) { this.settle(e, 'Saved print result failed validation and was not sent: ' + cleanError(err)); continue; }
      let response;
      try { response = await this.api.report(e.job, e.body, e.key); }
      catch (err) {
        if ([400, 404, 409, 410].includes(err.status) || ([401, 403].includes(err.status) && credentialOk)) {
          this.settle(e, 'Print result could not be finalized (' + err.status + '). Server refused the ' + expected + ' result; verify this package before retrying. The PDF will not be printed again automatically.'); continue;
        }
        const attempts = (e.attempts || 0) + 1, delay = backoff(attempts, OUTBOX.firstMs, OUTBOX.maxMs);
        this.outbox.update(e.key, { attempts, nextAt: now + delay, lastError: cleanError(err) });
        this.log('Print result for job ' + (e.job && e.job.itemId) + ' not delivered (attempt ' + attempts + '): ' + cleanError(err) + ' Resending the same result in ' + Math.round(delay / 1000) + 's.');
        return; // server/network unavailable: keep order, try again later
      }
      const item = response && Array.isArray(response.items) && response.items.find(x => x && x.id === e.job.itemId);
      if (item && item.status === expected) { this.outbox.remove(e.key); this.log('Job ' + e.job.itemId + ': server confirmed ' + expected + '.'); continue; }
      this.settle(e, 'Server did not confirm the expected ' + expected + ' result (server shows ' + (item && typeof item.status === 'string' ? item.status.slice(0, 20) : 'no matching item') + '). Check expired lease or package history before retrying.');
    }
  }
  // claim: may request a NEW job. print: may progress an acquired job (false while heartbeats fail,
  // e.g. after a gate-mapping change). Results are flushed and interruptions reported regardless.
  async tick({ claim = true, print = claim, credentialOk = true } = {}) {
    this.options = { credentialOk };
    if (this.unsaved) this.handoff(this.unsaved);
    await this.flush();
    let s = this.state;
    if (s && !PHASES.includes(s.phase)) { this.review('Unrecognized durable job state was discarded. No printing attempted.', s.job); this.persist(null); return; }
    if (s && s.phase === 'REVIEW') { this.review('Archived V4R6 review hold: ' + cleanError(s.message), s.job); this.persist(null); return; }
    if (s && s.phase === 'REPORT') { // V4R6 pending result: move it, unchanged, into the outbox
      if (s.key && s.job && s.body) this.handoff({ key: s.key, job: s.job, body: s.body, createdAt: this.now() });
      else { this.review('Invalid saved V4R6 result state was not sent.', s.job); this.persist(null); }
      await this.flush(); return;
    }
    if (s && s.phase === 'PRINT_INTENT') {
      this.log('Job ' + (s.job && s.job.itemId) + ': uncertain print after an interruption. Reporting FAILED; no automatic reprint.');
      if (!s.job || typeof s.job.claimToken !== 'string') { this.review('Invalid saved print intent discarded. No printing attempted.', s.job); this.persist(null); return; }
      return this.finish(s.job, this.failure(s.job, 'Print outcome uncertain after an interruption (service stopped or restarted while printing). Inspect the gate printer before any guard retry. No automatic reprint.'));
    }
    if (!s) {
      if (!claim || this.outbox.full()) return;
      s = { phase: 'CLAIM', key: key('claim'), createdAt: this.now(), body: { routes: [this.config.route], agentVersion: VERSION } };
      this.persist(s);
    }
    if (s.phase === 'CLAIM') {
      if (!Number.isFinite(s.createdAt) || !s.body || !Array.isArray(s.body.routes) || s.body.routes.length !== 1 || s.body.routes[0] !== this.config.route || !CONFIG_VERSIONS.includes(s.body.agentVersion) || typeof s.key !== 'string' || !REQUEST_KEY.test(s.key)) {
        this.review('Invalid saved claim state discarded; no request was replayed.'); this.persist(null); return;
      }
      // Server claim replay retention is 30 minutes. Do not replay an older request.
      if (this.now() - s.createdAt > 25 * 60 * 1000) { this.review('A print claim remained unconfirmed for more than 25 minutes and was not replayed. Any job it leased expires on the server as FAILED (no automatic reprint).'); this.persist(null); return; }
      if (!claim) return;
      const r = await this.api.claim(s.body, s.key); // transport failure: same key/body replayed next tick
      must(r && Object.prototype.hasOwnProperty.call(r, 'job'), 'Invalid job-claim response.');
      if (!r.job) { this.persist(null); return; }
      try { validateJob(r.job, this.config, this.now()); }
      catch (e) { this.review('Offered job failed validation and was not downloaded or printed: ' + cleanError(e), r.job); this.persist(null); return; }
      s = { phase: 'ACQUIRED', job: r.job, tries: 0 }; this.persist(s);
    }
    if (s.phase === 'ACQUIRED' && print) return this.printAcquired(s);
  }
  async retryOrFail(s, e) {
    const tries = (Number.isSafeInteger(s.tries) ? s.tries : 0) + 1, now = this.now(), delay = backoff(tries, this.retry.firstMs, this.retry.maxMs), why = cleanError(e);
    if (tries < this.retry.maxTries && Date.parse(s.job.leaseExpiresAt) - (now + delay) > this.retry.leaseReserveMs) {
      this.persist({ phase: 'ACQUIRED', job: s.job, tries, retryAt: now + delay, lastError: why });
      this.log('Job ' + s.job.itemId + ': printer not ready (check ' + tries + '): ' + why + ' Nothing was sent to the printer; retrying in ' + Math.round(delay / 1000) + 's.');
      return;
    }
    this.log('Job ' + s.job.itemId + ': printer still not ready after ' + tries + ' check(s); reporting FAILED (not printed).');
    return this.finish(s.job, this.failure(s.job, 'Not printed: gate printer was not ready after ' + tries + ' check(s); nothing was sent to the printer. ' + why));
  }
  async printAcquired(s) {
    const job = s.job;
    if (Number.isFinite(s.retryAt) && this.now() < s.retryAt) return; // bounded backoff; loop keeps running
    try {
      validateJob(job, this.config, this.now());
      must(Date.parse(job.leaseExpiresAt) - this.now() > 25000, 'Too little lease time remains to start printing.');
    } catch (e) { return this.finish(job, this.failure(job, e.message)); }
    let bytes;
    try { await this.preflight(job); } catch (e) { return this.retryOrFail(s, e); }
    try { bytes = await this.api.pdf(job); }
    catch (e) { if (e instanceof HttpFailure && e.status < 500 && e.status !== 429) return this.finish(job, this.failure(job, e.message)); return this.retryOrFail(s, e); }
    try {
      verifyPdf(bytes, job);
      must(Date.parse(job.leaseExpiresAt) - this.now() > 20000, 'Lease almost expired during PDF download; printing not started.');
      this.persist({ ...s, phase: 'PRINT_INTENT' });
    } catch (e) { return this.finish(job, this.failure(job, e.message)); }
    let result;
    try {
      await this.printer(bytes, job);
      result = { claimToken: job.claimToken, success: true, submittedAt: new Date(this.now()).toISOString(), printer: job.printer };
    } catch (e) {
      if (e && e.notPrinted === true) return this.retryOrFail(s, e); // renderer never started
      this.log('Job ' + job.itemId + ': uncertain print (' + cleanError(e) + '). Reporting FAILED; no automatic reprint.');
      result = this.failure(job, 'Print outcome uncertain: ' + cleanError(e) + '. Inspect the gate printer before any guard retry. No automatic reprint.');
    }
    return this.finish(job, result);
  }
}
function printProcess(exe, args, timeout, spawnFn = spawn) {
  return new Promise((resolve,reject)=>{
    let child;
    try { child = spawnFn(exe,args,{windowsHide:true,shell:false,stdio:'ignore'}); } catch { reject(new NotPrinted('Print renderer could not start')); return; }
    let finished = false;
    const timer = setTimeout(()=>{ if (!finished) { finished=true; child.kill(); reject(new Error('Print renderer timed out; outcome uncertain')); } },timeout);
    child.once('error',()=>{ if(!finished){finished=true;clearTimeout(timer);reject(new NotPrinted('Print renderer could not start'));} });
    child.once('exit',(code)=>{ if(!finished){finished=true;clearTimeout(timer);if(code===0)resolve();else reject(new Error('Print renderer exited with code '+code));} });
  });
}
// Per-gate reachability from a native probe. Identity problems still throw; an unreachable gate does not.
function accessibleGates(config, r) {
  must(r && r.sid === 'S-1-5-18' && typeof r.machine === 'string' && r.machine.toUpperCase() === config.hostName, 'Printer check did not run as LocalSystem on the intended host.');
  must(Array.isArray(r.gates) && r.gates.length === 2, 'Invalid printer probe result.');
  const ok = [], down = [];
  for (const p of config.printers) {
    const a = r.gates.filter(g => g && g.gate === p.gate && g.printer === p.printer);
    if (a.length === 1 && a[0].accessible === true) ok.push(p);
    else down.push({ ...p, win32Error: a[0] && Number.isSafeInteger(a[0].win32Error) ? a[0].win32Error : 'unknown' });
  }
  return { ok, down };
}

function routingConfig(r) {
  must(r && r.contract==='truck-log-dual-gate-v1' && r.claimUsesAdvertisedPrinters===true && r.frozenPrinterRequired===true, 'Deploy V31R12 server routing support before installing the dual-gate service.');
  must(r.configurationValid===true, 'Server identity/route or claim signing is not configured.');
  must(/^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(r.agentId) && typeof r.route==='string' && r.route.trim()===r.route && r.route.length>0 && r.route.length<=120 && !/[\x00-\x1f\x7f]/.test(r.route), 'Invalid server routing identity.');
  must(Array.isArray(r.gates)&&r.gates.length===2,'Two saved gate mappings are required.');
  const printers=['EAST','WEST'].map(gate=>{
    const matches=r.gates.filter(g=>g.gate===gate);must(matches.length===1,'Missing or duplicate gate mapping: '+gate);
    const g=matches[0];must(g.configured===true && typeof g.printer==='string' && g.printer.trim()===g.printer && g.printer.length>0 && g.printer.length<=255 && !/[\x00-\x1f\x7f]/.test(g.printer),'Save the '+gate+' printer on the webpage first.');
    return {gate,printer:g.printer,sourceQueue:'USFTWLDAPP - '+gate+' Gate RXO'};
  });
  must(printers[0].printer.toLowerCase()!==printers[1].printer.toLowerCase(),'Gate mappings must be different.');
  return {agentId:r.agentId,route:r.route,printers};
}
function mappingMatches(r,c) { try{const p=routingConfig(r);return p.agentId===c.agentId&&p.route===c.route&&p.printers.every(g=>c.printers.some(v=>v.gate===g.gate&&v.printer===g.printer));}catch{return false;} }
function renderArgs(printer,file,dataDir) { return ['-silent','-appdata',path.join(dataDir,'renderer'),'-print-to',printer,'-print-settings','fit,1x',file]; }

module.exports={routingConfig,mappingMatches,renderArgs,VERSION,MAX_PDF,GUID,must,sha,key,cleanError,apiBase,validConfig,validateJob,verifyPdf,exactOnline,atomicWrite,Api,Worker,HttpFailure,printProcess,CONFIG_VERSIONS,PRINT_RETRY,OUTBOX,backoff,NotPrinted,ReviewJournal,ResultOutbox,accessibleGates};
