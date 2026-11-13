/**
 * Small CSS toolkit for the Truck Log web stylesheets (no dependencies):
 *   parseCss()          -> rules with their at-rule context, selectors and declarations
 *   loadStylesheets()   -> the global stylesheet files in cascade (import) order
 *   webSourceInventory()-> every class/id/attribute token the web client can produce
 *   selectorIsLive()    -> false only when a selector can never match (proven by tokens)
 *   specificity()       -> [a, b, c] for a complex selector
 */
import fs from 'node:fs';
import path from 'node:path';

export const STYLES_ROOT = 'libs/truck-log/web/styles/src/styles';
export const ENTRY = `${STYLES_ROOT}/truck-log.css`;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
function stripComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1;
      while (j < text.length && text[j] !== q) { if (text[j] === '\\') j++; j++; }
      out += text.slice(i, j + 1); i = j; continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      // Length-preserving: comment characters become spaces (newlines kept) so offsets match the source.
      const e = text.indexOf('*/', i + 2); const end = e < 0 ? text.length : e + 2;
      out += text.slice(i, end).replace(/[^\n]/g, ' '); i = end - 1; continue;
    }
    out += c;
  }
  return out;
}

function findBlockEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return text.length;
}

export function splitTopLevel(text, sep) {
  const parts = []; let depth = 0; let cur = ''; let q = null;
  for (const c of text) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

export function parseDeclarations(body) {
  const decls = [];
  for (const raw of splitTopLevel(body, ';')) {
    const text = raw.trim();
    if (!text) continue;
    const colon = text.indexOf(':');
    if (colon < 0) continue;
    const prop = text.slice(0, colon).trim().toLowerCase();
    let value = text.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    decls.push({ prop, value, important });
  }
  return decls;
}

/**
 * Parse CSS text into a flat list of style rules. Each rule carries the
 * enclosing at-rule preludes (context), e.g. ['@media (max-width: 760px)'].
 * Other at-rules (keyframes, font-face, import) are returned as `atRules`.
 */
export function parseCss(source, file = '') {
  const text = stripComments(source);
  const rules = []; const atRules = [];
  function walk(start, end, context) {
    let i = start;
    while (i < end) {
      while (i < end && /\s/.test(text[i])) i++;
      if (i >= end) break;
      if (text[i] === '}') { i++; continue; }
      // prelude up to { or ;
      let j = i; let q = null; let depth = 0;
      while (j < end) {
        const c = text[j];
        if (q) { if (c === '\\') j++; else if (c === q) q = null; j++; continue; }
        if (c === '"' || c === "'") { q = c; j++; continue; }
        if (c === '(' || c === '[') depth++;
        if (c === ')' || c === ']') depth--;
        if (depth === 0 && (c === '{' || c === ';')) break;
        j++;
      }
      const prelude = text.slice(i, j).trim();
      if (j >= end) break;
      if (text[j] === ';') { if (prelude.startsWith('@')) atRules.push({ prelude, context, file, start: i, end: j + 1 }); i = j + 1; continue; }
      const close = findBlockEnd(text, j);
      if (prelude.startsWith('@')) {
        const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase();
        if (['media', 'supports', 'container', 'layer', 'document'].includes(name)) walk(j + 1, close, [...context, prelude.replace(/\s+/g, ' ')]);
        else atRules.push({ prelude, context, file, body: text.slice(j + 1, close), start: i, end: close + 1 });
      } else {
        const selectors = splitTopLevel(prelude, ',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
        rules.push({ file, context, selectorText: prelude.replace(/\s+/g, ' '), selectors, decls: parseDeclarations(text.slice(j + 1, close)), start: i, end: close + 1, bodyStart: j + 1, bodyEnd: close });
      }
      i = close + 1;
    }
  }
  walk(0, text.length, []);
  return { rules, atRules, text };
}

// ---------------------------------------------------------------------------
// Stylesheet files in cascade order
// ---------------------------------------------------------------------------
export function importOrder(root, entry = ENTRY) {
  const seen = []; const visit = (rel) => {
    const abs = path.join(root, rel);
    const text = fs.readFileSync(abs, 'utf8');
    for (const m of stripComments(text).matchAll(/@import\s+(?:url\()?["']([^"']+)["']\)?[^;]*;/g)) {
      visit(path.posix.join(path.posix.dirname(rel), m[1]));
    }
    seen.push(rel);
  };
  visit(entry);
  return seen;
}

export function loadStylesheets(root) {
  return importOrder(root).map((rel, fileIndex) => {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    const parsed = parseCss(source, rel);
    return { rel, fileIndex, source, ...parsed };
  });
}

// ---------------------------------------------------------------------------
// What the web client can render
// ---------------------------------------------------------------------------
const WEB_SOURCE_DIRS = ['apps/truck-log/src', 'libs/truck-log/web'];

function walkFiles(root, dir, exts) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['node_modules', 'dist'].includes(entry.name)) out.push(...walkFiles(root, rel, exts)); }
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(rel);
  }
  return out;
}

