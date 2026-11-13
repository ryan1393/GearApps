#!/usr/bin/env node
/**
 * Cascade equivalence check for the global stylesheets.
 *
 *   node tools/truck-log/css-cascade-check.mjs <baseline-root> [--verbose] [--limit=N] [--json out.json]
 *
 * <baseline-root> is a directory containing libs/truck-log/web/styles as it was
 * before a cascade-affecting edit (for example `git archive <rev> libs/truck-log/web/styles`).
 * The current tree must contain the same declarations in the same order; only
 * @layer wrappers and !important flags may differ.
 *
 * A DOM model is built from every web template: element nesting, component
 * hosts (element and attribute selectors), routed components under
 * <router-outlet>, transparent ng-container/ng-template, classes from class
 * attributes, [class.x], ngClass/[class] (computed bindings may carry any class
 * TypeScript can produce), routerLinkActive, attributes and inline styles.
 * Selectors are matched right-to-left with their combinators (pseudo-classes,
 * :not() and :has() are treated as "may match", so the model over-approximates).
 *
 * For every pair of declarations that can set overlapping properties on the
 * same element - global vs global, global vs component styles (emulated
 * encapsulation, unlayered) and global vs inline styles - the cascade winner
 * is computed for both trees (importance, element-attached, layer, specificity,
 * order of appearance). A pair whose winner changes with a different value is
 * reported.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadStylesheets, parseCss, specificity, splitTopLevel } from './css-audit-lib.mjs';

const root = process.cwd();
const baselineRoot = process.argv[2];
if (!baselineRoot) { console.error('usage: css-cascade-check.mjs <baseline-root>'); process.exit(2); }
const verbose = process.argv.includes('--verbose');
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) ?? '--limit=40').slice(8));

function walk(dir, exts) {
  const abs = path.join(root, dir); if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    return e.isDirectory() ? walk(rel, exts) : exts.some((x) => e.name.endsWith(x)) ? [rel] : [];
  });
}

/** Classes TypeScript can hand to a computed [ngClass]/[class] binding: non-template string literals and string prefixes. */
function computedClassSource() {
  const literal = new Set(); const prefixes = new Set();
  for (const f of ['apps/truck-log/src', 'libs/truck-log/web'].flatMap((d) => walk(d, ['.ts']))) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
      if (/<[a-zA-Z]/.test(m[2])) continue;
      for (const w of m[2].replace(/\$\{[^}]*\}/g, ' ').matchAll(/-?[A-Za-z_][\w-]*/g)) literal.add(w[0]);
      const head = /^([A-Za-z_][\w-]*[-_])(?:\$\{|$)/.exec(m[2]);
      if (head) prefixes.add(head[1]);
    }
  }
  return (cls) => literal.has(cls) || [...prefixes].some((p) => cls.startsWith(p) && cls.length > p.length);
}
const canBeComputedClass = computedClassSource();

// ---------------------------------------------------------------------------
// DOM model
// ---------------------------------------------------------------------------
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'col', 'area', 'base', 'wbr', 'embed', 'param', 'track']);
const TRANSPARENT = new Set(['ng-container', 'ng-template', 'ng-content']);
const nodes = [];
function makeNode(tag, attrs, owner) {
  const el = { id: nodes.length, tag, classes: new Set(), anyClass: false, attrs: new Set(), staticId: null, owner, inline: new Map(), parents: new Set(), siblingsBefore: new Set() };
  for (const { name, value } of attrs) {
    let m;
    if (name === 'class' && value != null) value.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean).forEach((c) => el.classes.add(c));
    if ((m = /^\[class\.([\w-]+)\]$/.exec(name))) el.classes.add(m[1]);
    if (/^\[(ngClass|class|attr\.class)\]$/.test(name)) {
      for (const lit of String(value).matchAll(/'([^']*)'/g)) lit[1].split(/\s+/).filter(Boolean).forEach((c) => el.classes.add(c));
      for (const k of String(value).matchAll(/([\w-]+)\s*:/g)) el.classes.add(k[1]);
      if (!/^\s*\{[\s\S]*\}\s*$/.test(String(value))) el.anyClass = true;
    }
    if (name === 'routerLinkActive' && value) value.split(/\s+/).forEach((c) => el.classes.add(c));
    if (name === 'id' && value) el.staticId = value;
    el.attrs.add(name.replace(/^\[attr\.|^\[|\]$/g, '').toLowerCase());
    if (name === 'style' && value) for (const d of splitTopLevel(value, ';')) { const c = d.indexOf(':'); if (c > 0) el.inline.set(d.slice(0, c).trim().toLowerCase(), { value: d.slice(c + 1).replace(/!\s*important/i, '').trim(), important: /!\s*important/i.test(d) }); }
    if ((m = /^\[style\.([\w-]+)(?:\.\w+)?\]$/.exec(name))) el.inline.set(m[1].toLowerCase(), { value: '(bound)', important: false });
  }
  nodes.push(el);
  return el;
}
/**
 * Parse a template into nodes; returns the template's top-level element nodes.
 * Content of <ng-template #name> is also parented at every place that renders
 * it (*ngTemplateOutlet="name", *ngIf="...; else name" / "then name").
 */
