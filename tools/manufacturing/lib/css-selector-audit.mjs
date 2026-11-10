function normalizeWhitespace(value) {
  return value.trim().replace(/\s+/g, ' ');
}

export function collectQualifiedRules(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let token = '';
  let quote = null;
  let escaped = false;

  const activeAtRules = () => stack
    .filter((entry) => entry.kind === 'at-rule')
    .map((entry) => entry.prelude);

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];

    if (quote) {
      token += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      token += char;
      continue;
    }

    if (char === '{') {
      const prelude = normalizeWhitespace(token);
      token = '';
      const parent = stack.at(-1);
      const canContainRules = !parent || parent.kind === 'at-rule';

      if (canContainRules && prelude && !prelude.startsWith('@')) {
        rules.push({
          selector: prelude,
          atRuleContext: activeAtRules(),
        });
      }

      stack.push(
        prelude.startsWith('@')
          ? { kind: 'at-rule', prelude }
          : { kind: 'qualified-rule', prelude },
      );
      continue;
    }

    if (char === '}') {
      stack.pop();
      token = '';
      continue;
    }

    if (char === ';' && (!stack.length || stack.at(-1)?.kind === 'at-rule')) {
      token = '';
      continue;
    }

    if (!stack.length || stack.at(-1)?.kind === 'at-rule') token += char;
  }

  return rules;
}

export function collectQualifiedSelectors(cssText) {
  return collectQualifiedRules(cssText).map((rule) => rule.selector);
}

function summarize(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return {
    totalRules: values.length,
    uniqueSelectors: counts.size,
    duplicateSelectorCount: duplicates.length,
    duplicates,
  };
}

export function summarizeSelectorDuplicates(cssText) {
  return summarize(collectQualifiedSelectors(cssText));
}

export function summarizeContextualSelectorDuplicates(cssText) {
  const rules = collectQualifiedRules(cssText);
  const values = rules.map((rule) => {
    const context = rule.atRuleContext.length ? rule.atRuleContext.join(' > ') : 'GLOBAL';
    return `${context} :: ${rule.selector}`;
  });
  return summarize(values);
}