/**
 * Every identifier-like token in the web client's TypeScript and HTML (string
 * literals, class attributes, [class.x] bindings, ngClass keys ...), plus
 * string prefixes that end in '-' or '_' (used to build class names
 * dynamically, e.g. 'dock-age-' + level). Component stylesheets are
 * included as sources too (they can reference global class names in :host-context etc.).
 */
export function webSourceInventory(root) {
  const files = WEB_SOURCE_DIRS.flatMap((d) => walkFiles(root, d, ['.ts', '.html']))
    .filter((f) => !f.startsWith('libs/truck-log/web/styles/'));
  const tokens = new Set();       // any identifier-like token (ids, attribute names)
  const classTokens = new Set();  // tokens that can end up in a class attribute
  const prefixes = new Set();
  const words = (text, into) => { for (const m of String(text).matchAll(/-?[A-Za-z_][\w-]*/g)) into.add(m[0]); };
  const fromHtml = (html) => {
    for (const m of html.matchAll(/\sclass\s*=\s*"([^"]*)"/g)) words(m[1].replace(/\{\{[^}]*\}\}/g, ' '), classTokens);
    for (const m of html.matchAll(/\sclass\s*=\s*'([^']*)'/g)) words(m[1], classTokens);
    for (const m of html.matchAll(/\[class\.([\w-]+)\]/g)) classTokens.add(m[1]);
    // routerLinkActive adds its classes at runtime
    for (const m of html.matchAll(/\srouterLinkActive\s*=\s*"([^"]*)"/g)) words(m[1], classTokens);
    for (const m of html.matchAll(/\[(?:ngClass|class|attr\.class)\]\s*=\s*"([^"]*)"/g)) {
      for (const lit of m[1].matchAll(/'([^']*)'/g)) words(lit[1], classTokens);
      for (const key of m[1].matchAll(/([\w-]+)\s*:/g)) classTokens.add(key[1]);
    }
    for (const m of html.matchAll(/([A-Za-z_][\w-]*[-_])\{\{/g)) prefixes.add(m[1]);
  };
  let allText = '';
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    allText += text + '\n';
    words(text, tokens);
    if (f.endsWith('.html')) { fromHtml(text); continue; }
    // TypeScript: inline templates are scanned as HTML; other string literals may be class names.
    // Comments are dropped first so an apostrophe in prose cannot shift the literal pairing.
    for (const m of stripTsComments(text).matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
      const literal = m[2];
      if (/<[a-zA-Z]/.test(literal)) { fromHtml(literal); continue; }
      words(literal.replace(/\$\{[^}]*\}/g, ' '), classTokens);
      const head = /^([A-Za-z_][\w-]*[-_])(?:\$\{|$)/.exec(literal);
      if (head) prefixes.add(head[1]);
    }
  }
  return { files, tokens, classTokens, prefixes, text: allText };
}

/** Remove line and block comments from TypeScript, leaving string and template literals intact. */
export function stripTsComments(source) {
  let out = '';
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += source[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 1; out += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
  }
  return out;
}

export function classIsLive(name, inventory) {
  if (inventory.classTokens.has(name)) return true;
  for (const prefix of inventory.prefixes) if (name.startsWith(prefix) && name.length > prefix.length) return true;
  return false;
}

export function tokenIsLive(name, inventory) {
  if (inventory.tokens.has(name)) return true;
  for (const prefix of inventory.prefixes) if (name.startsWith(prefix) && name.length > prefix.length) return true;
  return false;
}

// Classes the framework or browser adds at runtime.
const RUNTIME_CLASS = /^(ng-|cdk-|mat-)/;

