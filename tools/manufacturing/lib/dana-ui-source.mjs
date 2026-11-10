// Dana UI has one copy: the TypeScript source in libs/shared/dana-ui/src. Contract tests read it
// directly instead of a built package.
import fs from 'node:fs';
import path from 'node:path';
import { contractPath } from './contract-paths.mjs';

const sourceRoot = (root) => contractPath(root, 'libs/shared/dana-ui/src');

function walk(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

let cache = null;
// Map of src-relative path ('lib/components/...ts', 'index.ts') to file text.
export function danaUiSources(root = process.cwd()) {
  if (!cache) {
    const base = sourceRoot(root);
    cache = new Map(
      walk(base)
        .filter((file) => /\.(ts|html|css)$/.test(file) && !/\.spec\.ts$/.test(file))
        .sort()
        .map((file) => [path.relative(base, file).replaceAll('\\', '/'), fs.readFileSync(file, 'utf8')]),
    );
  }
  return cache;
}

export function readDanaUiSource(root, rel) {
  const text = danaUiSources(root).get(rel);
  if (text == null) throw new Error(`Dana UI source not found: libs/shared/dana-ui/src/${rel}`);
  return text;
}

// Every component, directive and service implementation (TypeScript and inline/external templates).
export function danaUiBundleText(root = process.cwd()) {
  return [...danaUiSources(root)]
    .filter(([rel]) => rel.startsWith('lib/') && !rel.endsWith('.css'))
    .map(([, text]) => text)
    .join('\n');
}

// The public API: index.ts with every re-exported module inlined, so a declaration appears here
// only if applications can import it from '@dana/ui'.
export function danaUiPublicApiText(root = process.cwd()) {
  const base = sourceRoot(root);
  const seen = new Set();
  const inline = (file) => {
    if (seen.has(file)) return '';
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    const parts = [text];
    for (const match of text.matchAll(/export\s+(?:\*|\{[^}]*\})\s+from\s+['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), match[1]);
      const candidate = [target + '.ts', path.join(target, 'index.ts')].find((f) => fs.existsSync(f));
      if (candidate) parts.push(inline(candidate));
    }
    return parts.join('\n');
  };
  return inline(path.join(base, 'index.ts'));
}
