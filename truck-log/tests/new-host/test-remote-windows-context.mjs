import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const setup=read('tools/truck-log/setup-docker.ps1');
const example=read('.env.example');
const doc=read('docs/truck-log/WINDOWS-REMOTE-DOCKER-INSTALL.md');
assert.match(example,/^TRUCK_LOG_PUBLIC_ORIGIN=http:\/\/localhost:4300$/m);
assert.match(setup,/\$existing\['TRUCK_LOG_PUBLIC_ORIGIN'\] -ne 'http:\/\/localhost:4300'/,
  'The default localhost origin must be detected as a template placeholder.');
assert.match(setup,/\$endpoint -match '\^\(ssh\|tcp\):\/\/'/,
  'Remote Docker SSH/TCP host inference must remain available.');
assert.match(setup,/Set-EnvValue '\.env' 'TRUCK_LOG_PUBLIC_ORIGIN' \$origin/);
assert.match(setup,/Set-EnvValue '\.env' 'TRUCK_LOG_CORS_ORIGINS' \$corsValue/);
assert.match(doc,/docker context create truck-log-linux/);
assert.match(doc,/Test-NetConnection linux-host -Port 4300/);
console.log('PASS: remote Windows Docker context/origin release contract');
