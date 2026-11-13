// Behavioral regressions against the real decoder and authentication methods.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as zlib from 'node:zlib';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(relative, overrides = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(relative, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
  } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => overrides[name] ?? require(name),
    Buffer, process, setTimeout, clearTimeout, URL, console }, { filename: relative });
  return module.exports;
}
let count = 0;
async function test(name, action) { await action(); count++; console.log('[PASS] ' + name); }
const dir = 'libs/truck-log/server/feature/visits/src/lib/';
const calls = [];
const decoder = load(dir + 'packing-slip-pdf-streams.ts', { 'node:zlib': {
  inflateSync: (buffer, options) => { calls.push(options?.maxOutputLength); return zlib.inflateSync(buffer, options); },
  inflateRawSync: (buffer, options) => { calls.push(options?.maxOutputLength); return zlib.inflateRawSync(buffer, options); },
} });
const stream = (bytes, filter = '/FlateDecode') => Buffer.concat([
  Buffer.from(`\n1 0 obj\n<< /Filter ${filter} >>\nstream\n`), bytes, Buffer.from('\nendstream\nendobj\n'),
]);
const pdf = (...streams) => Buffer.concat([Buffer.from('%PDF-1.7\n'), ...streams, Buffer.from('%%EOF\n')]);
await test('zlib and raw deflate streams preserve legitimate text', () => {
  const text = Buffer.from('BT (Delivery 12345678) Tj ET');
  for (const compress of [zlib.deflateSync, zlib.deflateRawSync]) {
    const result = decoder.decodedPdfStreams(pdf(stream(compress(text))));
    assert.equal(result.length, 1); assert.equal(result[0].toString(), text.toString());
  }
});
await test('compressed oversized output is rejected by zlib before full allocation, without raw retry', () => {
  const compressed = zlib.deflateSync(Buffer.alloc(65 * 1024 * 1024, 65));
  const before = calls.length;
  assert.throws(() => decoder.decodedPdfStreams(pdf(stream(compressed))), /safe decoding limit/);
  assert.equal(calls.length - before, 1);
  assert.equal(calls.at(-1), 64 * 1024 * 1024);
});
await test('bad-checksum Flate expansion aborts immediately without retry or later-stream work', () => {
  const corrupted = zlib.deflateSync(Buffer.alloc(24 * 1024 * 1024, 65));
  corrupted[corrupted.length - 1] ^= 0xff;
  const before = calls.length;
  assert.throws(() => decoder.decodedPdfStreams(pdf(...Array.from({ length: 6 }, () => stream(corrupted)))), /unreadable compressed stream/);
  assert.equal(calls.length - before, 1);
});
await test('compressed payload whitespace tails survive the stream separator', () => {
  for (const tail of [0x09, 0x0a, 0x0d, 0x20]) {
    let original, compressed;
    for (let length = 0; length < 256; length++) {
      original = Buffer.from('BT (Delivery 12345678' + 'A'.repeat(length) + ') Tj ET');
      compressed = zlib.deflateSync(original);
      if (compressed.at(-1) === tail) break;
    }
    assert.equal(compressed.at(-1), tail, 'fixture has the requested compressed whitespace tail');
    for (const separator of ['\n', '\r\n']) {
      const encoded = Buffer.concat([Buffer.from('\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n'), compressed,
        Buffer.from(separator + 'endstream\nendobj\n')]);
      const decoded = decoder.decodedPdfStreams(pdf(encoded));
      assert.equal(decoded.length, 1);
      assert.equal(decoded[0].toString(), original.toString());
    }
  }
});
await test('multiple streams share the remaining expanded byte budget', () => {
  const compressed = zlib.deflateSync(Buffer.alloc(33 * 1024 * 1024, 65));
  assert.throws(() => decoder.decodedPdfStreams(pdf(stream(compressed), stream(compressed))), /safe decoding limit/);
  assert.equal(calls.at(-1), 31 * 1024 * 1024);
});
await test('intermediate filter output is bounded even if a later filter would shrink it', () => {
  const compressed = zlib.deflateSync(Buffer.alloc(65 * 1024 * 1024, 65));
  assert.throws(() => decoder.decodedPdfStreams(pdf(stream(compressed, '[/FlateDecode /ASCIIHexDecode]'))), /safe decoding limit/);
});
await test('stream limit counts unsupported/malformed payloads, rather than only accepted results', () => {
  assert.throws(() => decoder.decodedPdfStreams(pdf(...Array.from({ length: 501 }, () => stream(Buffer.from('bad'), '/Unsupported')))), /safe decoding limit/);
});
await test('ASCII85 and ASCIIHex filters preserve normal small streams', () => {
  assert.equal(decoder.decodedPdfStreams(pdf(stream(Buffer.from('7a>'), '/ASCIIHexDecode')))[0].toString(), 'z');
  assert.deepEqual([...decoder.decodedPdfStreams(pdf(stream(Buffer.from('<~z~>'), '/ASCII85Decode')))[0]], [0, 0, 0, 0]);
});
const authDir = 'libs/truck-log/server/auth/admin/src/lib/';
const security = load(authDir + 'admin-security.ts');
const old = { ...process.env };
process.env.TRUCK_LOG_ADMIN_ENABLED = 'true';
process.env.TRUCK_LOG_ADMIN_TRANSPORT = 'internal-http';
process.env.TRUCK_LOG_ADMIN_ORIGIN = 'http://truck.test:4300';
const { TruckLogAdminService } = load(authDir + 'admin-auth.service.ts', {
  './admin-security': { ...security, verifyPassword: async () => false },
  '@truck-log/server/data-access': { returnedRows: value => value },
});
const request = extra => ({ socket: { remoteAddress: '192.0.2.10' }, method: 'POST', headers: {
  origin: 'http://truck.test:4300', 'x-trucklog-admin-request': '1', ...extra,
} });
await test('actual login throttle cannot be changed by forged forwarded IP headers', async () => {
  const buckets = [];
  const db = { query: async (sql, args) => {
    if (sql.includes('schema_version')) return [{ version: security.ADMIN_VERSION }];
    if (sql.startsWith('INSERT INTO truck_log_admin.login_limits')) buckets.push(args[0]);
    return [];
  } };
  const service = new TruckLogAdminService(db);
  for (const ip of ['203.0.113.1', '203.0.113.2']) {
    await assert.rejects(service.login(request({ 'x-real-ip': ip, 'x-forwarded-for': ip,
      'x-trucklog-admin-client-ip': ip }), { identifier: 'unknown-' + ip, password: 'invalid' }), /incorrect/);
  }
  assert.equal(buckets[0], security.sha256('client:192.0.2.10'));
  assert.equal(buckets[0], buckets[2]);
});
await test('HTTPS client assertions require both a trusted peer and its shared key', () => {
  const config = security.transportConfig({ TRUCK_LOG_ADMIN_ENABLED: 'true', TRUCK_LOG_ADMIN_TRANSPORT: 'https',
    TRUCK_LOG_ADMIN_ORIGIN: 'https://truck.test', TRUCK_LOG_ADMIN_PROXY_KEY: 'a'.repeat(64),
    TRUCK_LOG_ADMIN_PROXY_IPS: '172.30.43.10' });
  const req = { socket: { remoteAddress: '172.30.43.10' }, method: 'POST', headers: {
    origin: 'https://truck.test', 'x-trucklog-admin-request': '1', 'x-forwarded-proto': 'https',
    'x-trucklog-admin-proxy-key': 'a'.repeat(64), 'x-trucklog-admin-client-ip': '192.0.2.15',
  } };
  assert.equal(security.requireTransport(req, config, true), '192.0.2.15');
  assert.throws(() => security.requireTransport({ ...req, socket: { remoteAddress: '192.0.2.1' } }, config, true), /verified HTTPS/);
  assert.throws(() => security.requireTransport({ ...req, headers: { ...req.headers, 'x-trucklog-admin-proxy-key': 'b'.repeat(64) } }, config, true), /verified HTTPS/);
});
for (const key of ['TRUCK_LOG_ADMIN_ENABLED', 'TRUCK_LOG_ADMIN_TRANSPORT', 'TRUCK_LOG_ADMIN_ORIGIN']) {
  if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
}
console.log(`[PASS] Security behavior: ${count} cases.`);
