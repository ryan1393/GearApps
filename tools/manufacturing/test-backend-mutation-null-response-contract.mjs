import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const script=fs.readFileSync(contractPath(process.cwd(), 'tools/manufacturing/test-authenticated-backend-mutations.ps1'),'utf8');

for(const required of [
  'function Assert-NoRecord',
  '$null -eq $Actual',
  '$Actual -is [string] -and [string]::IsNullOrWhiteSpace([string]$Actual)',
  "Assert-NoRecord $current 'Rejected container load rolled back'",
]){
  if(!script.includes(required)){
    throw new Error(`Backend mutation suite is missing required no-record handling: ${required}`);
  }
}

if(script.includes("Assert-True ($null -eq $current) 'Rejected container load rolled back'")){
  throw new Error('Backend mutation rollback must not assume Invoke-RestMethod always returns literal $null for an empty/null API response.');
}

console.log('[PASS] Backend mutation no-record/null-response contract passed.');
