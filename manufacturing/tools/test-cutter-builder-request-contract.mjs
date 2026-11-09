import fs from 'node:fs';

const dto=fs.readFileSync('libs/server/feat-cutter-build/src/lib/cutter-build.dto.ts','utf8');
const workflow=fs.readFileSync('tools/test-full-workflow.ps1','utf8');
const frontend=fs.readFileSync('libs/frontend/data-access-cutter-builder/src/lib/cutter-builder-api.service.ts','utf8');

if(!/class\s+CreateCutterBuilderBuildDto[\s\S]*?cutter_body_identifier!:\s*string/.test(dto)){
  throw new Error('CreateCutterBuilderBuildDto must require cutter_body_identifier:string.');
}
if(!workflow.includes('cutter_body_identifier = $CutterBodySerialNumber')){
  throw new Error('Full workflow Cutter Builder POST must send cutter_body_identifier.');
}
if(/POST '\/cutter-builder\/builds'[\s\S]{0,500}?cutter_body_serial_number\s*=/.test(workflow)){
  throw new Error('Full workflow still sends obsolete cutter_body_serial_number in Cutter Builder create request.');
}
if(!frontend.includes('cutter_body_identifier: input.cutterBodyIdentifier')){
  throw new Error('Frontend Cutter Builder createBuild must send cutter_body_identifier.');
}

if(!workflow.includes("Assert-Equal $buildDetail.status.code 'READY' 'Cutter Builder detail status' 'status.code'")){
  throw new Error('Full workflow must validate Cutter Builder detail status through nested status.code.');
}
if(!frontend.includes("status?: { code: string; name: string }")){
  throw new Error('Frontend CutterBuildDetails contract must expose nested status.code.');
}
if(!workflow.includes("Assert-Equal $buildStillPulled.status.code 'PULLED' 'Rejected teardown rollback' 'status.code'")){
  throw new Error('Rejected teardown rollback must validate Cutter Builder detail through nested status.code.');
}
if(/\$build(?:Detail|StillPulled)\.status_code/.test(workflow)){
  throw new Error('Cutter Builder detail GET assertions must not use flat status_code.');
}
console.log('[PASS] Cutter Builder request/detail contracts match backend DTO and response shape.');
