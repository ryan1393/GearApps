#!/usr/bin/env node
/**
 * Static Angular template checker (no Angular compiler needed).
 *
 * For every @Component under apps/truck-log and libs/truck-log/web it:
 *   - extracts the inline `template:` or the `templateUrl` HTML;
 *   - collects every identifier the template reads, calls or assigns
 *     (interpolations, property/event/two-way bindings, structural-directive
 *     microsyntax, @if/@for/@switch/@let blocks, pipe arguments);
 *   - verifies each identifier is a template local (#ref, let-x, *ngFor/@for
 *     variables, `as` aliases, @let) or a member of the component class
 *     (field, getter, method, constructor parameter property, inherited from a
 *     base class declared in this repo) and that it is not `private`;
 *   - verifies child component elements are declared in the parent's
 *     `imports`, unknown custom elements are reported, and every [input] /
 *     (output) binding on a child component exists on that child;
 *   - verifies directive/pipe providers (CommonModule, FormsModule, RouterLink)
 *     are imported when the template uses them.
 *
 * Components and directives from shared Angular libraries (EXTERNAL_LIBRARIES,
 * e.g. @dana/ui) are read from their published typings: each exported class's
 * ɵcmp/ɵdir declaration gives its selector, inputs and outputs, so library
 * elements such as <dana-combobox> get the same import/input/output checks.
 *
 * Usage: node tools/truck-log/check-angular-templates.mjs [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
// Attribute-selector components sit on a native element; its DOM properties stay bindable.
const HOST_ELEMENT_PROPERTIES = new Set(['hidden', 'id', 'title', 'tabIndex', 'className']);

const root = process.cwd();
const verbose = process.argv.includes('--verbose');
const SCAN_DIRS = ['apps/truck-log/src', 'libs/truck-log/web'];
const EXTERNAL_LIBRARIES = ['@dana/ui'];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['node_modules', 'dist', '.angular'].includes(entry.name)) out.push(...walk(abs)); }
    else if (entry.isFile() && abs.endsWith('.ts') && !abs.endsWith('.spec.ts')) out.push(abs);
  }
  return out;
}
const rel = (file) => path.relative(root, file).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// TypeScript masking: blank the *contents* of comments, strings, template
// literals and regex literals (keeping offsets) so brace matching is reliable.
// ---------------------------------------------------------------------------
function maskTs(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0; let lastSig = '';
  const regexAllowedAfter = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const kwBefore = (pos) => { const m = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, pos - 20), pos)); return m && ['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'new'].includes(m[1]); };
  function skipTemplate(start) { // start at backtick, returns index after closing backtick
    let j = start + 1;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') return j + 1;
      if (c === '$' && src[j + 1] === '{') { j = skipCode(j + 2, '}'); continue; }
      j++;
    }
    return j;
  }
  function skipString(start) { const q = src[start]; let j = start + 1; while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; if (src[j] === '\n') break; j++; } return j + 1; }
  function skipCode(start, closer) { // nested code inside ${...}
    let depth = 0; let j = start;
    while (j < src.length) {
      const c = src[j];
      if (c === '`') { j = skipTemplate(j); continue; }
      if (c === '"' || c === "'") { j = skipString(j); continue; }
      if (c === '{') depth++;
      if (c === '}') { if (depth === 0) return j + 1; depth--; }
      j++;
    }
    return j;
  }
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") { const end = skipString(i); blank(i + 1, end - 1); i = end; lastSig = c; continue; }
    if (c === '`') { const end = skipTemplate(i); blank(i + 1, end - 1); i = end; lastSig = '`'; continue; }
    if (c === '/' && (regexAllowedAfter.has(lastSig) || kwBefore(i))) {
      let j = i + 1; let inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      blank(i + 1, j); i = j + 1; while (/[a-z]/.test(src[i] || '')) i++; lastSig = 'r'; continue;
    }
    if (!/\s/.test(c)) lastSig = /[\w$]/.test(c) ? 'w' : c;
    if (lastSig === 'w') { // keyword detection handled by kwBefore
    }
    i++;
  }
  return out.join('');
}

function matchBrace(masked, openIndex) {
  const open = masked[openIndex]; const close = { '{': '}', '(': ')', '[': ']' }[open];
  let depth = 0;
  for (let j = openIndex; j < masked.length; j++) {
    if (masked[j] === open) depth++;
    else if (masked[j] === close) { depth--; if (depth === 0) return j; }
  }
  return -1;
}

// Flatten: keep only depth-0 characters of a class body; nested (), {}, []
// contents become spaces but the bracket characters remain.
function flatten(body) {
  let depth = 0; let out = '';
  for (const c of body) {
    if ('({['.includes(c)) { out += depth === 0 ? c : ' '; depth++; continue; }
    if (')}]'.includes(c)) { depth--; out += depth === 0 ? c : ' '; continue; }
    out += depth === 0 ? c : (c === '\n' ? '\n' : ' ');
  }
  return out;
}

const MODIFIERS = new Set(['public', 'private', 'protected', 'readonly', 'static', 'override', 'declare', 'abstract', 'async', 'get', 'set', 'accessor']);

function parseClassMembers(masked, src, bodyStart, bodyEnd) {
  const body = masked.slice(bodyStart + 1, bodyEnd);
  const flat = flatten(body);
  const members = new Map(); // name -> { private: bool, kind }
  const inputs = new Map(); const outputs = new Set();
  // tokens at depth 0
  const tokenRe = /@[\w$]+\s*\([^)]*\)|[A-Za-z_$#][\w$]*|[;{}()=:?!<>,\[\]\n]|=>/g;
  const tokens = []; let m;
  while ((m = tokenRe.exec(flat))) tokens.push({ t: m[0], i: m.index });
  let atStart = true; let mods = []; let decorators = [];
  for (let k = 0; k < tokens.length; k++) {
    const { t, i } = tokens[k];
    if (t === '\n') {
      // ASI: a newline ends a member when the previous significant token can end one
      const prev = tokens.slice(0, k).reverse().find((x) => x.t !== '\n');
      if (prev && (/^[\w$#]/.test(prev.t) || [')', ']', '}'].includes(prev.t)) && !atStart) {
        const next = tokens[k + 1];
        if (next && (/^[A-Za-z_$#@]/.test(next.t))) { atStart = true; mods = []; decorators = []; }
      }
      continue;
    }
    if (t === ';' || t === '}') { atStart = true; mods = []; decorators = []; continue; }
    if (!atStart) continue;
    if (t.startsWith('@')) { decorators.push(t); continue; }
    if (MODIFIERS.has(t)) {
      const next = tokens[k + 1]?.t;
      // `get`/`set`/`readonly` used as a member name themselves
      if (next && /^[A-Za-z_$#]/.test(next)) { mods.push(t); continue; }
    }
    if (/^[A-Za-z_$#][\w$]*$/.test(t)) {
      const name = t;
      const next = tokens[k + 1]?.t;
      if (name === 'constructor' && next === '(') {
        // constructor parameter properties
        const open = bodyStart + 1 + i + flat.slice(i).indexOf('(');
        const close = matchBrace(masked, open);
        const params = flatten(masked.slice(open + 1, close));
        for (const part of params.split(',')) {
          const pm = /^\s*(?:@[\w$]+\s*\(\s*\)\s*)*((?:(?:public|private|protected|readonly|override)\s+)+)([\w$]+)/.exec(part);
          if (pm) members.set(pm[2], { private: /\bprivate\b/.test(pm[1]), kind: 'param' });
        }
      } else if (next === undefined || ['(', ':', '=', ';', '?', '!', '<', '\n', '}'].includes(next)) {
        const isPrivate = mods.includes('private') || name.startsWith('#');
        members.set(name, { private: isPrivate, kind: mods.includes('get') ? 'getter' : next === '(' ? 'method' : 'field' });
        const decoText = decorators.join(' ');
        const dm = /@Input\s*\(\s*(?:['"]([^'"]*)['"])?/.exec(decoText);
        if (dm) {
          // masked strings: recover alias from the original source
          const realDeco = src.slice(bodyStart + 1, bodyStart + 1 + i);
          const alias = /@Input\s*\(\s*['"]([^'"]+)['"]\s*\)\s*(?:\w+\s+)*$/.exec(realDeco.slice(-200));
          inputs.set(alias ? alias[1] : name, name);
        }
        if (/@Output\s*\(/.test(decoText)) {
          const realDeco = src.slice(bodyStart + 1, bodyStart + 1 + i);
          const alias = /@Output\s*\(\s*['"]([^'"]+)['"]\s*\)\s*(?:\w+\s+)*$/.exec(realDeco.slice(-200));
          outputs.add(alias ? alias[1] : name);
        }
        // signal inputs / outputs / models
        const init = src.slice(bodyStart + 1 + i, bodyStart + 1 + i + 200);
        if (/^[\w$]+\s*(?::[^=]*)?=\s*input(?:\.required)?\s*[<(]/.test(init)) inputs.set(name, name);
        if (/^[\w$]+\s*(?::[^=]*)?=\s*output(?:FromObservable)?\s*[<(]/.test(init)) outputs.add(name);
        if (/^[\w$]+\s*(?::[^=]*)?=\s*model(?:\.required)?\s*[<(]/.test(init)) { inputs.set(name, name); outputs.add(name + 'Change'); }
      }
      atStart = false; mods = []; decorators = [];
    }
  }
  return { members, inputs, outputs };
}

// ---------------------------------------------------------------------------
// Collect classes and components across the scanned tree.
// ---------------------------------------------------------------------------
const classes = new Map(); // name -> { file, members, inputs, outputs, base }
const components = [];
const directives = []; // { className, attribute }
const files = SCAN_DIRS.flatMap((d) => walk(path.join(root, d)));
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const masked = maskTs(src);
  const classRe = /\bclass\s+([\w$]+)\s*(?:<[^{]*?>)?\s*(?:extends\s+([\w$.]+)\s*(?:<[^{]*?>)?)?\s*(?:implements\s+[^{]*)?\{/g;
  let cm;
  while ((cm = classRe.exec(masked))) {
    const open = cm.index + cm[0].length - 1;
    const close = matchBrace(masked, open);
    const info = parseClassMembers(masked, src, open, close);
    const entry = { name: cm[1], file, base: cm[2] || null, ...info };
    classes.set(cm[1], entry);
    // Component decorator immediately before this class?
    const before = masked.slice(0, cm.index);
    const dirIdx = before.lastIndexOf('@Directive(');
    if (dirIdx >= 0 && !before.slice(dirIdx).match(/\bclass\s+[\w$]+/)) {
      const sel = /\bselector\s*:\s*(['"])/.exec(masked.slice(dirIdx));
      if (sel) {
        const s0 = dirIdx + sel.index + sel[0].length;
        for (const part of src.slice(s0, src.indexOf(sel[1], s0)).split(',')) {
          const am = /^\s*\[([\w-]+)\]\s*$/.exec(part);
          if (am) directives.push({ className: cm[1], attribute: am[1] });
        }
      }
    }
    const decoIdx = before.lastIndexOf('@Component(');
    if (decoIdx >= 0) {
      const prevClass = before.slice(decoIdx).match(/\bclass\s+[\w$]+/);
      if (!prevClass) {
        const dOpen = decoIdx + '@Component'.length;
        const dClose = matchBrace(masked, dOpen);
        const decoMasked = masked.slice(dOpen, dClose + 1);
        const decoSrc = src.slice(dOpen, dClose + 1);
        const comp = { className: cm[1], file, selector: null, template: null, templateFile: null, imports: [] };
        const sel = /\bselector\s*:\s*(['"])/.exec(decoMasked);
        if (sel) { const s = dOpen + sel.index + sel[0].length; comp.selector = src.slice(s, src.indexOf(sel[1], s)); }
        const tpl = /\btemplate\s*:\s*([`'"])/.exec(decoMasked);
        if (tpl) {
          const s = dOpen + tpl.index + tpl[0].length;
          let e = s; while (masked[e] !== tpl[1]) e++;
          comp.template = src.slice(s, e);
          comp.templateOffset = s;
        }
        const tplUrl = /\btemplateUrl\s*:\s*(['"])/.exec(decoMasked);
        if (tplUrl) {
          const s = dOpen + tplUrl.index + tplUrl[0].length;
          const url = src.slice(s, src.indexOf(tplUrl[1], s));
          comp.templateFile = path.resolve(path.dirname(file), url);
        }
        const imp = /\bimports\s*:\s*\[/.exec(decoMasked);
        if (imp) {
          const iOpen = dOpen + imp.index + imp[0].length - 1;
          const iClose = matchBrace(masked, iOpen);
          comp.imports = masked.slice(iOpen + 1, iClose).split(',').map((s) => s.trim()).filter(Boolean);
        }
        void decoSrc;
        components.push(comp);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shared library components/directives, from their compiled typings.
// ---------------------------------------------------------------------------
function declarationName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) ? node.text : null;
}

function stringType(node) {
  return node && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) ? node.literal.text : null;
}

function parseDeclarationMap(node) {
  // Angular inputs are either alias strings or { alias: string; required: boolean; ... }.
  const map = new Map();
  if (!node || !ts.isTypeLiteralNode(node)) return map;
  for (const member of node.members) {
    const name = declarationName(member.name);
    if (!name || !ts.isPropertySignature(member)) continue;
    let alias = stringType(member.type);
    if (member.type && ts.isTypeLiteralNode(member.type)) {
      const aliasMember = member.type.members.find((field) => declarationName(field.name) === 'alias');
      if (aliasMember && ts.isPropertySignature(aliasMember)) alias = stringType(aliasMember.type);
    }
    if (alias) map.set(alias, name);
  }
  return map;
}

function resolveDeclaration(from, specifier) {
  const base = path.resolve(path.dirname(from), specifier.replace(/\.(?:mjs|cjs|js)$/, ''));
  return [base + '.d.ts', base, path.join(base, 'index.d.ts')]
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function exportedDeclarationClasses(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const result = new Map();
  cache.set(file, result);
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const local = new Map();
  for (const statement of source.statements) {
    if (ts.isClassDeclaration(statement) && statement.name) {
      const entry = { node: statement, source, file };
      local.set(statement.name.text, entry);
      if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) result.set(statement.name.text, entry);
    }
  }
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    let available = local;
    if (statement.moduleSpecifier) {
      if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
      const next = resolveDeclaration(file, statement.moduleSpecifier.text);
      if (!next) continue;
      available = exportedDeclarationClasses(next, cache);
    }
    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const entry = available.get(element.propertyName?.text ?? element.name.text);
        if (entry) result.set(element.name.text, entry);
      }
    } else if (!statement.exportClause && statement.moduleSpecifier) {
      for (const [name, entry] of available) result.set(name, entry);
    }
  }
  return result;
}

let externalDeclarations = 0;
for (const pkg of EXTERNAL_LIBRARIES) {
  const pkgDir = path.join(root, 'node_modules', pkg);
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) { console.error(`[FAIL] Shared UI library ${pkg} is not installed (node_modules/${pkg}).`); process.exit(1); }
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const entry = path.join(pkgDir, pkgJson.typings || pkgJson.types || 'index.d.ts');
  // Angular 19 packages re-export one declaration per file. Angular 20 packages
  // may bundle local `declare class` declarations and export them at the end.
  for (const [name, { node, source, file }] of exportedDeclarationClasses(entry)) {
    const members = new Map();
    for (const member of node.members) {
      const memberName = declarationName(member.name);
      if (!memberName) continue;
      const privateMember = member.modifiers?.some((modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword);
      members.set(memberName, { private: Boolean(privateMember), kind: 'field' });
    }
    const declaration = node.members.find((member) => {
      if (!['ɵcmp', 'ɵdir'].includes(declarationName(member.name)) || !member.type || !ts.isTypeReferenceNode(member.type)) return false;
      const typeName = member.type.typeName;
      const identifier = ts.isQualifiedName(typeName) ? typeName.right.text : typeName.text;
      return ['ɵɵComponentDeclaration', 'ɵɵDirectiveDeclaration'].includes(identifier);
    });
    const valueAccessor = node.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword &&
      clause.types.some((type) => /(?:^|\.)ControlValueAccessor$/.test(type.expression.getText(source)))) ||
      (members.has('writeValue') && members.has('registerOnChange'));
    const info = { name, file, base: null, members, inputs: new Map(), outputs: new Set(), external: pkg, valueAccessor: Boolean(valueAccessor) };
    if (declaration) {
      const args = declaration.type.typeArguments ?? [];
      const selector = stringType(args[1]) ?? '';
      info.inputs = parseDeclarationMap(args[3]);
      info.outputs = new Set(parseDeclarationMap(args[4]).keys());
      if (declarationName(declaration.name) === 'ɵcmp') components.push({ className: name, file, selector, template: null, templateFile: null, imports: [], external: pkg });
      else for (const part of selector.split(',')) {
        const am = /^\s*\[([\w-]+)\]\s*$/.exec(part);
        if (am) directives.push({ className: name, attribute: am[1] });
      }
      externalDeclarations++;
    }
    classes.set(name, info);
  }
}

for (const c of classes.values()) if (c.valueAccessor === undefined) c.valueAccessor = c.members.has('writeValue') && c.members.has('registerOnChange');

function allMembers(className, seen = new Set()) {
  const c = classes.get(className);
  if (!c || seen.has(className)) return new Map();
  seen.add(className);
  const base = c.base ? allMembers(c.base, seen) : new Map();
  return new Map([...base, ...c.members]);
}
function allInputs(className) { const c = classes.get(className); if (!c) return new Map(); return new Map([...(c.base ? allInputs(c.base) : []), ...c.inputs]); }
function allOutputs(className) { const c = classes.get(className); if (!c) return new Set(); return new Set([...(c.base ? allOutputs(c.base) : []), ...c.outputs]); }

const selectorToComponent = new Map();
const attributeComponents = []; // { tag: string | null, attribute, component } for selectors like section[tlFoo] or [tlFoo]
for (const c of components) {
  if (!c.selector) continue;
  for (const s of c.selector.split(',').map((x) => x.trim())) {
    if (/^[a-z][\w-]*$/.test(s)) { selectorToComponent.set(s, c); continue; }
    const am = /^([a-z][\w-]*)?\[([\w-]+)\]$/.exec(s);
    if (am) attributeComponents.push({ tag: am[1] ?? null, attribute: am[2], component: c });
  }
}

// ---------------------------------------------------------------------------
// Template parsing.
// ---------------------------------------------------------------------------
const KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'this', 'typeof', 'void', 'in', '$event', '$any', 'instanceof']);
const FOR_IMPLICIT = ['$index', '$first', '$last', '$even', '$odd', '$count'];

function tokenizeExpr(expr) {
  const tokens = []; let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < expr.length && expr[j] !== c) { if (expr[j] === '\\') j++; j++; } tokens.push({ type: 'str' }); i = j + 1; continue; }
    if (c === '`') { // untagged template literal: scan ${ } parts as expressions
      let j = i + 1; const parts = [];
      while (j < expr.length && expr[j] !== '`') {
        if (expr[j] === '\\') { j += 2; continue; }
        if (expr[j] === '$' && expr[j + 1] === '{') { let d = 1; const s = j + 2; j += 2; while (j < expr.length && d) { if (expr[j] === '{') d++; else if (expr[j] === '}') d--; j++; } parts.push(expr.slice(s, j - 1)); continue; }
        j++;
      }
      tokens.push({ type: 'tpl', parts }); i = j + 1; continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(expr.slice(i));
    if (id) { tokens.push({ type: 'id', v: id[0] }); i += id[0].length; continue; }
    const num = /^\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(expr.slice(i));
    if (num) { tokens.push({ type: 'num' }); i += num[0].length; continue; }
    const op = /^(\?\.|\?\?|\|\||&&|===|!==|==|!=|<=|>=|=>|\.\.\.|[-+*/%<>!=?:.,;|()[\]{}&])/.exec(expr.slice(i));
    if (op) { tokens.push({ type: 'op', v: op[0] }); i += op[0].length; continue; }
    i++;
  }
  return tokens;
}