function scanTemplate(html, owner) {
  const top = [];
  const stack = []; // {node|null (transparent), tag, children, templateName}
  const templateTops = new Map(); // name -> nodes directly inside <ng-template #name>
  const renderSites = new Map(); // name -> parent node ids where it is rendered (null = template root)
  const parentFrame = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].node) return stack[i]; return null; };
  const enclosingTemplate = () => { for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].node) return null; if (stack[i].templateName) return stack[i].templateName; } return null; };
  const noteSites = (attrs) => {
    const frame = parentFrame();
    for (const { name, value } of attrs) {
      if (!value) continue;
      const names = [];
      if (/^\*?\[?ngTemplateOutlet\]?$/.test(name)) names.push(value.split(/[;\s]/)[0]);
      if (/^\*ngIf$/.test(name)) for (const m of value.matchAll(/\b(?:else|then)\s+([\w$]+)/g)) names.push(m[1]);
      for (const n of names) (renderSites.get(n) ?? renderSites.set(n, []).get(n)).push(frame ? frame.node.id : null);
    }
  };
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+(?:[^\s"'>=/]+|\/(?!>))(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const tag = m[2].toLowerCase();
    const attrs = [];
    for (const a of m[3].matchAll(/([^\s"'>=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs.push({ name: a[1], value: a[2] ?? a[3] ?? a[4] ?? null });
    const selfClosing = m[4] === '/' || VOID.has(tag);
    noteSites(attrs);
    if (TRANSPARENT.has(tag)) {
      const ref = tag === 'ng-template' ? attrs.find((a) => a.name.startsWith('#'))?.name.slice(1) ?? null : null;
      if (!selfClosing) stack.push({ node: null, tag, children: null, templateName: ref });
      continue;
    }
    const node = makeNode(tag, attrs, owner);
    const frame = parentFrame();
    const siblings = frame ? frame.children : top;
    for (const s of siblings) node.siblingsBefore.add(s.id);
    siblings.push(node);
    if (frame) node.parents.add(frame.node.id);
    const tplName = enclosingTemplate();
    if (tplName) (templateTops.get(tplName) ?? templateTops.set(tplName, []).get(tplName)).push(node);
    if (!selfClosing) stack.push({ node, tag, children: [] });
  }
  for (const [name, tops] of templateTops) {
    for (const site of renderSites.get(name) ?? []) for (const n of tops) {
      if (site === null) { if (!top.includes(n)) top.push(n); } else n.parents.add(site);
    }
  }
  return top;
}

const indexTop = scanTemplate(fs.readFileSync(path.join(root, 'apps/truck-log/src/index.html'), 'utf8'), null);
const htmlNode = indexTop.find((n) => n.tag === 'html') ?? makeNode('html', [], null);
for (const n of indexTop) if (n !== htmlNode) n.parents.add(htmlNode.id);

const components = []; // {owner, selector:{tag, attribute}|null, roots, styles}
for (const file of [...walk('apps/truck-log/src', ['.ts']), ...walk('libs/truck-log/web', ['.ts'])]) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  for (const deco of src.matchAll(/@Component\(\{([\s\S]*?)\}\)\s*(?:\/\*\*[\s\S]*?\*\/\s*)?export class (\w+)/g)) {
    const body = deco[1]; const owner = deco[2];
    const sel = /selector:\s*'([^']+)'/.exec(body);
    let selector = null;
    if (sel) { const am = /^([a-z][\w-]*)?\[([\w-]+)\]$/.exec(sel[1]); selector = am ? { tag: am[1] ?? null, attribute: am[2].toLowerCase() } : { tag: sel[1].toLowerCase(), attribute: null }; }
    let html = '';
    const tpl = /template:\s*`([\s\S]*?)`/.exec(body);
    if (tpl) html = tpl[1];
    const tplUrl = /templateUrl:\s*'([^']+)'/.exec(body);
    if (tplUrl) html = fs.readFileSync(path.join(root, path.dirname(file), tplUrl[1]), 'utf8');
    const roots = scanTemplate(html, owner);
    const styles = [];
    const st = /styles:\s*\[([\s\S]*?)\]\s*,\s*\n?\s*(?:template|imports|selector|host|providers|styleUrls|standalone)/.exec(body) || /styles:\s*\[([\s\S]*?)\]/.exec(body);
    if (st) {
      for (const lit of st[1].matchAll(/`([\s\S]*?)`/g)) styles.push(lit[1]);
      for (const ref of st[1].matchAll(/\b([A-Z][A-Z0-9_]+)\b/g)) {
        const constant = new RegExp(`export const ${ref[1]}\\s*=\\s*\`([\\s\\S]*?)\``).exec(src);
        if (constant) styles.push(constant[1]);
      }
    }
    for (const u of (/styleUrls:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? '').matchAll(/'([^']+)'/g)) styles.push(fs.readFileSync(path.join(root, path.dirname(file), u[1]), 'utf8'));
    components.push({ owner, selector, roots, styles });
  }
}
// host metadata of components and attribute directives: '[class.x]', '[attr.y]', static attributes
const hostBindings = []; // {selector: {tag, attribute}, classes, attrs}
for (const file of [...walk('apps/truck-log/src', ['.ts']), ...walk('libs/truck-log/web', ['.ts'])]) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  for (const deco of src.matchAll(/@(?:Component|Directive)\(\{([\s\S]*?)\}\)\s*(?:\/\*\*[\s\S]*?\*\/\s*)?export class (\w+)/g)) {
    const host = /host:\s*\{([\s\S]*?)\}\s*,?\s*(?:\n|$|[a-z]+:)/.exec(deco[1]) || /host:\s*\{([^}]*)\}/.exec(deco[1]);
    const sel = /selector:\s*'([^']+)'/.exec(deco[1]);
    if (!host || !sel) continue;
    const am = /^([a-z][\w-]*)?\[([\w-]+)\]$/.exec(sel[1]);
    const selector = am ? { tag: am[1] ?? null, attribute: am[2].toLowerCase() } : { tag: sel[1].toLowerCase(), attribute: null };
    const classes = []; const attrs = [];
    for (const k of host[1].matchAll(/'([^']+)'\s*:\s*(['"])([^'"]*)\2/g)) {
      let m;
      if ((m = /^\[class\.([\w-]+)\]$/.exec(k[1]))) classes.push(m[1]);
      else if ((m = /^\[attr\.([\w-]+)\]$/.exec(k[1]))) attrs.push(m[1].toLowerCase());
      else if (k[1] === 'class') classes.push(...k[3].split(/\s+/).filter(Boolean));
      else if (!/^[\[(]/.test(k[1])) attrs.push(k[1].toLowerCase());
    }
    hostBindings.push({ selector, classes, attrs });
  }
}
for (const hb of hostBindings) for (const n of nodes) {
  if (hb.selector.tag && n.tag !== hb.selector.tag) continue;
  if (hb.selector.attribute && !n.attrs.has(hb.selector.attribute)) continue;
  if (!hb.selector.tag && !hb.selector.attribute) continue;
  hb.classes.forEach((c) => n.classes.add(c)); hb.attrs.forEach((x) => n.attrs.add(x));
}
const hostsOf = new Map();
for (const c of components) {
  let hosts = [];
  if (c.selector) hosts = nodes.filter((n) => (!c.selector.tag || n.tag === c.selector.tag) && (!c.selector.attribute || n.attrs.has(c.selector.attribute)));
  if (!hosts.length) {
    // routed (or otherwise unplaced) component: a host element next to every <router-outlet>
    hosts = nodes.filter((n) => n.tag === 'router-outlet').map((o) => {
      const h = makeNode(c.selector?.tag ?? 'ng-component', [], null);
      o.parents.forEach((p) => h.parents.add(p)); h.siblingsBefore.add(o.id); return h;
    });
  }
  hostsOf.set(c.owner, hosts);
  for (const r of c.roots) for (const h of hosts) r.parents.add(h.id);
}
const ancestorCache = new Map();
function ancestorsOf(id) {
  if (ancestorCache.has(id)) return ancestorCache.get(id);
  const out = new Set(); ancestorCache.set(id, out);
  for (const p of nodes[id].parents) { out.add(p); for (const a of ancestorsOf(p)) out.add(a); }
  return out;
}
nodes.forEach((n) => ancestorsOf(n.id));

