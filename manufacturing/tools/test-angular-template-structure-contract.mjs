import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const scanRoots = ['apps', path.join('libs', 'frontend')];
const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

function walk(dir, out = []) {
  if (!fs.existsSync(contractPath(process.cwd(), dir))) return out;
  for (const entry of fs.readdirSync(contractPath(process.cwd(), dir), { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function readTag(text, start) {
  let quote = null;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '>') return { raw: text.slice(start, i + 1), end: i + 1 };
  }
  return { raw: text.slice(start), end: text.length };
}

function position(text, offset) {
  const before = text.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function validateTemplate(file) {
  const text = fs.readFileSync(contractPath(process.cwd(), file), 'utf8');
  const stack = [];
  const errors = [];
  let i = 0;

  while (i < text.length) {
    const start = text.indexOf('<', i);
    if (start < 0) break;

    if (text.startsWith('<!--', start)) {
      const commentEnd = text.indexOf('-->', start + 4);
      i = commentEnd < 0 ? text.length : commentEnd + 3;
      continue;
    }

    const { raw, end } = readTag(text, start);
    i = end;
    if (/^<!/.test(raw) || /^<\?/.test(raw)) continue;

    const match = raw.match(/^<\s*(\/?)\s*([A-Za-z][\w:-]*)\b([\s\S]*?)>$/);
    if (!match) continue;

    const [, closing, originalName, attrs] = match;
    const name = originalName.toLowerCase();
    if (voidTags.has(name) || /\/\s*>$/.test(raw)) continue;

    if (!closing) {
      stack.push({ name, offset: start });
      continue;
    }

    const pos = position(text, start);
    if (stack.length === 0) {
      errors.push(`${file}:${pos.line}:${pos.column} unexpected closing </${name}>`);
      continue;
    }

    const top = stack.at(-1);
    if (top.name === name) {
      stack.pop();
      continue;
    }

    errors.push(`${file}:${pos.line}:${pos.column} unexpected closing </${name}>; expected </${top.name}>`);
    const matchingIndex = stack.map((x) => x.name).lastIndexOf(name);
    if (matchingIndex >= 0) stack.splice(matchingIndex);
  }

  for (const unclosed of stack) {
    const pos = position(text, unclosed.offset);
    errors.push(`${file}:${pos.line}:${pos.column} unclosed <${unclosed.name}>`);
  }
  return errors;
}

const files = scanRoots.flatMap((dir) => walk(contractPath(root, dir))).sort();
if (files.length === 0) {
  console.error('[FAIL] Angular template structure contract found no templates to scan.');
  process.exit(1);
}

const errors = files.flatMap(validateTemplate);
if (errors.length) {
  console.error(`[FAIL] Angular template structure contract found ${errors.length} tag-balance problem(s):`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(`[PASS] Angular template structure contract passed: ${files.length} templates have balanced element tags.`);
