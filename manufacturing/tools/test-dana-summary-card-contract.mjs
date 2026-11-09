import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const must = (condition, message) => { if (!condition) throw new Error(message); };
const count = (text, needle) => text.split(needle).length - 1;

const inventory = read('libs/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html');
const locations = read('libs/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html');
const dataDisplay = read('vendor/dana-ui/package/styles/gear-apps/components/data-display.css');
const inventoryCore = read('vendor/dana-ui/package/styles/gear-apps/features/inventory-core.css');
const inventoryRelations = read('vendor/dana-ui/package/styles/gear-apps/features/inventory-relations.css');
const responsive = read('vendor/dana-ui/package/styles/gear-apps/foundation/responsive.css');
const index = read('vendor/dana-ui/package/index.d.ts');

must(count(inventory, 'danaSummaryGrid') === 1, 'Inventory Control Center must use one Dana summary grid.');
must(count(inventory, 'danaSummaryCard') === 4, 'Inventory Control Center must use four Dana summary cards.');
must(count(locations, 'danaSummaryGrid') === 1, 'Blade Locations must use one Dana summary grid.');
must(count(locations, 'danaSummaryCard') === 4, 'Blade Locations must use four Dana summary cards.');
must(index.includes('DanaSummaryGridDirective') && index.includes('DanaSummaryCardDirective'), 'Dana summary directives are not exported.');
must(dataDisplay.includes('Dana summary metrics: canonical compact KPI/summary card') && dataDisplay.includes('.dana-summary-grid,') && dataDisplay.includes('.dana-summary-card,'), 'Canonical Dana summary CSS is missing.');
must(dataDisplay.includes('padding: 14px 15px;'), 'Normal Dana summary card inset changed unexpectedly.');
must(responsive.includes('padding: 19px 20px;'), 'Large-screen Dana summary card inset must be 19px 20px.');
must(!inventoryRelations.includes('.blade-location-summary-card {'), 'Blade Locations still owns a duplicate summary-card surface.');
must(!inventoryRelations.includes('.blade-location-summary-grid {'), 'Blade Locations still owns duplicate summary-grid geometry.');
must(!inventoryRelations.includes('.inventory-overview-kpis-four {'), 'Inventory Control Center still owns duplicate summary-grid geometry.');
must(!inventoryCore.includes('padding: 14px 15px;'), 'Inventory Control Center still owns duplicate summary-card padding.');
must(inventoryCore.includes('.inventory-overview-kpi:hover') && inventoryCore.includes('.inventory-overview-kpi.active'), 'Interactive Inventory Control Center behavior was lost.');
console.log('[PASS] Dana summary card contract: Inventory Control Center and Blade Locations share one component-owned surface, inset, typography, radius, and responsive grid.');
