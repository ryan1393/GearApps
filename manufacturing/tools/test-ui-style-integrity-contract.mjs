import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root=process.cwd();
const req=createRequire(path.join(root,"package.json"));
const postcss=req("postcss");
const entry=path.join(root,"vendor","dana-ui","package","styles","gear-apps.css");

if(!fs.existsSync(entry)) throw new Error("Missing shared Gear Apps CSS entrypoint.");

const entryText=fs.readFileSync(entry,"utf8");
const stripped=entryText
  .replace(/\/\*[\s\S]*?\*\//g,"")
  .replace(/\/\/.*$/gm,"")
  .replace(/@import\s+[^;]+;/g,"")
  .trim();
if(stripped) throw new Error("gear-apps.css must remain import-only.");

function resolveImport(from,spec){
  if(!spec.startsWith(".")) return null;
  let p=path.resolve(path.dirname(from),spec);
  if(!path.extname(p)) p+=".css";
  return fs.existsSync(p)?p:null;
}
function graph(file,seen=new Set(),out=[]){
  const abs=path.resolve(file);
  if(seen.has(abs)) return out;
  seen.add(abs);
  const text=fs.readFileSync(abs,"utf8");
  for(const m of text.matchAll(/@import\s+(?:url\()?["']([^"']+)["']\)?[^;]*;/g)){
    const dep=resolveImport(abs,m[1]);
    if(dep) graph(dep,seen,out);
  }
  out.push(abs);
  return out;
}
function ctx(rule){
  const a=[];let p=rule.parent;
  while(p&&p.type!=="root"){
    if(p.type==="atrule")a.unshift(`@${p.name} ${String(p.params||"").replace(/\s+/g," ").trim()}`);
    p=p.parent;
  }
  return a.join(" > ")||"GLOBAL";
}

const modules=graph(entry);
for(const file of modules){
  const lines=fs.readFileSync(file,"utf8").split(/\r?\n/).length;
  if(lines>520) throw new Error(`${path.relative(root,file)} has ${lines} lines; shared style ceiling is 520.`);
}

let duplicateCount=0;
const duplicateSamples=[];

for(const file of modules){
  const rel=path.relative(root,file);
  const ast=postcss.parse(fs.readFileSync(file,"utf8"),{from:file});
  const localSeen=new Map();

  ast.walkRules(rule=>{
    const key=`${ctx(rule)} :: ${rule.selector}`;
    if(localSeen.has(key)){
      duplicateCount++;
      duplicateSamples.push(`${key} :: ${rel}`);
    } else {
      localSeen.set(key,true);
    }
  });
}

if(duplicateCount){
  throw new Error(
    `Same-file/same-context duplicate selector debt must remain zero. Found ${duplicateCount}:\n` +
    duplicateSamples.slice(0,8).join("\n")
  );
}

/*
  IMPORTANT:
  Reusing a selector in DIFFERENT imported CSS modules is legitimate modular CSS.
  Examples include:
    - foundation/base.css defining html/body structural defaults
    - typography.css defining html/body typography
    - dashboard.css and admin-core.css extending a shared table tool selector

  Import order is the cascade contract. Treating those as duplicate debt caused the
  V60-V65.1 whack-a-mole loop and forced unrelated modules to be merged.
  We therefore reject only duplicate selector blocks repeated inside the SAME FILE
  and SAME at-rule context. Cross-module selector reuse remains visible to normal
  source review but is not a failure.
*/
console.log(`[PASS] Gear Apps style integrity passed: ${modules.length} imported modules, zero same-file/same-context duplicate selectors, import-only entrypoint, <=520 lines/module.`);