/** Root identifiers read/called/assigned by an expression or statement. */
function rootIdentifiers(expr) {
  const tokens = tokenizeExpr(expr);
  const roots = []; const stack = [];
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.type === 'tpl') { for (const p of tok.parts) roots.push(...rootIdentifiers(p)); continue; }
    if (tok.type === 'op') {
      if (['(', '[', '{'].includes(tok.v)) stack.push(tok.v);
      if ([')', ']', '}'].includes(tok.v)) stack.pop();
      continue;
    }
    if (tok.type !== 'id') continue;
    const prev = tokens[k - 1]; const prev2 = tokens[k - 2]; const next = tokens[k + 1];
    if (prev && prev.type === 'op' && (prev.v === '.' || prev.v === '?.')) {
      if (prev2 && prev2.type === 'id' && prev2.v === 'this' && !(tokens[k - 3]?.type === 'op' && ['.', '?.'].includes(tokens[k - 3].v))) roots.push(tok.v);
      continue;
    }
    if (prev && prev.type === 'op' && prev.v === '|' ) continue; // pipe name
    if (stack[stack.length - 1] === '{' && next && next.type === 'op' && next.v === ':' && prev && prev.type === 'op' && (prev.v === '{' || prev.v === ',')) continue; // object key
    if (KEYWORDS.has(tok.v)) continue;
    roots.push(tok.v);
  }
  return roots;
}
function pipeNames(expr) {
  const tokens = tokenizeExpr(expr); const names = [];
  for (let k = 1; k < tokens.length; k++) if (tokens[k].type === 'id' && tokens[k - 1].type === 'op' && tokens[k - 1].v === '|') names.push(tokens[k].v);
  return names;
}

