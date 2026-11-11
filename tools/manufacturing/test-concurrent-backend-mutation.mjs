const base=(process.env.MESHFORGE_BASE_URL||'http://localhost:3333/api/v1').replace(/\/$/,'');
const email=process.env.MESHFORGE_E2E_ADMIN_EMAIL||'e2e.admin@meshforge.local';
const password=process.env.MESHFORGE_E2E_ADMIN_PASSWORD||'MeshForge-E2E-Admin-2026!';

async function jsonOrText(res){
  const text=await res.text();
  try{return text?JSON.parse(text):null;}catch{return text;}
}

const login=await fetch(`${base}/auth/email/login`,{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email,password}),
});
if(!login.ok) throw new Error(`Admin login failed HTTP ${login.status}: ${JSON.stringify(await jsonOrText(login))}`);
const auth=await login.json();
if(!auth.accessToken) throw new Error('Admin login did not return accessToken.');
const headers={'content-type':'application/json',authorization:`Bearer ${auth.accessToken}`};

const serial=`E2E-CONCURRENT-${Date.now()}-${Math.random().toString(16).slice(2,8)}`.toUpperCase();
const body={serial_number:serial,number:serial,description:'E2E concurrent duplicate mutation test',department:'E2E',location_type:'INTERNAL',enabled:true};
const create=()=>fetch(`${base}/locations`,{method:'POST',headers,body:JSON.stringify(body)});

const responses=await Promise.all([create(),create()]);
const results=await Promise.all(responses.map(async r=>({status:r.status,body:await jsonOrText(r)})));
const successes=results.filter(r=>r.status>=200&&r.status<300);
const conflicts=results.filter(r=>r.status===409);
if(successes.length!==1||conflicts.length!==1){
  throw new Error(`Concurrent duplicate create expected one success + one 409, got ${JSON.stringify(results)}`);
}
const conflictMessage=conflicts[0].body?.message;
if(!conflictMessage || typeof conflictMessage!=='string'){
  throw new Error(`Concurrent 409 did not include a useful message: ${JSON.stringify(conflicts[0])}`);
}
const created=successes[0].body;
if(!created?.id) throw new Error(`Successful concurrent create did not return id: ${JSON.stringify(created)}`);

const del=await fetch(`${base}/locations/${created.id}`,{method:'DELETE',headers});
if(!del.ok) throw new Error(`Concurrent test cleanup failed HTTP ${del.status}: ${JSON.stringify(await jsonOrText(del))}`);

console.log(`[PASS] Concurrent duplicate backend mutation: one create succeeded, one rejected HTTP 409; cleanup succeeded.`);