/** Split a complex selector into compounds separated by combinators. */
function compounds(selector) {
  const parts = []; let cur = ''; let depth = 0; let q = null;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Positive requirements of one compound: classes, ids, attribute names; and nested pseudo-class arguments. */
function compoundRequirements(compound) {
  const req = { classes: [], ids: [], attrs: [], tag: null, alternatives: [], hasRequired: [] };
  let i = 0;
  const tagMatch = /^([a-zA-Z][\w-]*|\*)/.exec(compound);
  if (tagMatch) { req.tag = tagMatch[1].toLowerCase(); i = tagMatch[1].length; }
  while (i < compound.length) {
    const c = compound[i];
    if (c === '.') { const m = /^\.((?:\\.|[\w-])+)/.exec(compound.slice(i)); req.classes.push(m[1].replace(/\\/g, '')); i += m[0].length; continue; }
    if (c === '#') { const m = /^#((?:\\.|[\w-])+)/.exec(compound.slice(i)); req.ids.push(m[1]); i += m[0].length; continue; }
    if (c === '[') {
      const e = compound.indexOf(']', i); const inner = compound.slice(i + 1, e);
      req.attrs.push(inner.split(/[~|^$*]?=/)[0].trim());
      const exact = /^[^~|^$*=]+=\s*["']?([^"'\]]+)["']?\s*$/.exec(inner);
      if (exact) (req.attrValues ??= []).push(exact[1]);
      i = e + 1; continue;
    }
    if (c === ':') {
      const m = /^::?([\w-]+)/.exec(compound.slice(i));
      i += m[0].length;
      if (compound[i] === '(') {
        let depth = 0; let j = i;
        for (; j < compound.length; j++) { if (compound[j] === '(') depth++; else if (compound[j] === ')') { depth--; if (depth === 0) break; } }
        const arg = compound.slice(i + 1, j);
        const name = m[1].toLowerCase();
        if (name === 'is' || name === 'where' || name === 'matches') req.alternatives.push(splitTopLevel(arg, ',').map((s) => s.trim()));
        else if (name === 'has') req.hasRequired.push(splitTopLevel(arg, ',').map((s) => s.trim().replace(/^[>+~]\s*/, '')));
        // :not(), :nth-*(), :host-context() etc. never make a selector dead
        i = j + 1;
      }
      continue;
    }
    i++;
  }
  return req;
}

/**
 * False only when the selector requires a class, id or attribute that the web
 * client never produces (positive positions only; :not() is ignored).
 */
export function selectorIsLive(selector, inventory, knownTags = null) {
  for (const compound of compounds(selector)) {
    const req = compoundRequirements(compound);
    for (const cls of req.classes) if (!RUNTIME_CLASS.test(cls) && !classIsLive(cls, inventory)) return false;
    for (const id of req.ids) if (!tokenIsLive(id, inventory)) return false;
    for (const attr of req.attrs) {
      const name = attr.replace(/^.*\|/, '');
      if (!['type', 'href', 'disabled', 'hidden', 'open', 'role', 'tabindex', 'title', 'lang', 'dir', 'name', 'value', 'readonly', 'required', 'multiple', 'selected', 'checked', 'for', 'id', 'class', 'style', 'src', 'alt', 'target', 'placeholder', 'list', 'colspan'].includes(name)
        && !name.startsWith('aria-') && !tokenIsLive(name, inventory)) return false;
    }
    // an exact attribute value that no web source ever contains can never match
    for (const v of req.attrValues ?? []) if (inventory.text && !inventory.text.includes(v)) return false;
    if (knownTags && req.tag && req.tag !== '*' && req.tag.includes('-') && !knownTags.has(req.tag)) return false;
    for (const alternatives of req.alternatives) if (!alternatives.some((alt) => selectorIsLive(alt, inventory, knownTags))) return false;
    for (const has of req.hasRequired) if (!has.some((alt) => selectorIsLive(alt, inventory, knownTags))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Specificity
// ---------------------------------------------------------------------------
export function specificity(selector) {
  let a = 0, b = 0, c = 0;
  for (const compound of compounds(selector)) {
    let i = 0;
    const tagMatch = /^([a-zA-Z][\w-]*)/.exec(compound);
    if (tagMatch) { c++; i = tagMatch[1].length; }
    while (i < compound.length) {
      const ch = compound[i];
      if (ch === '.') { const m = /^\.((?:\\.|[\w-])+)/.exec(compound.slice(i)); b++; i += m[0].length; continue; }
      if (ch === '#') { const m = /^#((?:\\.|[\w-])+)/.exec(compound.slice(i)); a++; i += m[0].length; continue; }
      if (ch === '[') { const e = compound.indexOf(']', i); b++; i = e + 1; continue; }
      if (ch === ':') {
        const pe = compound[i + 1] === ':';
        const m = /^::?([\w-]+)/.exec(compound.slice(i));
        i += m[0].length;
        const name = m[1].toLowerCase();
        let arg = null;
        if (compound[i] === '(') {
          let depth = 0; let j = i;
          for (; j < compound.length; j++) { if (compound[j] === '(') depth++; else if (compound[j] === ')') { depth--; if (depth === 0) break; } }
          arg = compound.slice(i + 1, j); i = j + 1;
        }
        if (pe || ['before', 'after', 'first-line', 'first-letter', 'placeholder', 'selection', 'marker', 'backdrop'].includes(name)) { c++; continue; }
        if (name === 'where') continue;
        if (['is', 'not', 'has', 'matches'].includes(name) && arg !== null) {
          const best = splitTopLevel(arg, ',').map((s) => specificity(s.trim())).sort(compareSpecificity).pop() ?? [0, 0, 0];
          a += best[0]; b += best[1]; c += best[2]; continue;
        }
        b++; continue;
      }
      i++;
    }
  }
  return [a, b, c];
}

export function compareSpecificity(x, y) {
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

export { compounds, compoundRequirements };
