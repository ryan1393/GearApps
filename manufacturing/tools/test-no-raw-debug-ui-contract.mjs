import fs from 'node:fs';
import path from 'node:path';

const roots = [
  'apps/blade-tracking/src',
  'apps/cutter-builder/src',
  'apps/greenshed/src',
  'libs/frontend',
];

const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (
      entry.isFile() && !/\.(spec|test)\.ts$/.test(full) &&
      (full.endsWith('.html') || full.endsWith('.ts'))
    ) {
      files.push(full);
    }
  }
}
for (const root of roots) walk(root);

const forbidden = [
  {
    name: 'Angular json pipe',
    regex: /\|\s*json\b/i,
    reason: 'Raw object JSON must not be rendered in operator-facing templates.',
  },
  {
    name: '<pre> debug block',
    regex: /<pre\b/i,
    reason: 'Raw/debug preformatted object dumps are not allowed in app UI.',
  },
  {
    name: 'JSON.stringify in frontend',
    regex: /JSON\.stringify\(/i,
    reason: 'Frontend components must render typed fields instead of serializing objects.',
  },
  {
    name: 'console.log/debug in frontend',
    regex: /\bconsole\.(?:log|debug)\(/i,
    reason: 'Frontend runtime debug logging must not remain in production-facing code.',
  },
  {
    name: 'whole-object debug interpolation',
    regex: /\{\{\s*(?:result|response|payload|object|debug|value)\s*\}\}/i,
    reason: 'Whole API objects must not be interpolated directly into the UI.',
  },
];

const violations = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  for (const rule of forbidden) {
    for (let index = 0; index < lines.length; index += 1) {
      if (rule.regex.test(lines[index])) {
        violations.push({
          file,
          line: index + 1,
          rule: rule.name,
          source: lines[index].trim(),
        });
      }
    }
  }
}

if (violations.length) {
  console.error('Raw/debug frontend UI violations:');
  for (const violation of violations) {
    console.error(
      ` - ${violation.file}:${violation.line} [${violation.rule}] ${violation.source}`,
    );
  }
  throw new Error(
    `${violations.length} frontend raw/debug rendering violation(s) found.`,
  );
}

console.log(
  `[PASS] No-raw-debug UI contract passed across ${files.length} Angular frontend HTML/TS files.`,
);
