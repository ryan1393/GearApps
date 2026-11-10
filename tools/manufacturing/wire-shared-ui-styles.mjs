import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const sharedStyle='vendor/dana-ui/package/styles/gear-apps.css';
const minimalStyle=`@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * Gear Apps visual styling is centralized in:
 * vendor/dana-ui/package/styles/gear-apps.css
 */
`;
const tailwindProxy=`module.exports = require('../../tools/manufacturing/tailwind/create-app-tailwind-config')(__dirname);
`;

function frontendAngularApps(){
  const appsDir=path.join(root,'apps');
  return fs.readdirSync(appsDir,{withFileTypes:true})
    .filter(e=>e.isDirectory())
    .map(e=>e.name)
    .filter(name=>{
      const file=path.join(appsDir,name,'project.json');
      if(!fs.existsSync(file)) return false;
      const project=JSON.parse(fs.readFileSync(file,'utf8'));
      const tags=new Set(project.tags??[]);
      return project.projectType==='application' &&
        tags.has('scope:frontend') &&
        tags.has('framework:angular');
    });
}

function wireApp(app){
  const projectFile=path.join(root,'apps',app,'project.json');
  if(!fs.existsSync(projectFile)) throw new Error(`Unknown app: ${app}`);

  const project=JSON.parse(fs.readFileSync(projectFile,'utf8'));
  const tags=new Set(project.tags??[]);
  if(project.projectType!=='application' || !tags.has('scope:frontend') || !tags.has('framework:angular')){
    throw new Error(`${app} is not tagged as a Gear Apps Angular frontend application.`);
  }

  const sourceRoot=project.sourceRoot || `apps/${app}/src`;
  const appStyle=`${sourceRoot}/styles.css`;
  const styles=project.targets?.build?.options?.styles;
  if(!Array.isArray(styles)) throw new Error(`${app} build target has no styles array.`);

  const thirdParty=styles.filter(x=>
    typeof x==='string' &&
    x!==sharedStyle &&
    !x.startsWith(`${sourceRoot}/styles.`)
  );

  project.targets.build.options.styles=[appStyle,sharedStyle,...thirdParty];
  fs.writeFileSync(projectFile,JSON.stringify(project,null,2)+'\n');

  fs.mkdirSync(path.dirname(path.join(root,appStyle)),{recursive:true});
  fs.writeFileSync(path.join(root,appStyle),minimalStyle);
  fs.writeFileSync(path.join(root,'apps',app,'tailwind.config.js'),tailwindProxy);

  console.log(`[WIRED] ${app}`);
}

const args=process.argv.slice(2);
const requested=args.filter(x=>!x.startsWith('--'));
const apps=requested.length ? requested : frontendAngularApps();
for(const app of apps) wireApp(app);

console.log(`[PASS] Shared Gear Apps styling wired to ${apps.length} frontend app(s).`);