// ---------------------------------------------------------------------------
// Selector matching
// ---------------------------------------------------------------------------
function parseComplex(selector) {
  const out = []; let cur = ''; let depth = 0; let q = null; let comb = null;
  const push = () => { if (cur.trim()) { out.push({ compound: cur.trim(), combinator: out.length ? (comb ?? ' ') : null }); comb = null; } cur = ''; };
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (depth === 0 && (c === '>' || c === '+' || c === '~')) { push(); comb = c; continue; }
    if (depth === 0 && c === ' ') { push(); continue; }
    cur += c;
  }
  push();
  return out;
}
const PSEUDO_ELEMENT = /::?(before|after|placeholder|marker|selection|first-line|first-letter|backdrop|-webkit-[\w-]+|-moz-[\w-]+)\b/;
function compoundParts(compound) {
  const req = { tag: null, classes: [], ids: [], attrs: [], alternatives: [], host: false, hostContext: [], root: false };
  let i = 0;
  const t = /^([a-zA-Z][\w-]*|\*)/.exec(compound);
  if (t) { req.tag = t[1].toLowerCase(); i = t[1].length; }
  while (i < compound.length) {
    const c = compound[i];
    if (c === '.') { const m = /^\.((?:\\.|[\w-])+)/.exec(compound.slice(i)); req.classes.push(m[1].replace(/\\/g, '')); i += m[0].length; continue; }
    if (c === '#') { const m = /^#((?:\\.|[\w-])+)/.exec(compound.slice(i)); req.ids.push(m[1]); i += m[0].length; continue; }
    if (c === '[') { const e = compound.indexOf(']', i); req.attrs.push(compound.slice(i + 1, e).split(/[~|^$*]?=/)[0].trim().toLowerCase()); i = e + 1; continue; }
    if (c === ':') {
      const m = /^::?([\w-]+)/.exec(compound.slice(i)); i += m[0].length;
      const name = m[1].toLowerCase(); let arg = null;
      if (compound[i] === '(') { let d = 0; let j = i; for (; j < compound.length; j++) { if (compound[j] === '(') d++; else if (compound[j] === ')') { d--; if (d === 0) break; } } arg = compound.slice(i + 1, j); i = j + 1; }
      if (name === 'host') req.host = true;
      if (name === 'host-context' && arg) req.hostContext.push(arg);
      if (name === 'root') req.root = true;
      if ((name === 'is' || name === 'where' || name === 'matches') && arg) req.alternatives.push(splitTopLevel(arg, ',').map((s) => s.trim()));
      continue;
    }
    i++;
  }
  return req;
}
function compoundMatches(req, node) {
  if (req.root && node.tag !== 'html') return false;
  if (req.tag && req.tag !== '*' && node.tag !== req.tag) return false;
  for (const c of req.classes) if (!node.classes.has(c) && !(node.anyClass && canBeComputedClass(c))) return false;
  for (const id of req.ids) if (!(node.staticId === id || (node.staticId === null && node.attrs.has('id')))) return false;
  for (const a of req.attrs) if (!node.attrs.has(a)) return false;
  for (const alts of req.alternatives) {
    if (!alts.some((alt) => /[\s>+~]/.test(alt) || compoundMatches(compoundParts(alt), node))) return false;
  }
  return true;
}
/** Node ids the selector can match; owner = component for emulated encapsulation (null = global). */
function matchSelector(selector, owner) {
  const deep = selector.indexOf('::ng-deep');
  const parts = parseComplex(selector.replace(/::ng-deep\s*/g, '').replace(PSEUDO_ELEMENT, ''));
  if (!parts.length) return new Set();
  const encapsulatedUntil = owner ? (deep >= 0 ? parseComplex(selector.slice(0, deep)).length : parts.length) : 0;
  const reqs = parts.map((p) => compoundParts(p.compound));
  const memo = new Map();
  const hostIds = owner ? new Set((hostsOf.get(owner) ?? []).map((h) => h.id)) : new Set();
  const matchAt = (k, nodeId) => {
    const key = k * 1e6 + nodeId;
    if (memo.has(key)) return memo.get(key);
    memo.set(key, false);
    const node = nodes[nodeId];
    const req = reqs[k];
    let ok;
    if (req.host) ok = hostIds.has(nodeId) && compoundMatches({ ...req, host: false }, node);
    else ok = (k >= encapsulatedUntil || node.owner === owner) && compoundMatches(req, node);
    if (ok && req.hostContext.length) ok = [...ancestorsOf(nodeId), nodeId].some((a) => req.hostContext.every((hc) => compoundMatches(compoundParts(hc), nodes[a])));
    if (ok && k > 0) {
      const comb = parts[k].combinator;
      const candidates = comb === '>' ? node.parents : (comb === '+' || comb === '~') ? node.siblingsBefore : ancestorsOf(nodeId);
      ok = false;
      for (const c of candidates) if (matchAt(k - 1, c)) { ok = true; break; }
    }
    memo.set(key, ok);
    return ok;
  };
  const result = new Set();
  for (const n of nodes) if (matchAt(parts.length - 1, n.id)) result.add(n.id);
  return result;
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------
const FAMILY_SPECIAL = {
  inset: ['top', 'right', 'bottom', 'left'], gap: ['row-gap', 'column-gap', 'grid-gap'], 'place-items': ['align-items', 'justify-items'],
  'place-content': ['align-content', 'justify-content'], 'place-self': ['align-self', 'justify-self'], font: ['line-height'],
  'flex-flow': ['flex-direction', 'flex-wrap'], 'grid-area': ['grid-row', 'grid-column', 'grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end'],
  grid: ['grid-template', 'grid-template-rows', 'grid-template-columns', 'grid-template-areas', 'grid-auto-flow', 'grid-auto-rows', 'grid-auto-columns'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'],
};
function propsOverlap(a, b) {
  if (a === b || a === 'all' || b === 'all') return true;
  if (a.startsWith('--') || b.startsWith('--')) return false;
  if (b.startsWith(a + '-') || a.startsWith(b + '-')) return true;
  return (FAMILY_SPECIAL[a] ?? []).includes(b) || (FAMILY_SPECIAL[b] ?? []).includes(a);
}
const familyOf = (prop) => prop.startsWith('--') ? prop : prop.replace(/^-(webkit|moz|ms)-/, '').split('-')[0];

function globalDecls(stylesRoot) {
  const sheets = loadStylesheets(stylesRoot);
  const out = []; let order = 0;
  const layerOrder = [];
  for (const sheet of sheets) for (const at of sheet.atRules) if (/^@layer\b/.test(at.prelude) && at.body === undefined) {
    for (const name of at.prelude.replace(/^@layer\s+/, '').split(',').map((s) => s.trim())) if (!layerOrder.includes(name)) layerOrder.push(name);
  }
  for (const sheet of sheets) for (const rule of sheet.rules) {
    const layerCtx = rule.context.find((c) => c.startsWith('@layer'));
    const layer = layerCtx ? layerCtx.replace(/^@layer\s+/, '').trim() : null;
    if (layer && !layerOrder.includes(layer)) layerOrder.push(layer);
    const ctx = rule.context.filter((c) => !c.startsWith('@layer')).join(' ');
    for (const d of rule.decls) {
      for (const selector of rule.selectors) out.push({ kind: 'global', file: sheet.rel, selector, ctx, prop: d.prop, value: d.value, important: d.important, layer, spec: specificity(selector), order, pseudo: PSEUDO_ELEMENT.exec(selector)?.[1] ?? '' });
      order++;
    }
  }
  return { decls: out, layerOrder };
}
const base = globalDecls(baselineRoot);
const current = globalDecls(root);
if (base.decls.length !== current.decls.length) {
  console.error(`[FAIL] declaration count changed: ${base.decls.length} -> ${current.decls.length}; only layer wrappers and !important may change`);
  process.exit(1);
}
for (let i = 0; i < base.decls.length; i++) {
  const a = base.decls[i], b = current.decls[i];
  if (a.selector !== b.selector || a.prop !== b.prop || a.value.replace(/\s+/g, ' ') !== b.value.replace(/\s+/g, ' ') || a.ctx !== b.ctx) {
    console.error(`[FAIL] declaration ${i} differs: ${a.file} ${a.selector} {${a.prop}: ${a.value}} vs ${b.file} ${b.selector} {${b.prop}: ${b.value}}`);
    process.exit(1);
  }
}
const compDecls = []; let compOrder = 1e9;
for (const c of components) for (const css of c.styles) {
  for (const rule of parseCss(css, c.owner).rules) for (const d of rule.decls) for (const selector of rule.selectors) {
    const parts = parseComplex(selector.replace(/::ng-deep.*$/, '')).length;
    const s = specificity(selector);
    compDecls.push({ kind: 'component', owner: c.owner, selector, ctx: rule.context.join(' '), prop: d.prop, value: d.value, important: d.important, layer: null, spec: [s[0], s[1] + (/^:host/.test(selector) ? 0 : parts), s[2]], order: compOrder++, pseudo: PSEUDO_ELEMENT.exec(selector)?.[1] ?? '' });
  }
}
const matchCache = new Map();
const elementsFor = (decl) => {
  const key = `${decl.owner ?? ''}|${decl.selector}`;
  if (!matchCache.has(key)) matchCache.set(key, matchSelector(decl.selector, decl.owner ?? null));
  return matchCache.get(key);
};
base.decls.forEach((d, i) => { d.elements = elementsFor(d); current.decls[i].elements = d.elements; current.decls[i].pseudo = d.pseudo; });
compDecls.forEach((d) => { d.elements = elementsFor(d); });
const inlineDecls = [];
for (const n of nodes) for (const [prop, v] of n.inline) inlineDecls.push({ kind: 'inline', selector: `inline <${n.tag}>`, owner: n.owner, prop, value: v.value, important: v.important, layer: null, spec: [9, 9, 9], order: 2e9, elements: new Set([n.id]), pseudo: '' });

// ---------------------------------------------------------------------------
// Cascade comparison
// ---------------------------------------------------------------------------
const layerRank = (decl, order) => (decl.kind !== 'global' || !decl.layer) ? order.length : order.indexOf(decl.layer);
function compare(x, y, order) {
  if (x.important !== y.important) return x.important ? 1 : -1;
  const xi = x.kind === 'inline', yi = y.kind === 'inline';
  if (xi !== yi) return xi ? 1 : -1;
  const lx = layerRank(x, order), ly = layerRank(y, order);
  if (lx !== ly) return x.important ? (lx < ly ? 1 : -1) : (lx > ly ? 1 : -1);
  for (let k = 0; k < 3; k++) if (x.spec[k] !== y.spec[k]) return x.spec[k] > y.spec[k] ? 1 : -1;
  return x.order > y.order ? 1 : -1;
}
const universe = base.decls.map((d, i) => ({ before: d, after: current.decls[i] }))
  .concat([...compDecls, ...inlineDecls].map((d) => ({ before: d, after: d })))
  .filter((u) => u.before.elements.size);
const groups = new Map();
for (const item of universe) { const f = familyOf(item.before.prop); (groups.get(f) ?? groups.set(f, []).get(f)).push(item); }
const crossFamilies = [['inset', 'top', 'right', 'bottom', 'left'], ['gap', 'row', 'column', 'grid'], ['place', 'align', 'justify'], ['font', 'line'], ['all']];
let flips = 0; let pairs = 0; const reported = new Set(); const flipList = [];
const conflicts = new Map(); // item -> items it can conflict with (same element, overlapping property)
const describe = (x) => `${x.kind === 'global' ? `${x.file.replace(/^.*styles\//, '')}${x.layer ? ` [${x.layer}]` : ''}` : x.kind === 'component' ? `component ${x.owner}` : `inline (${x.owner ?? 'index'})`} ${x.ctx ? x.ctx + ' ' : ''}${x.selector} { ${x.prop}: ${x.value}${x.important ? ' !important' : ''} }`;
function check(a, b) {
  if (a.before.kind !== 'global' && b.before.kind !== 'global') return;
  if (!propsOverlap(a.before.prop, b.before.prop) || a.before.pseudo !== b.before.pseudo) return;
  const [small, big] = a.before.elements.size < b.before.elements.size ? [a.before.elements, b.before.elements] : [b.before.elements, a.before.elements];
  let shared = false; for (const e of small) if (big.has(e)) { shared = true; break; }
  if (!shared) return;
  pairs++;
  (conflicts.get(a) ?? conflicts.set(a, []).get(a)).push(b);
  (conflicts.get(b) ?? conflicts.set(b, []).get(b)).push(a);
  const was = compare(a.before, b.before, []) > 0;
  const now = compare(a.after, b.after, current.layerOrder) > 0;
  if (was === now) return;
  if (a.before.prop === b.before.prop && a.before.value.replace(/\s+/g, ' ') === b.before.value.replace(/\s+/g, ' ')) return;
  const key = `${describe(a.after)}<>${describe(b.after)}`;
  if (reported.has(key)) return; reported.add(key);
  flips++;
  flipList.push({ a: a.after, b: b.after, was });
  if (flips <= (verbose ? 1e9 : limit)) console.log(`FLIP (${was ? 'first' : 'second'} used to win):\n   ${describe(a.after)}\n   ${describe(b.after)}`);
}
const fams = [...groups.keys()];
for (const f of fams) { const list = groups.get(f); for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) check(list[i], list[j]); }
for (const set of crossFamilies) {
  const fs2 = fams.filter((f) => set.includes(f));
  for (let x = 0; x < fs2.length; x++) for (let y = x + 1; y < fs2.length; y++) for (const a of groups.get(fs2[x])) for (const b of groups.get(fs2[y])) check(a, b);
}
// --plan-important out.json: greedily list !important flags (by global declaration order) that can be
// dropped from the current tree without changing any winner relative to the baseline.
if (process.argv.includes('--plan-important')) {
  if (flips) { console.error('[FAIL] the current tree already changes winners; fix those first'); process.exit(1); }
  const sameValue = (x, y) => x.prop === y.prop && x.value.replace(/\s+/g, ' ') === y.value.replace(/\s+/g, ' ');
  const byOrder = new Map();
  for (const item of universe) if (item.after.kind === 'global' && item.after.important) (byOrder.get(item.after.order) ?? byOrder.set(item.after.order, []).get(item.after.order)).push(item);
  // declarations that match nothing keep their flag (nothing to prove) - they are listed separately
  const droppable = [];
  for (const [order, items] of [...byOrder].sort((x, y) => y[0] - x[0])) {
    items.forEach((it) => { it.after = { ...it.after, important: false }; });
    const breaks = items.some((it) => (conflicts.get(it) ?? []).some((other) => {
      const was = compare(it.before, other.before, []) > 0;
      const now = compare(it.after, other.after, current.layerOrder) > 0;
      return was !== now && !sameValue(it.before, other.before);
    }));
    if (breaks) items.forEach((it) => { it.after = { ...it.after, important: true }; });
    else droppable.push(order);
  }
  fs.writeFileSync(process.argv[process.argv.indexOf('--plan-important') + 1], JSON.stringify(droppable.sort((x, y) => x - y)));
  console.log(`[PLAN] ${droppable.length} of ${byOrder.size} matched !important declarations can drop the flag without changing any winner.`);
}
if (process.argv.includes('--json')) {
  fs.writeFileSync(process.argv[process.argv.indexOf('--json') + 1], JSON.stringify(flipList.map((f) => ({
    a: describe(f.a), b: describe(f.b), was: f.was,
    aFile: f.a.file ?? null, bFile: f.b.file ?? null, aKind: f.a.kind, bKind: f.b.kind,
    aImportant: f.a.important, bImportant: f.b.important, aLayer: f.a.layer, bLayer: f.b.layer, aOrder: f.a.order, bOrder: f.b.order,
  }))));
}
if (verbose) for (const d of current.decls) if (d.important && !d.elements.size) console.log(`UNMATCHED !important: ${describe(d)}`);
if (verbose) console.log(`DOM model: ${nodes.length} nodes; ${components.length} components; ${compDecls.length} component and ${inlineDecls.length} inline declarations.`);
console.log(`${flips ? '[FAIL]' : '[PASS]'} cascade check: ${pairs} conflicting declaration pairs compared; ${flips} winner change(s). Layers: ${current.layerOrder.join(', ') || '(none)'}`);
process.exit(flips ? 1 : 0);
