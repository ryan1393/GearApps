import { componentStyleOffenders, readDanaUiStyles, readFeatureSource } from './source-contract-utils.mjs';

// Administration is split into one component per tab under the admin feature library.
const root = process.cwd();
const admin = readFeatureSource(root, 'libs/truck-log/web/feature/admin/src/lib', ['.ts']);
const dana = readDanaUiStyles(root);

for (const marker of [
  'Drivers, carriers and locations are saved separately, so a returning driver can come with a different carrier.',
  'Each visit keeps its own copy, so edits here never change old records.',
  'class="dana-tabs"',
  'class="dana-tab"',
  '[class.is-active]',
  'tlAdminDriversTab', 'tlAdminCarriersTab', 'tlAdminLocationsTab', 'tlAdminDocksTab',
  'tlAdminAlertsTab', 'tlAdminScheduleTab', 'tlAdminWorkflowTab',
]) {
  if (!admin.includes(marker)) throw new Error(`Administration marker missing: ${marker}`);
}

// The look (tabs, panels, editable tables) comes from Dana UI, shared with Gear Apps.
for (const selector of ['.dana-tabs', '.dana-tab.is-active', '.dana-panel', 'table.dana-table', '.dana-table-actions']) {
  if (!dana.includes(selector)) throw new Error(`Dana UI is missing ${selector}`);
}

const offenders = componentStyleOffenders(root, ['libs/truck-log/web/feature/admin/src/lib']);
if (offenders.length) throw new Error(`Administration styling must come from Dana UI, not component styles: ${offenders.join(', ')}`);

console.log('[PASS] Truck Log Administration uses the shared Dana UI look.');
