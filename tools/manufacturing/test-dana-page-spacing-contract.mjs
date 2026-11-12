import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import postcss from 'postcss';

// Application component styles may arrange content; shared Dana UI owns its appearance.
// Standalone paper/label documents are not application component styles.
const files=execFileSync('rg',['--files','apps','libs/client','libs/manufacturing/frontend'],{encoding:'utf8'})
  .trim().split('\n').filter(file=>/\.(css|scss|ts|html)$/.test(file)&&!file.endsWith('.spec.ts'));
const paint=/^(?:color|background(?:-.*)?|border(?:-(?:color|radius|top|right|bottom|left|inline|block)(?:-.*)?)?|box-shadow|text-shadow|font(?:-size|-weight|-family|-style)?|line-height|letter-spacing|text-transform|outline(?:-color|-style|-width)?)$/;
const violations=[];
let stylesheets=0;
function inspect(file,css){
  stylesheets++;
  postcss.parse(css,{from:file}).walkDecls(declaration=>{
    const reset=/^(none|0|0px|inherit)$/.test(declaration.value)&&/^(border|outline|background|box-shadow)/.test(declaration.prop);
    if(paint.test(declaration.prop)&&!reset) violations.push(`${file}: ${declaration.prop}: ${declaration.value}`);
  });
}
for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  const palette=source.match(/\b(?:bg|text|border)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?\b/g);
  if(palette) violations.push(`${file}: use Dana semantic classes instead of private palette utilities (${[...new Set(palette)].join(', ')})`);
  if(file.endsWith('.html'))continue;
  if(/\.(css|scss)$/.test(file)){inspect(file,source);continue;}
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const visit=node=>{
    if(ts.isPropertyAssignment(node)&&node.name.getText(tree)==='styles'){
      if(ts.isStringLiteralLike(node.initializer))inspect(file,node.initializer.text);
      else if(ts.isArrayLiteralExpression(node.initializer))for(const style of node.initializer.elements)if(ts.isStringLiteralLike(style))inspect(file,style.text);
    }
    ts.forEachChild(node,visit);
  };
  visit(tree);
}
assert.deepEqual(violations,[],'Move application visual declarations to shared Dana UI; component CSS is layout-only');
const tokens=fs.readFileSync('libs/shared/dana-ui/src/styles/dana-core/tokens.css','utf8');
for(const token of ['--dana-page-padding','--dana-panel-padding','--dana-section-gap','--dana-form-gap','--dana-field-gap','--dana-action-gap']){
  assert.ok(tokens.includes(token),`Missing canonical spacing token ${token}`);
}
const entry=fs.readFileSync('libs/shared/dana-ui/src/styles/dana-core.css','utf8');
assert.ok(entry.includes("@import './dana-core/spacing.css'"),'Dana core must load the shared spacing policy');
assert.ok(entry.includes("@import './dana-core/content.css'"),'Dana core must load reusable content variants');
for(const name of fs.readdirSync('libs/shared/dana-ui/src/styles/dana-core')){
  if(name.endsWith('.css'))assert.ok(!/gear-/.test(fs.readFileSync(`libs/shared/dana-ui/src/styles/dana-core/${name}`,'utf8')),`Neutral Dana core must not depend on Gear selectors: ${name}`);
}
console.log(`PASS Dana spacing/ownership: ${stylesheets} application stylesheets contain layout only; shared spacing and content recipes are registered.`);
