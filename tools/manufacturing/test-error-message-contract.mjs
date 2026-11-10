import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const walk=(dir,out=[])=>{
  for(const e of fs.readdirSync(contractPath(process.cwd(), dir),{withFileTypes:true})){
    if(['node_modules','.git','dist','.nx'].includes(e.name)) continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory()) walk(p,out);
    else if(e.isFile() && p.endsWith('.ts')) out.push(p);
  }
  return out;
};

const builtins=[
  'BadRequestException','UnauthorizedException','NotFoundException',
  'ForbiddenException','NotAcceptableException','RequestTimeoutException',
  'ConflictException','GoneException','HttpVersionNotSupportedException',
  'PayloadTooLargeException','UnsupportedMediaTypeException',
  'UnprocessableEntityException','InternalServerErrorException',
  'NotImplementedException','ImATeapotException','MethodNotAllowedException',
  'BadGatewayException','ServiceUnavailableException','GatewayTimeoutException',
  'PreconditionFailedException',
];

const offenders=[];
for(const file of walk(root)){
  const text=fs.readFileSync(contractPath(process.cwd(), file),'utf8');
  for(const name of builtins){
    const re=new RegExp(`new\\s+${name}\\s*\\(\\s*\\)`, 'g');
    for(const m of text.matchAll(re)){
      const line=text.slice(0,m.index).split(/\r?\n/).length;
      offenders.push(`${path.relative(root,file)}:${line} ${name}()`);
    }
  }
}
if(offenders.length){
  throw new Error('Built-in HTTP exceptions must have explicit messages: '+offenders.join(', '));
}

const logging=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/util-common/src/lib/interceptors/logging.interceptor.ts'),'utf8');
if(!logging.includes('catchError((error: unknown)') ||
   !logging.includes('httpError.getStatus()') ||
   !logging.includes('error.stack')){
  throw new Error('LoggingInterceptor must log HttpException details and unexpected error stacks.');
}

const db=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/util-common/src/lib/filters/query-failed.filter.ts'),'utf8');
if(!db.includes('Database query failed (code=${safeCode})') ||
   db.includes('Failed SQL:') || db.includes('detail: databaseDetail')){
  throw new Error('Database failures must log a safe error code without exposing SQL, parameters, or driver details.');
}

const workflow=fs.readFileSync(contractPath(process.cwd(), 'tools/manufacturing/test-full-workflow.ps1'),'utf8');
if(!workflow.includes('$_.ErrorDetails') ||
   !workflow.includes('ReadAsStringAsync') ||
   !workflow.includes('Response: $bodyText')){
  throw new Error('Full workflow test must print API response bodies for failed requests.');
}

console.log('[PASS] Explicit API/test error-message contract passed.');