function splitTop(text, sep) {
  const parts = []; let depth = 0; let cur = ''; let q = null;
  for (const c of text) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function parseTemplate(html) {
  const exprs = []; // { text, where }
  const locals = new Set();
  const elements = []; // { tag, attrs: [{name, value}] }
  const usedPipes = new Set();
  const addExpr = (text, where) => { exprs.push({ text, where }); };
  const interpolations = (text, where) => { const re = /\{\{([\s\S]*?)\}\}/g; let m; while ((m = re.exec(text))) addExpr(m[1], where); };

  function microsyntax(directive, value, where) {
    const segments = splitTop(value, ';').map((s) => s.trim()).filter(Boolean);
    segments.forEach((seg, index) => {
      let rest = seg;
      const letm = /^let\s+([\w$]+)\s*(?:=\s*([\w$]+))?\s*/.exec(rest);
      if (letm) {
        locals.add(letm[1]);
        rest = rest.slice(letm[0].length);
        // "let item of items" -> keyword + expression follows
        const kw = /^,?\s*([\w$]+)\s*:?\s*/.exec(rest);
        if (rest && kw) addExpr(rest.slice(kw[0].length), where + ' ' + kw[1]);
        return;
      }
      const asm = /^([\s\S]*?)\s+as\s+([\w$]+)$/.exec(rest);
      if (index > 0 && asm && /^[\w$]+$/.test(asm[1].trim())) { locals.add(asm[2]); return; } // index as i
      if (index > 0) { const kw = /^([\w$]+)\s*:?\s*/.exec(rest); if (kw) rest = rest.slice(kw[0].length); }
      const as2 = /^([\s\S]*?)\s+as\s+([\w$]+)$/.exec(rest);
      if (as2) { locals.add(as2[2]); rest = as2[1]; }
      if (rest.trim()) addExpr(rest, `${where} *${directive}`);
    });
  }

  function blockHeader(name, params, where) {
    if (params == null) return;
    if (name === 'if' || name === 'else if') {
      const parts = splitTop(params, ';');
      addExpr(parts[0], where);
      for (const p of parts.slice(1)) { const am = /^\s*as\s+([\w$]+)\s*$/.exec(p); if (am) locals.add(am[1]); }
    } else if (name === 'for') {
      const parts = splitTop(params, ';');
      const fm = /^\s*([\w$]+)\s+of\s+([\s\S]*)$/.exec(parts[0]);
      if (fm) { locals.add(fm[1]); addExpr(fm[2], where); }
      FOR_IMPLICIT.forEach((x) => locals.add(x));
      for (const p of parts.slice(1)) {
        const tm = /^\s*track\s+([\s\S]*)$/.exec(p);
        if (tm) { addExpr(tm[1], where + ' track'); continue; }
        const lm = /^\s*let\s+([\s\S]*)$/.exec(p);
        if (lm) for (const a of lm[1].split(',')) { const am = /^\s*([\w$]+)\s*=/.exec(a); if (am) locals.add(am[1]); }
      }
    } else if (name === 'switch' || name === 'case') {
      addExpr(params, where);
    }
  }

  let i = 0;
  const n = html.length;
  while (i < n) {
    if (html.startsWith('<!--', i)) { const e = html.indexOf('-->', i); i = e < 0 ? n : e + 3; continue; }
    if (html.startsWith('{{', i)) { const e = html.indexOf('}}', i); addExpr(html.slice(i + 2, e), 'interpolation'); i = e + 2; continue; }
    if (html[i] === '<' && /[a-zA-Z]/.test(html[i + 1] || '')) {
      let j = i + 1; while (j < n && /[\w:-]/.test(html[j])) j++;
      const tag = html.slice(i + 1, j).toLowerCase();
      const attrs = [];
      while (j < n) {
        while (j < n && /\s/.test(html[j])) j++;
        if (html[j] === '>') { j++; break; }
        if (html[j] === '/' && html[j + 1] === '>') { j += 2; break; }
        let s = j; while (j < n && !/[\s=>]/.test(html[j]) && !(html[j] === '/' && html[j + 1] === '>')) j++;
        const name = html.slice(s, j);
        while (j < n && /\s/.test(html[j])) j++;
        let value = null;
        if (html[j] === '=') {
          j++; while (j < n && /\s/.test(html[j])) j++;
          if (html[j] === '"' || html[j] === "'") { const q = html[j]; const e = html.indexOf(q, j + 1); value = html.slice(j + 1, e); j = e + 1; }
          else { s = j; while (j < n && !/[\s>]/.test(html[j])) j++; value = html.slice(s, j); }
        }
        if (!name) { j++; continue; }
        attrs.push({ name, value });
      }
      elements.push({ tag, attrs });
      const where = `<${tag}>`;
      for (const { name, value } of attrs) {
        if (name.startsWith('#')) { locals.add(name.slice(1)); continue; }
        if (name.startsWith('ref-')) { locals.add(name.slice(4)); continue; }
        if (name.startsWith('let-')) { locals.add(name.slice(4)); continue; }
        if (value == null) continue;
        const decoded = value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        if (name.startsWith('*')) { microsyntax(name.slice(1), decoded, where); continue; }
        if (/^\[\(.*\)\]$/.test(name) || name.startsWith('bindon-')) { addExpr(decoded, `${where} ${name}`); continue; }
        if (/^\[.*\]$/.test(name) || name.startsWith('bind-')) { addExpr(decoded, `${where} ${name}`); continue; }
        if (/^\(.*\)$/.test(name) || name.startsWith('on-')) { for (const stmt of splitTop(decoded, ';')) if (stmt.trim()) addExpr(stmt, `${where} ${name}`); continue; }
        if (decoded.includes('{{')) interpolations(decoded, `${where} ${name}`);
      }
      // raw-text elements
      if (tag === 'script' || tag === 'style') { const e = html.indexOf(`</${tag}`, j); i = e < 0 ? n : e; continue; }
      i = j; continue;
    }
    if (html[i] === '@') {
      const m = /^@(else\s+if|if|for|switch|case|default|defer|placeholder|loading|error|empty|else|let)\b/.exec(html.slice(i));
      if (m) {
        const name = m[1].replace(/\s+/g, ' ');
        let j = i + m[0].length;
        if (name === 'let') {
          const e = html.indexOf(';', j);
          const lm = /^\s*([\w$]+)\s*=\s*([\s\S]*)$/.exec(html.slice(j, e));
          if (lm) { locals.add(lm[1]); addExpr(lm[2], '@let'); }
          i = e + 1; continue;
        }
        while (j < n && /\s/.test(html[j])) j++;
        let params = null;
        if (html[j] === '(') {
          let d = 0; let q = null; const s = j;
          for (; j < n; j++) {
            const c = html[j];
            if (q) { if (c === q) q = null; continue; }
            if (c === '"' || c === "'") { q = c; continue; }
            if (c === '(') d++;
            if (c === ')') { d--; if (d === 0) { j++; break; } }
          }
          params = html.slice(s + 1, j - 1);
        }
        blockHeader(name, params, `@${name}`);
        i = j; continue;
      }
    }
    i++;
  }
  for (const e of exprs) for (const p of pipeNames(e.text)) usedPipes.add(p);
  return { exprs, locals, elements, usedPipes };
}

// ---------------------------------------------------------------------------
// Checks.
// ---------------------------------------------------------------------------
const problems = [];
const DOM_EVENTS = new Set(['click', 'dblclick', 'keydown', 'keyup', 'keypress', 'focus', 'blur', 'focusin', 'focusout', 'input', 'change', 'submit', 'mouseenter', 'mouseleave', 'mousedown', 'mouseup', 'mouseover', 'mouseout', 'mousemove', 'scroll', 'wheel', 'dragover', 'dragenter', 'dragleave', 'drop', 'paste', 'copy', 'cut', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'contextmenu', 'load', 'error', 'animationend', 'transitionend', 'toggle', 'close', 'cancel', 'reset', 'ngSubmit', 'ngModelChange', 'beforeinput', 'compositionstart', 'compositionend', 'select', 'resize', 'visibilitychange']);
const NATIVE_OR_FRAMEWORK_ELEMENTS = new Set(['ng-container', 'ng-template', 'ng-content', 'router-outlet']);
const COMMON_DIRECTIVES = { ngIf: ['CommonModule', 'NgIf'], ngFor: ['CommonModule', 'NgFor', 'NgForOf'], ngClass: ['CommonModule', 'NgClass'], ngStyle: ['CommonModule', 'NgStyle'], ngTemplateOutlet: ['CommonModule', 'NgTemplateOutlet'], ngSwitch: ['CommonModule', 'NgSwitch'], ngModel: ['FormsModule'], ngSubmit: ['FormsModule', 'ReactiveFormsModule'], formGroup: ['ReactiveFormsModule'], formControl: ['ReactiveFormsModule'], formControlName: ['ReactiveFormsModule'], routerLink: ['RouterLink', 'RouterModule'], routerLinkActive: ['RouterLinkActive', 'RouterModule'] };
const COMMON_PIPES = { date: ['CommonModule', 'DatePipe'], number: ['CommonModule', 'DecimalPipe'], json: ['CommonModule', 'JsonPipe'], async: ['CommonModule', 'AsyncPipe'], titlecase: ['CommonModule', 'TitleCasePipe'], uppercase: ['CommonModule', 'UpperCasePipe'], lowercase: ['CommonModule', 'LowerCasePipe'], slice: ['CommonModule', 'SlicePipe'], percent: ['CommonModule', 'PercentPipe'], currency: ['CommonModule', 'CurrencyPipe'], keyvalue: ['CommonModule', 'KeyValuePipe'],
  // Truck Log's own pipe (web/ui plant-date.pipe.ts): dates in plant time, never the device's zone.
  plantDate: ['PlantDatePipe'] };

let checkedIdentifiers = 0;
const localComponents = components.filter((comp) => !comp.external);
for (const comp of localComponents) {
  let html = comp.template;
  if (comp.templateFile) {
    if (!fs.existsSync(comp.templateFile)) { problems.push(`${rel(comp.file)}: templateUrl ${rel(comp.templateFile)} does not exist`); continue; }
    html = fs.readFileSync(comp.templateFile, 'utf8');
  }
  if (html == null) { problems.push(`${rel(comp.file)}: ${comp.className} has no template`); continue; }
  const where = `${rel(comp.templateFile || comp.file)} (${comp.className})`;
  const members = allMembers(comp.className);
  const { exprs, locals, elements, usedPipes } = parseTemplate(html);
  const reported = new Set();
  for (const e of exprs) {
    for (const id of rootIdentifiers(e.text)) {
      checkedIdentifiers++;
      if (locals.has(id)) continue;
      const member = members.get(id);
      const key = `${id}@${e.where}`;
      if (!member) { if (!reported.has(key)) problems.push(`${where}: '${id}' is not a template local or member of ${comp.className} (in ${e.where}: ${e.text.trim().slice(0, 80)})`); reported.add(key); continue; }
      if (member.private) { if (!reported.has(key)) problems.push(`${where}: '${id}' is private in ${comp.className} but used by the template (${e.where})`); reported.add(key); }
    }
  }
  const imports = new Set(comp.imports);
  for (const el of elements) {
    const bareNames = el.attrs.map(({ name }) => name.replace(/^\[\(|\)\]$|^[[(*]|[\])]$/g, ''));
    const present = directives.filter((d) => bareNames.includes(d.attribute));
    for (const d of present) if (!imports.has(d.className)) problems.push(`${where}: <${el.tag}> uses [${d.attribute}] but ${d.className} is not in imports`);
    const directiveOutputs = new Set(present.flatMap((d) => [...allOutputs(d.className)]));
    const hostedComponent = attributeComponents.find((a) => bareNames.includes(a.attribute) && (!a.tag || a.tag === el.tag));
    if (hostedComponent) {
      const child = hostedComponent.component;
      if (!imports.has(child.className)) problems.push(`${where}: <${el.tag} ${hostedComponent.attribute}> is used but ${child.className} is not in imports`);
      const inputs = allInputs(child.className); const outputs = allOutputs(child.className);
      for (const { name } of el.attrs) {
        let m;
        if ((m = /^\[([\w$]+)\]$/.exec(name))) { if (!inputs.has(m[1]) && !COMMON_DIRECTIVES[m[1]] && !HOST_ELEMENT_PROPERTIES.has(m[1]) && !directives.some((d) => d.attribute === m[1])) problems.push(`${where}: <${el.tag} ${hostedComponent.attribute}> has no @Input '${m[1]}'`); continue; }
        if ((m = /^\(([\w$]+)\)$/.exec(name))) { if (!outputs.has(m[1]) && !DOM_EVENTS.has(m[1]) && !directiveOutputs.has(m[1])) problems.push(`${where}: <${el.tag} ${hostedComponent.attribute}> has no @Output '${m[1]}'`); }
      }
      for (const output of outputs) directiveOutputs.add(output);
    }
    if (!el.tag.includes('-') || NATIVE_OR_FRAMEWORK_ELEMENTS.has(el.tag)) {
      for (const { name } of el.attrs) {
        const m = /^\(([\w$]+)(?:\.[\w.]+)?\)$/.exec(name);
        if (m && !DOM_EVENTS.has(m[1]) && !directiveOutputs.has(m[1])) problems.push(`${where}: <${el.tag}> binds unknown event (${m[1]})`);
      }
    }
    if (el.tag.includes('-') && !NATIVE_OR_FRAMEWORK_ELEMENTS.has(el.tag)) {
      const child = selectorToComponent.get(el.tag);
      if (!child) { problems.push(`${where}: unknown element <${el.tag}>`); continue; }
      if (!imports.has(child.className)) problems.push(`${where}: <${el.tag}> is used but ${child.className} is not in imports`);
      const inputs = allInputs(child.className); const outputs = allOutputs(child.className);
      for (const { name } of el.attrs) {
        let m;
        if ((m = /^\[\(([\w$]+)\)\]$/.exec(name))) {
          if (m[1] === 'ngModel') { if (!classes.get(child.className)?.valueAccessor) problems.push(`${where}: <${el.tag}> uses [(ngModel)] but ${child.className} is not a ControlValueAccessor`); continue; }
          if (!inputs.has(m[1]) || !outputs.has(m[1] + 'Change')) problems.push(`${where}: <${el.tag}> has no two-way binding [(${m[1]})]`); continue;
        }
        if ((m = /^\[([\w$]+)\]$/.exec(name))) { if (!inputs.has(m[1]) && !COMMON_DIRECTIVES[m[1]]) problems.push(`${where}: <${el.tag}> has no @Input '${m[1]}'`); continue; }
        if ((m = /^\(([\w$]+)\)$/.exec(name))) { if (!outputs.has(m[1]) && !DOM_EVENTS.has(m[1]) && !directiveOutputs.has(m[1])) problems.push(`${where}: <${el.tag}> has no @Output '${m[1]}'`); continue; }
      }
    }
    for (const { name } of el.attrs) {
      const bare = name.replace(/^[[(*]+|[\])]+$/g, '').split('.')[0];
      const needed = COMMON_DIRECTIVES[bare];
      if (!needed) continue;
      if (bare === 'ngSubmit' && el.tag !== 'form') continue;
      if (bare === 'routerLink' || bare === 'routerLinkActive') { if (!needed.some((x) => imports.has(x))) problems.push(`${where}: uses ${bare} without importing ${needed.join(' or ')}`); continue; }
      if (!needed.some((x) => imports.has(x))) problems.push(`${where}: uses ${name} without importing ${needed.join(' or ')}`);
    }
  }
  for (const pipe of usedPipes) {
    // Angular's date pipe formats in the device's time zone; handhelds and TVs are often wrong.
    if (pipe === 'date') { problems.push(`${where}: use '| plantDate' (plant time zone) instead of '| date'`); continue; }
    const needed = COMMON_PIPES[pipe];
    if (!needed) { problems.push(`${where}: unknown pipe '${pipe}'`); continue; }
    if (!needed.some((x) => imports.has(x))) problems.push(`${where}: uses pipe '${pipe}' without importing ${needed.join(' or ')}`);
  }
  if (verbose) console.log(`  ${where}: ${exprs.length} expressions, ${locals.size} locals, ${members.size} members`);
}

if (problems.length) {
  for (const p of [...new Set(problems)]) console.error(`[FAIL] ${p}`);
  console.error(`Angular template check failed: ${problems.length} problem(s) across ${localComponents.length} components.`);
  process.exit(1);
}
console.log(`[PASS] Angular templates: ${localComponents.length} components, ${checkedIdentifiers} identifier uses resolve to members or template locals; child components, bindings, directives and pipes are imported (${externalDeclarations} declarations read from ${EXTERNAL_LIBRARIES.join(', ')}).`);
