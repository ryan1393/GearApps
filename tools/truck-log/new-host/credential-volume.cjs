'use strict';
// This helper runs in a temporary container. Credentials arrive ONLY on stdin,
// not in argv/environment/image/source. It never prints values or their hashes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.env.TRUCK_LOG_SETUP_SECRETS_ROOT || '/secrets';
const names = ['rxo_username', 'rxo_password'];
function safeFile(name) {
  const f = path.join(root, name);
  if (fs.existsSync(f) && (!fs.lstatSync(f).isFile() || fs.lstatSync(f).isSymbolicLink())) throw new Error('Unsafe credential path.');
  return f;
}
function probe() {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Unsafe credential directory.');
  return names.every(name => { const f=safeFile(name); return fs.existsSync(f) && fs.readFileSync(f,'utf8').trim().length>0; });
}
function write(values) {
  if (!values || names.some(name => typeof values[name] !== 'string' || !values[name].trim() || /[\r\n\0]/.test(values[name]))) throw new Error('Two nonempty, single-line credentials are required.');
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Unsafe credential directory.');
  const journal = names.map(name => { const f=safeFile(name); return { name, f, before: fs.existsSync(f) ? fs.readFileSync(f) : null }; });
  const temporary = [];
  try {
    for (const j of journal) {
      const t=path.join(root, `.${j.name}.${crypto.randomBytes(10).toString('hex')}.tmp`);
      fs.writeFileSync(t, values[j.name], { flag: 'wx', mode: 0o600 }); temporary.push(t);
      fs.renameSync(t,j.f); fs.chmodSync(j.f,0o600);
    }
    for (const j of journal) if (fs.readFileSync(j.f,'utf8') !== values[j.name]) throw new Error('Credential verification failed.');
  } catch (error) {
    for (const j of journal) { if (j.before === null) { if (fs.existsSync(j.f)) fs.unlinkSync(j.f); } else { fs.writeFileSync(j.f,j.before,{mode:0o600}); } }
    throw error;
  } finally { for (const t of temporary) { if (fs.existsSync(t)) fs.unlinkSync(t); } }
}
async function main() {
  const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (data.action === 'probe') { console.log(JSON.stringify({ configured: probe() })); return; }
  if (data.action !== 'write') throw new Error('Unknown credential action.');
  write(data.values); console.log(JSON.stringify({ configured: true, written: true }));
}
main().catch(() => { console.error('[FAIL] Credential helper failed; values are not logged.'); process.exitCode=1; });
