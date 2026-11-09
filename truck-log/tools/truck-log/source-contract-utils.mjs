import fs from 'node:fs';
import path from 'node:path';

function sortedFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sortedFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export function readFeatureSource(root, relativeDir, extensions = ['.ts', '.html', '.css', '.mjs']) {
  const dir = path.join(root, relativeDir);
  if (!fs.existsSync(dir)) throw new Error(`Feature source directory is missing: ${relativeDir}`);
  const allowed = new Set(extensions);
  return sortedFiles(dir)
    .filter(file => allowed.has(path.extname(file)))
    .map(file => `\n/* SOURCE: ${path.relative(root, file).replaceAll('\\\\', '/')} */\n${fs.readFileSync(file, 'utf8')}`)
    .join('\n');
}

export function readCssEntrySource(root, relativeEntry) {
  const seen = new Set();
  const read = file => {
    const resolved = path.resolve(file);
    if (seen.has(resolved)) return '';
    seen.add(resolved);
    const source = fs.readFileSync(resolved, 'utf8');
    const imported = [];
    const pattern = /@import\s+["']([^"']+)["']\s*;/g;
    let match;
    while ((match = pattern.exec(source))) {
      const target = path.resolve(path.dirname(resolved), match[1]);
      if (fs.existsSync(target)) imported.push(read(target));
    }
    return `${source}\n${imported.join('\n')}`;
  };
  return read(path.join(root, relativeEntry));
}

/**
 * Transpile a TypeScript module and its relative imports (recursively) to
 * CommonJS .cjs files under outDir, so a contract test can execute a helper
 * that is split across several files. Package imports are left to Node.
 * Returns the absolute path of the compiled entry module.
 */
export function transpileTsModuleTree(ts, root, entryRelative, outDir, compilerOptions = {}) {
  const entry = path.resolve(root, entryRelative);
  const base = path.dirname(entry);
  const done = new Map();
  const outPathFor = (file) => path.join(outDir, path.relative(base, file)).replace(/\.ts$/, '.cjs');
  const visit = (file) => {
    if (done.has(file)) return done.get(file);
    const target = outPathFor(file);
    done.set(file, target);
    const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, ...compilerOptions },
      reportDiagnostics: true,
      fileName: file,
    });
    const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(`TypeScript transpile failed for ${path.relative(root, file)}`);
    const output = result.outputText.replace(/require\((["'])(\.{1,2}\/[^"']+)\1\)/g, (match, quote, specifier) => {
      const dependency = path.resolve(path.dirname(file), `${specifier}.ts`);
      if (!fs.existsSync(dependency)) return match;
      const compiled = visit(dependency);
      let relativeOut = path.relative(path.dirname(target), compiled).split(path.sep).join('/');
      if (!relativeOut.startsWith('.')) relativeOut = `./${relativeOut}`;
      return `require(${quote}${relativeOut}${quote})`;
    });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output);
    return target;
  };
  return visit(entry);
}

/** Truck Log's own layout CSS entry (Dana UI is loaded before it by the app build). */
export const TRUCK_LOG_STYLES_ENTRY = 'libs/truck-log/web/styles/src/styles/truck-log.css';
export const DANA_UI_STYLES_ENTRY = 'node_modules/@dana/ui/styles/dana-ui.css';

/** Truck Log layout CSS: truck-log.css plus every file it imports. */
export function readTruckLogStyles(root) {
  return readCssEntrySource(root, TRUCK_LOG_STYLES_ENTRY);
}

/** Dana UI's shipped stylesheet (tokens, shell, panels, tables, badges, dialogs, toasts). */
export function readDanaUiStyles(root) {
  return readCssEntrySource(root, DANA_UI_STYLES_ENTRY);
}

/**
 * Component files under the given directories that still declare their own styles.
 * Styling for Truck Log screens is owned by @dana/ui plus the layout-only Truck Log CSS.
 */
export function componentStyleOffenders(root, relativeDirs) {
  const offenders = [];
  for (const rel of relativeDirs) {
    const dir = path.join(root, rel);
    if (!fs.existsSync(dir)) continue;
    for (const file of sortedFiles(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('@Component(')) continue;
      if (/\bstyleUrls?\s*:|\bstyles\s*:\s*[[`'"]/.test(source)) offenders.push(path.relative(root, file).split(path.sep).join('/'));
    }
  }
  return offenders;
}
