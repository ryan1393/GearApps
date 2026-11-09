// TypeORM loads database drivers with a dynamic require, so Nx's generated
// package.json for the API bundle omits them. Copy their pinned versions from
// the workspace package.json into the bundle's package.json before `npm install`.
const fs = require('fs');
const [rootPkgPath, bundlePkgPath] = process.argv.slice(2);
const root = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
const bundle = JSON.parse(fs.readFileSync(bundlePkgPath, 'utf8'));
const all = { ...root.devDependencies, ...root.dependencies };
for (const name of ['pg', 'mssql', 'better-sqlite3']) {
  if (!all[name]) throw new Error(`${name} missing from workspace package.json`);
  bundle.dependencies[name] = all[name];
}
fs.writeFileSync(bundlePkgPath, JSON.stringify(bundle, null, 2));
console.log(
  'added DB drivers:',
  ['pg', 'mssql', 'better-sqlite3'].map((n) => `${n}@${bundle.dependencies[n]}`).join(', '),
);
