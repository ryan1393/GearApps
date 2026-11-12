import fs from 'node:fs';
import path from 'node:path';
import { contractPath } from './contract-paths.mjs';

// The Admin screen is a shell (header, section navigation, router outlet) plus one routed
// component per tab under tabs/ and the helpers they share under shared/. Contracts that
// check what the Admin screen does read all of them together, in a stable order.
const ADMIN_LIB = 'libs/manufacturing/frontend/feature-admin-users/src/lib';
const ADMIN_SHELL = `${ADMIN_LIB}/frontend-feature-admin-users/frontend-feature-admin-users.component`;

function sourcesUnder(root, relativeDir, extension) {
  const absolute = contractPath(root, relativeDir);
  if (!fs.existsSync(absolute)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(extension) && !entry.name.endsWith(`.spec${extension}`)) files.push(full);
    }
  };
  walk(absolute);
  return files;
}

/** Shell, routes, tab and shared sources with the given extension (".ts" or ".html"), as one text. */
export function readAdminScreen(root, extension) {
  const files = [contractPath(root, `${ADMIN_SHELL}${extension}`)];
  if (extension === '.ts') files.push(contractPath(root, `${ADMIN_LIB}/lib.routes.ts`));
  files.push(...sourcesUnder(root, `${ADMIN_LIB}/tabs`, extension), ...sourcesUnder(root, `${ADMIN_LIB}/shared`, extension));
  return files.map((file) => fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).join('\n');
}

export const readAdminScreenTs = (root = process.cwd()) => readAdminScreen(root, '.ts');
export const readAdminScreenHtml = (root = process.cwd()) => readAdminScreen(root, '.html');
