// GENERATED from libs/truck-log/server/auth/admin/src/lib/admin-security.ts by tools/truck-log/build-admin-auth-core.mjs. Do not edit.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminFault = exports.MAX_PASSWORD = exports.MIN_PASSWORD = exports.SESSION_HOURS = exports.SESSION_IDLE_MINUTES = exports.ADMIN_CSRF_HEADER = exports.ADMIN_REQUEST_HEADER = exports.ADMIN_LOGIN_VERSION = exports.ADMIN_HTTP_COOKIE = exports.ADMIN_COOKIE = exports.ADMIN_VERSION = void 0;
exports.cookieName = cookieName;
exports.sessionHash = sessionHash;
exports.fail = fail;
exports.sha256 = sha256;
exports.equalSecret = equalSecret;
exports.loginIdentifier = loginIdentifier;
exports.username = username;
exports.email = email;
exports.displayName = displayName;
exports.password = password;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.freshToken = freshToken;
exports.csrfFor = csrfFor;
exports.cookieToken = cookieToken;
exports.sessionCookie = sessionCookie;
exports.clearCookie = clearCookie;
exports.header = header;
exports.transportConfig = transportConfig;
exports.requireTransport = requireTransport;
exports.requireCsrf = requireCsrf;
/** Independent administrator accounts; no Dana Apps identity link. */
const node_crypto_1 = require("node:crypto");
const node_net_1 = require("node:net");
exports.ADMIN_VERSION = 'truck-log-admin-v1';
exports.ADMIN_COOKIE = '__Host-TruckLogAdmin';
exports.ADMIN_HTTP_COOKIE = 'TruckLogAdminHTTP';
exports.ADMIN_LOGIN_VERSION = 'truck-log-admin-login-v1';
// Explicit opt-in transport; HTTPS remains the default. Never infer HTTP consent from a failed TLS check.
function cookieName(config) { return config?.mode === 'internal-http' ? exports.ADMIN_HTTP_COOKIE : exports.ADMIN_COOKIE; }
function sessionHash(token, config) {
    return config?.mode === 'internal-http' ? sha256('internal-http\n' + config.origin + '\n' + token) : sha256(token);
}
exports.ADMIN_REQUEST_HEADER = 'x-trucklog-admin-request';
exports.ADMIN_CSRF_HEADER = 'x-trucklog-admin-csrf';
exports.SESSION_IDLE_MINUTES = 30;
exports.SESSION_HOURS = 8;
exports.MIN_PASSWORD = 15;
exports.MAX_PASSWORD = 128;
class AdminFault extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'AdminFault';
    }
}
exports.AdminFault = AdminFault;
function fail(status, code, message) { throw new AdminFault(status, code, message); }
function sha256(value) { return (0, node_crypto_1.createHash)('sha256').update(value, 'utf8').digest('hex'); }
function equalSecret(a, b) {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && (0, node_crypto_1.timingSafeEqual)(x, y);
}
function loginIdentifier(value) {
    if (typeof value !== 'string' || value.length > 254)
        return '';
    return value.trim().toLowerCase();
}
function username(value) {
    const result = loginIdentifier(value);
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(result))
        fail(400, 'ADMIN_USERNAME', 'Username must contain 3–40 letters, digits, dots, underscores, or hyphens.');
    return result;
}
function email(value) {
    if (value === undefined || value === null || value === '')
        return null;
    const result = loginIdentifier(value);
    if (!result || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) || /[\x00-\x1f\x7f]/.test(result))
        fail(400, 'ADMIN_EMAIL', 'Enter a valid email address, or leave it blank.');
    return result;
}
function displayName(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 120 || /[\x00-\x1f\x7f]/.test(value))
        fail(400, 'ADMIN_NAME', 'Display name is required (1–120 characters).');
    return value.trim();
}
function password(value) {
    if (typeof value !== 'string')
        fail(400, 'ADMIN_PASSWORD_POLICY', 'Use a password containing 15–128 characters.');
    const result = value.normalize('NFC');
    if ([...result].length < exports.MIN_PASSWORD || [...result].length > exports.MAX_PASSWORD || Buffer.byteLength(result, 'utf8') > 512 || /[\x00-\x1f\x7f]/.test(result))
        fail(400, 'ADMIN_PASSWORD_POLICY', 'Use a password containing 15–128 characters; spaces are allowed.');
    const blocked = new Set(['passwordpassword', 'password123456789', '123456789012345', 'qwertyuiopasdfgh', 'trucklogpassword', 'administrator123']);
    if (blocked.has(result.toLowerCase()))
        fail(400, 'ADMIN_PASSWORD_POLICY', 'Choose a less common password.');
    return result;
}
// scrypt uses 64 MiB per hash: run at most two at once and queue the rest briefly
// instead of turning genuine sign-ins away.
let activeHashes = 0;
const hashQueue = [];
async function hashSlot() {
    if (activeHashes < 2) {
        activeHashes++;
        return;
    }
    if (hashQueue.length >= 20)
        fail(429, 'ADMIN_HASH_BUSY', 'Administrator authentication is busy. Try again shortly.');
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const index = hashQueue.indexOf(grant);
            if (index >= 0)
                hashQueue.splice(index, 1);
            reject(new AdminFault(429, 'ADMIN_HASH_BUSY', 'Administrator authentication is busy. Try again shortly.'));
        }, 15000);
        const grant = () => { clearTimeout(timer); resolve(); };
        hashQueue.push(grant);
    });
}
function releaseHashSlot() {
    const next = hashQueue.shift();
    if (next)
        next();
    else
        activeHashes--;
}
async function derive(value, salt) {
    await hashSlot();
    try {
        return await new Promise((resolve, reject) => (0, node_crypto_1.scrypt)(value, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
    }
    finally {
        releaseHashSlot();
    }
}
async function hashPassword(value) {
    const normalized = password(value), salt = (0, node_crypto_1.randomBytes)(16).toString('hex');
    return `scrypt-v1$${salt}$${(await derive(normalized, salt)).toString('hex')}`;
}
async function verifyPassword(value, encoded) {
    // Fixed-cost dummy verification for unknown/disabled accounts and malformed stored values.
    const parts = typeof encoded === 'string' && /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded) ? encoded.split('$') : null;
    const usable = typeof value === 'string' && [...value].length <= exports.MAX_PASSWORD && Buffer.byteLength(value, 'utf8') <= 512;
    const raw = usable ? value.normalize('NFC') : 'invalid password input';
    const result = await derive(raw, parts ? parts[1] : '00000000000000000000000000000000');
    const wanted = Buffer.from(parts ? parts[2] : '0'.repeat(128), 'hex');
    return (0, node_crypto_1.timingSafeEqual)(result, wanted) && !!parts && usable;
}
function freshToken() { return (0, node_crypto_1.randomBytes)(32).toString('hex'); }
function csrfFor(token) { return (0, node_crypto_1.createHmac)('sha256', token).update(exports.ADMIN_VERSION + ':csrf').digest('hex'); }
function cookieToken(raw, config) {
    if (typeof raw !== 'string' || raw.length > 8192)
        return null;
    const name = cookieName(config);
    const values = raw.split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
    if (values.length !== 1)
        return null;
    const value = values[0].slice(name.length + 1);
    return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function sessionCookie(token, config) {
    if (!/^[a-f0-9]{64}$/.test(token))
        throw new Error('Invalid session-token encoding');
    return `${cookieName(config)}=${token}; Path=/;${config?.mode === 'internal-http' ? '' : ' Secure;'} HttpOnly; SameSite=Strict; Max-Age=${exports.SESSION_HOURS * 3600}`;
}
function clearCookie(config) { return `${cookieName(config)}=; Path=/;${config?.mode === 'internal-http' ? '' : ' Secure;'} HttpOnly; SameSite=Strict; Max-Age=0`; }
function header(req, name) {
    const value = req.headers[name.toLowerCase()];
    return typeof value === 'string' ? value : '';
}
function ip(value) { return value.startsWith('::ffff:') ? value.slice(7) : value; }
function transportConfig(env) {
    const raw = env.TRUCK_LOG_ADMIN_ORIGIN || '';
    const setting = env.TRUCK_LOG_ADMIN_TRANSPORT || 'https';
    const mode = setting === 'internal-http' ? 'internal-http' : 'https';
    const validMode = setting === 'https' || setting === 'internal-http';
    let origin = '';
    try {
        const u = new URL(raw);
        if (u.protocol === (mode === 'internal-http' ? 'http:' : 'https:') && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash && raw.replace(/\/$/, '') === u.origin)
            origin = u.origin;
    }
    catch { /* unavailable until explicitly configured */ }
    const proxyKey = env.TRUCK_LOG_ADMIN_PROXY_KEY || '';
    const proxyIps = (env.TRUCK_LOG_ADMIN_PROXY_IPS || '').split(',').map(x => ip(x.trim())).filter(Boolean);
    return { mode, enabled: validMode && env.TRUCK_LOG_ADMIN_ENABLED === 'true', origin: validMode ? origin : '',
        proxyKey: /^[a-f0-9]{64}$/.test(proxyKey) ? proxyKey : '',
        proxyIps: proxyIps.length && proxyIps.every(x => (0, node_net_1.isIP)(x)) ? proxyIps : [] };
}
function requireTransport(req, config, mutation) {
    if (!config.enabled || !config.origin)
        fail(503, 'ADMIN_SETUP_REQUIRED', 'Truck Log Admin sign-in is not enabled. Connection mode and local account setup are required.');
    const peer = ip(req.socket.remoteAddress || '');
    const directTls = req.socket.encrypted === true;
    const trustedProxy = !!config.proxyKey && config.proxyIps.includes(peer)
        && equalSecret(header(req, 'x-trucklog-admin-proxy-key'), config.proxyKey)
        && header(req, 'x-forwarded-proto') === 'https';
    if (config.mode === 'internal-http') {
        // Config is set locally by an operator, not by a request header or the browser.
        // Cookie/session namespaces are distinct from HTTPS. This does not encrypt HTTP traffic.
        if (directTls || trustedProxy)
            fail(403, 'ADMIN_TRANSPORT_MISMATCH', 'Use the configured Truck Log sign-in address.');
        const fetchSite = header(req, 'sec-fetch-site');
        if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')
            fail(403, 'ADMIN_ORIGIN', 'Administrator requests must use the configured Truck Log origin.');
    }
    else if (!directTls && !trustedProxy)
        fail(403, 'ADMIN_HTTPS_REQUIRED', 'A verified HTTPS connection is required for Truck Log Admin.');
    const origin = header(req, 'origin');
    if ((mutation || origin) && origin !== config.origin)
        fail(403, 'ADMIN_ORIGIN', 'Administrator requests must use the configured Truck Log origin.');
    if (mutation && header(req, exports.ADMIN_REQUEST_HEADER) !== '1')
        fail(403, 'ADMIN_REQUEST_REQUIRED', 'Administrator request verification is missing.');
    // Never accept general X-Forwarded-For supplied through the publicly accessible API.
    const assertedClient = ip(header(req, 'x-trucklog-admin-client-ip'));
    return trustedProxy && (0, node_net_1.isIP)(assertedClient) ? assertedClient : peer || 'unknown-peer';
}
function requireCsrf(req, token) {
    if (!equalSecret(header(req, exports.ADMIN_CSRF_HEADER), csrfFor(token)))
        fail(403, 'ADMIN_CSRF', 'Administrator request verification failed. Refresh this page and try again.');
}
