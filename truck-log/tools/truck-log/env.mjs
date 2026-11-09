import fs from 'node:fs'; import path from 'node:path';
export function loadEnv(file='.env'){
  const full=path.resolve(file); if(!fs.existsSync(full)) return;
  for(const line of fs.readFileSync(full,'utf8').split(/\r?\n/)){
    const t=line.trim(); if(!t||t.startsWith('#')) continue; const i=t.indexOf('='); if(i<1) continue;
    const k=t.slice(0,i).trim(); const v=t.slice(i+1).trim().replace(/^"(.*)"$/,'$1'); if(process.env[k]==null) process.env[k]=v;
  }
}
