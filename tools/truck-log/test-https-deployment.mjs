// Default: no Docker or network. --compose validates the merged config with the
// real Compose CLI; --nginx also validates the rendered TLS config in Nginx.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const auth = require('./admin-auth-core.cjs');
const read = file => fs.readFileSync(file, 'utf8');
const base = read('docker-compose.yml');
const overlay = read('docker-compose.https.yml');
const plain = read('docker/truck-log/nginx.conf');
const template = read('docker/truck-log/nginx.https.conf.template');
const startup = read('docker/truck-log/start-https.sh');
const key = 'a'.repeat(64); // Public synthetic fixture, never an operator key.
let cases = 0;
function test(name, action) { action(); cases++; console.log(`[PASS] ${name}`); }
function run(file, args, env = process.env) {
  const result = spawnSync(file, args, { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, `${file} failed: ${result.error?.message || result.stderr}`);
  return result.stdout;
}

test('base keeps configurable HTTP compatibility and host-only API by default', () => {
  assert.match(base, /TRUCK_LOG_ADMIN_TRANSPORT: "\$\{TRUCK_LOG_ADMIN_TRANSPORT:-internal-http\}"/);
  assert.match(base, /\$\{TRUCK_LOG_API_BIND_ADDRESS:-127\.0\.0\.1\}:\$\{TRUCK_LOG_API_PORT:-3334\}:3334/);
  assert.match(read('.env.example'), /^TRUCK_LOG_ADMIN_TRANSPORT=internal-http$/m);
  assert.match(base, /wget -Y off -q -O \/dev\/null http:\/\/127\.0\.0\.1\//, 'base liveness bypasses inherited proxies only for localhost');
  assert.match(read('docker/truck-log/web.Dockerfile'), /wget -Y off -q -O \/dev\/null http:\/\/127\.0\.0\.1\//, 'image liveness bypasses inherited proxies only for localhost');
});
test('TLS overlay replaces HTTP ports and trusts only the dedicated proxy peer', () => {
  assert.match(overlay, /ports: !override\n\s+- "\$\{TRUCK_LOG_TLS_PORT:-443\}:443"/);
  assert.match(overlay, /TRUCK_LOG_ADMIN_TRANSPORT: https/);
  assert.match(overlay, /TRUCK_LOG_ADMIN_PROXY_IPS: "\$\{TRUCK_LOG_TLS_PROXY_IP:-172\.30\.43\.10\}"/);
  assert.match(overlay, /ipv4_address: "\$\{TRUCK_LOG_TLS_PROXY_IP:-172\.30\.43\.10\}"/);
  assert.match(overlay, /aliases: \[truck-log-api-tls\]/);
  assert.match(overlay, /create_host_path: false/);
  assert.match(overlay, /read_only: true/);
  assert.match(overlay, /wget -Y off -q -O \/dev\/null http:\/\/127\.0\.0\.1:8080\/healthz/);
});
test('proxy assertions are overwritten and only the key is substituted', () => {
  for (const [header, value] of [
    ['X-Forwarded-Proto', 'https'], ['X-Forwarded-For', '$remote_addr'],
    ['X-TruckLog-Admin-Client-IP', '$remote_addr'],
    ['X-TruckLog-Admin-Proxy-Key', '"${TRUCK_LOG_ADMIN_PROXY_KEY}"'],
  ]) assert.ok(template.includes(`proxy_set_header ${header} ${value};`));
  assert.ok(template.includes('set $truck_log_api_backend truck-log-api-tls:3334;'));
  assert.ok(plain.includes('proxy_set_header X-TruckLog-Admin-Proxy-Key "";'));
  assert.ok(plain.includes('proxy_set_header X-TruckLog-Admin-Client-IP "";'));
  assert.ok(startup.includes("envsubst '${TRUCK_LOG_ADMIN_PROXY_KEY}'"));
  assert.ok(!template.includes('$proxy_add_x_forwarded_for'));
  assert.match(template, /listen 443 ssl;/);
  assert.match(template, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
  assert.ok(!template.includes('listen 80;'));
  assert.match(template, /listen 127\.0\.0\.1:8080;/);
});
if (process.platform !== 'win32') test('TLS startup rejects missing, malformed or injectable proxy keys before rendering', () => {
  for (const value of ['', 'short', 'A'.repeat(64), 'a'.repeat(63) + ';', '$(echo unintended)']) {
    const result = spawnSync('/bin/sh', ['docker/truck-log/start-https.sh', '--check'], {
      env: { ...process.env, TRUCK_LOG_ADMIN_PROXY_KEY: value }, encoding: 'utf8', timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HTTPS proxy key must be 64 lowercase hexadecimal characters/);
  }
});
test('real auth transport accepts verified TLS proxy and rejects spoofed assertions', () => {
  const config = auth.transportConfig({ TRUCK_LOG_ADMIN_ENABLED: 'true', TRUCK_LOG_ADMIN_TRANSPORT: 'https',
    TRUCK_LOG_ADMIN_ORIGIN: 'https://trucklog.example.internal', TRUCK_LOG_ADMIN_PROXY_KEY: key,
    TRUCK_LOG_ADMIN_PROXY_IPS: '172.30.43.10' });
  const headers = { origin: config.origin, 'x-trucklog-admin-request': '1',
    'x-trucklog-admin-proxy-key': key, 'x-forwarded-proto': 'https',
    'x-trucklog-admin-client-ip': '192.0.2.10', 'x-forwarded-for': '198.51.100.99' };
  const request = { headers, socket: { remoteAddress: '172.30.43.10' } };
  assert.equal(auth.requireTransport(request, config, true), '192.0.2.10');
  for (const changed of [
    { ...request, socket: { remoteAddress: '172.30.43.11' } },
    { ...request, headers: { ...headers, 'x-trucklog-admin-proxy-key': 'b'.repeat(64) } },
    { ...request, headers: { ...headers, 'x-forwarded-proto': 'http' } },
  ]) assert.throws(() => auth.requireTransport(changed, config, true), error => error.code === 'ADMIN_HTTPS_REQUIRED');
  assert.match(auth.sessionCookie('c'.repeat(64), config), /; Secure; HttpOnly; SameSite=Strict/);
});

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-https-'));
try {
  if (process.argv.includes('--compose')) {
    fs.writeFileSync(path.join(temp, 'docker-compose.yml'), base);
    fs.writeFileSync(path.join(temp, 'docker-compose.https.yml'), overlay);
    fs.writeFileSync(path.join(temp, '.env'), 'TRUCK_LOG_DATABASE_USERNAME=test\nTRUCK_LOG_DATABASE_PASSWORD=synthetic-test-only\n');
    fs.mkdirSync(path.join(temp, 'tls'));
    const env = { ...process.env, TRUCK_LOG_DATABASE_USERNAME: 'test', TRUCK_LOG_DATABASE_PASSWORD: 'synthetic-test-only',
      TRUCK_LOG_PUBLIC_ORIGIN: 'https://trucklog.example.internal', TRUCK_LOG_ADMIN_PROXY_KEY: key,
      TRUCK_LOG_TLS_CERT_DIR: path.join(temp, 'tls'), TRUCK_LOG_TLS_PORT: '443', TRUCK_LOG_TLS_PROXY_IP: '172.30.43.10',
      TRUCK_LOG_TLS_PROXY_SUBNET: '172.30.43.0/24', TRUCK_LOG_API_BIND_ADDRESS: '127.0.0.1', TRUCK_LOG_API_PORT: '3334',
      TRUCK_LOG_WEB_PORT: '4300', TRUCK_LOG_ADMIN_TRANSPORT: 'https' };
    // This uses an isolated project directory; the real source .env is untouched.
    const common = ['compose', '--project-directory', temp, '--env-file', path.join(temp, '.env'), '-f', path.join(temp, 'docker-compose.yml')];
    test('actual Compose preserves explicit HTTPS transport in the base file', () => {
      const config = JSON.parse(run('docker', [...common, 'config', '--format', 'json'], env));
      assert.equal(config.services['truck-log-server'].environment.TRUCK_LOG_ADMIN_TRANSPORT, 'https');
    });
    test('actual merged Compose removes HTTP and pins the exact trusted web address', () => {
      const config = JSON.parse(run('docker', [...common, '-f', path.join(temp, 'docker-compose.https.yml'), 'config', '--format', 'json'], env));
      const server = config.services['truck-log-server'], web = config.services['truck-log-web'];
      assert.equal(web.ports.length, 1);
      assert.equal(web.ports[0].target, 443);
      assert.equal(web.ports[0].published, '443');
      assert.equal(server.ports[0].host_ip, '127.0.0.1');
      assert.equal(server.environment.TRUCK_LOG_ADMIN_TRANSPORT, 'https');
      assert.equal(server.environment.TRUCK_LOG_ADMIN_PROXY_IPS, web.networks['truck-log-tls-proxy'].ipv4_address);
      assert.equal(server.environment.TRUCK_LOG_ADMIN_PROXY_KEY, web.environment.TRUCK_LOG_ADMIN_PROXY_KEY);
      assert.deepEqual(server.networks['truck-log-tls-proxy'].aliases, ['truck-log-api-tls']);
      assert.equal(web.volumes.find(volume => volume.target === '/etc/nginx/truck-log-tls').read_only, true);
    });
  }
  if (process.argv.includes('--nginx')) {
    const certDir = path.join(temp, 'nginx-tls');
    fs.mkdirSync(certDir);
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-keyout', path.join(certDir, 'privkey.pem'), '-out', path.join(certDir, 'fullchain.pem')]);
    test('actual Nginx accepts the TLS template after restricted variable expansion', () => {
      run('docker', ['run', '--rm', '--entrypoint', '/bin/sh',
        '-e', `TRUCK_LOG_ADMIN_PROXY_KEY=${key}`,
        '--mount', `type=bind,src=${certDir},dst=/etc/nginx/truck-log-tls,readonly`,
        '--mount', `type=bind,src=${path.resolve('docker/truck-log/nginx.https.conf.template')},dst=/opt/truck-log/nginx.https.conf.template,readonly`,
        '--mount', `type=bind,src=${path.resolve('docker/truck-log/start-https.sh')},dst=/opt/truck-log/start-https.sh,readonly`,
        'nginx:1.27-alpine', '/opt/truck-log/start-https.sh', '--check']);
    });
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log(`[PASS] HTTPS deployment: ${cases} cases.`);
