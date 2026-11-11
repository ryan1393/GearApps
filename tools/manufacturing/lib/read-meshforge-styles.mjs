import { contractPath } from './contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

// MeshForge styles all ship in @dana/ui (source: libs/shared/dana-ui/src/styles).
export const MESHFORGE_STYLE_ENTRY = 'libs/shared/dana-ui/src/styles/meshforge.css';
export const MESHFORGE_STYLE_ENTRY_INSTALLED = 'libs/shared/dana-ui/src/styles/gear-compat.css';
export const MESHFORGE_DOMAIN_STYLE_ENTRY_INSTALLED = 'libs/shared/dana-ui/src/styles/gear-compat-features.css';
export const MESHFORGE_DOMAIN_STYLE_ENTRY = 'libs/shared/dana-ui/src/styles/gear-compat-features.css';
const IMPORT_PATTERN = /@import\s+['"]([^'"]+)['"]\s*;/g;

function listStyleModules(root, entryRel) {
  const entryPath=contractPath(root,entryRel); if(!fs.existsSync(entryPath)) return [];
  const entry=fs.readFileSync(entryPath,'utf8'); const modules=[];
  for(const match of entry.matchAll(IMPORT_PATTERN)){
    const absolutePath=path.resolve(path.dirname(entryPath),match[1]);
    modules.push(path.relative(root,absolutePath).replace(/\\/g,'/'));
  }
  return modules;
}
export function listMeshForgeStyleModules(root=process.cwd()){ return listStyleModules(root,MESHFORGE_STYLE_ENTRY); }
export function listMeshForgeDomainStyleModules(root=process.cwd()){ return listStyleModules(root,MESHFORGE_DOMAIN_STYLE_ENTRY); }

function readStyleGraph(root, entryRel){
  const entryPath=contractPath(root,entryRel); if(!fs.existsSync(entryPath)) return '';
  const seen=new Set();
  const readFileGraph=(filePath)=>{
    const absolutePath=path.resolve(filePath); if(seen.has(absolutePath)) throw new Error(`Circular MeshForge stylesheet import detected: ${absolutePath}`); seen.add(absolutePath);
    const css=fs.readFileSync(absolutePath,'utf8'); let resolved=''; let cursor=0;
    for(const match of css.matchAll(IMPORT_PATTERN)){
      const index=match.index??0; resolved+=css.slice(cursor,index); resolved+=readFileGraph(path.resolve(path.dirname(absolutePath),match[1])); cursor=index+match[0].length;
    }
    resolved+=css.slice(cursor); seen.delete(absolutePath); return resolved;
  };
  return readFileGraph(entryPath);
}
export function readMeshForgeStyles(root=process.cwd()){
  return [readStyleGraph(root,MESHFORGE_STYLE_ENTRY),readStyleGraph(root,MESHFORGE_DOMAIN_STYLE_ENTRY)].filter(Boolean).join('\n');
}
