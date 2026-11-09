import fs from 'node:fs';

const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const compose=fs.readFileSync('compose.yml','utf8');

const frontends=[
  ['blade-tracking','apps/blade-tracking/nginx.conf','apps/blade-tracking/Dockerfile'],
  ['cutter-builder','apps/cutter-builder/nginx.conf','apps/cutter-builder/Dockerfile'],
  ['greenshed','apps/greenshed/nginx.conf','apps/greenshed/Dockerfile']
];

const ipv4Health='wget -q -O - http://127.0.0.1/healthz >/dev/null 2>&1';

must((compose.match(/http:\/\/127\.0\.0\.1\/healthz/g)||[]).length===3,
  'compose.yml must contain exactly three IPv4 frontend /healthz probes.');
must(!compose.includes('http://localhost/healthz'),
  'compose.yml must not use localhost for frontend /healthz probes.');

for(const [service,nginxRel,dockerfileRel] of frontends){
  const servicePattern=new RegExp(
    `^  ${service}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\n|^volumes:\\n)`,
    'm'
  );
  const match=compose.match(servicePattern);
  must(match,`compose.yml missing ${service}.`);
  const block=match[0];

  must(block.includes(ipv4Health),`${service} must use the IPv4 /healthz probe.`);
  must(block.includes('interval: 10s'),`${service} healthcheck interval changed unexpectedly.`);
  must(block.includes('timeout: 5s'),`${service} healthcheck timeout changed unexpectedly.`);
  must(block.includes('retries: 5'),`${service} healthcheck retry budget changed unexpectedly.`);

  const nginx=fs.readFileSync(nginxRel,'utf8');
  must(nginx.includes('location = /healthz'),`${nginxRel} must expose /healthz.`);
  must(/return\s+200\s+['"]ok['"];/.test(nginx),`${nginxRel} /healthz must return HTTP 200.`);

  const dockerfile=fs.readFileSync(dockerfileRel,'utf8');
  must(dockerfile.includes('FROM nginx:1.27-alpine'),`${dockerfileRel} runtime image changed unexpectedly.`);
  must(dockerfile.includes(`COPY manufacturing/${nginxRel} /etc/nginx/conf.d/default.conf`),
    `${dockerfileRel} must install its maintained nginx.conf.`);
}

console.log('[PASS] Gear frontend Docker health contract: Blade Tracking, Cutter Builder, and Greenshed use explicit IPv4 /healthz probes backed by Nginx HTTP 200 endpoints.');
