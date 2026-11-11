// End-to-end workflow test (cross-platform Node port of the main path of
// tools/manufacturing/test-full-workflow.ps1, updated for numbered Cuttergrind shelves, coater
// shipments and Cutter Builder machines).
//
//   npm run test:workflow
//
// Needs a running API and a TEST database (it creates fixtures with known-password
// accounts, so the machine's .env must contain MESHFORGE_ALLOW_TEST_ACCOUNTS=YES).
// MESHFORGE_BASE_URL overrides http://localhost:3333/api/v1.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureOut = execFileSync(process.execPath, [path.join(root, 'tools/manufacturing/test-data/ensure-workflow-test-fixtures.mjs')], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const fx = JSON.parse(fixtureOut.trim().split(/\r?\n/).pop());
const B = (process.env.MESHFORGE_BASE_URL || 'http://localhost:3333/api/v1').replace(/\/$/, '');
const login = await (await fetch(B + '/auth/email/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.MESHFORGE_ADMIN_EMAIL || 'admin@meshforge.local', password: process.env.MESHFORGE_ADMIN_PASSWORD || 'MeshForge-Admin-Only-2026!' }) })).json();
if (!login.accessToken) throw new Error('Admin login failed; run tools/manufacturing/test-data/ensure-automatic-test-user.mjs first.');
const H = { authorization: 'Bearer ' + login.accessToken, 'content-type': 'application/json' };
const enc = encodeURIComponent; let n = 0;
async function api(method, path, body, label, expect = [200, 201]) {
  const r = await fetch(B + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  const ok = expect.includes(r.status); n++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${String(r.status).padEnd(3)} ${label}${ok ? '' : ' :: ' + t.slice(0, 220)}`);
  if (!ok) process.exit(1);
  return j;
}
const s = fx.shelves, bt = fx.blade_tracking;
// The fixture uses whichever requirement the database has; set counts are matched inner/outer sets.
const setCount = Number(fx.required_blade_count);
if (!Number.isInteger(setCount) || setCount <= 0) throw new Error('Fixture did not report its required blade-set count');
const tray = await api('GET', `/trays/scan/${enc(fx.source_tray_serial_number)}`, null, 'scan source tray');
const container = await api('GET', `/containers/scan/${enc(bt.container_serial_number)}`, null, 'scan container');
await api('POST', `/trays/${tray.id}/start-grinding`, {}, 'reject missing grinder', [422]);
await api('POST', `/trays/${tray.id}/start-grinding`, { grinding_machine_id: fx.cutter_builder_machine_id }, 'reject non-grinder machine', [422]);
await api('POST', `/trays/${tray.id}/start-grinding`, { grinding_machine_id: fx.grinding_machine_id }, 'start grinding');
await api('PATCH', `/admin/master-data/machines/${fx.grinding_machine_id}`, { enabled: false }, 'protect active grinder from disabling', [409]);
await api('POST', `/trays/${tray.id}/complete-grinding`, { grinding_machine_id: fx.alternate_grinding_machine_id, summary_id: fx.summary_id, part_type_id: fx.part_type_id, scrapped_blade_count: 0, rough_shelf_serial_number: s.rough }, 'reject completion on a different grinder', [409]);
await api('POST', `/trays/${tray.id}/complete-grinding`, { grinding_machine_id: fx.grinding_machine_id, summary_id: fx.summary_id, part_type_id: fx.part_type_id, scrapped_blade_count: 0, rough_shelf_serial_number: s.rough }, 'complete grinding');
const passes = await api('GET', `/trays/${tray.id}/grinding-runs`, null, 'read tray grinder history');
if (passes[0]?.grinding_machine_id !== fx.grinding_machine_id || passes[0]?.grinding_machine_number !== 'E2E-GRINDER') throw new Error('Completed pass lost grinder identity');
const grinderPasses = await api('GET', `/trays/grinding-machines/${fx.grinding_machine_id}/runs`, null, 'read individual grinder history');
if (!grinderPasses.some(pass => pass.id === passes[0].id && pass.tray.serial_number === tray.serial_number)) throw new Error('Individual grinder history is missing its tray');
await api('POST', '/containerTrays', { tray_id: tray.id, container_id: container.id, enabled: true }, 'load tray into coater container');
let sh = await api('POST', '/coater-shipments', { request_id: crypto.randomUUID(), destination: 'E2E Coater', notes: 'node-workflow' }, 'create coater shipment');
const rev = x => x.revision ?? x.shipment?.revision;
const sid = sh.id ?? sh.shipment?.id;
sh = await api('POST', `/coater-shipments/${sid}/containers`, { revision: rev(sh), serial: bt.container_serial_number }, 'add container to shipment');
sh = await api('POST', `/coater-shipments/${sid}/review`, { revision: rev(sh) }, 'review shipment');
sh = await api('POST', `/coater-shipments/${sid}/print`, { revision: rev(sh) }, 'print shipment manifest');
sh = await api('POST', `/coater-shipments/${sid}/dispatch`, { revision: rev(sh), printed_and_checked: true }, 'dispatch shipment');
await api('POST', `/containerTrays/container/${container.id}/tray/${tray.id}/unload`, { shelf_location_serial_number: s.dull }, 'reject dull shelf for coated tray', [422]);
await api('POST', `/containerTrays/container/${container.id}/tray/${tray.id}/unload`, { shelf_location_serial_number: s.finished }, 'receive to finished shelf');
const build = await api('POST', '/cutter-builder/builds', { cutter_body_identifier: fx.cutter_body_serial_number, tray_serial_number: fx.source_tray_serial_number, cutter_builder_machine_id: fx.cutter_builder_machine_id, honed: false, coated: true, comments: 'node-workflow' }, 'create cutter build');
const bn = build.build.build_number;
await api('POST', '/greenshed/setup', { build_number: bn, machine_number: fx.machine_number, part_number: fx.wrong_type_part_number, shift: 'TEST', starting_piece_count: 0, comments: 'x' }, 'reject wrong part type', [409]);
await api('POST', '/greenshed/setup', { build_number: bn, machine_number: fx.machine_number, part_number: fx.part_number, shift: 'TEST', starting_piece_count: 0, comments: 'node-workflow setup' }, 'setup cutter on machine');
await api('POST', '/greenshed/quality-check', { build_number: bn, check_type_code: 'FC', result_code: 'PASS', piece_count: 50, comments: 'qc', frequency: { tooth_thickness: 1.0, total_fr: 1.0 } }, 'quality check');
await api('POST', `/greenshed/machines/${enc(fx.machine_number)}/piece-count`, { piece_count: 100 }, 'update piece count');
await api('POST', '/greenshed/pull', { build_number: bn, reason_code: fx.changeover_reason_code, shelf_location_serial_number: s.finished, comments: 'bad' }, 'reject cuttergrind shelf on changeover', [422]);
await api('POST', '/greenshed/pull', { build_number: bn, reason_code: fx.changeover_reason_code, shelf_location_serial_number: s.greenshed, comments: 'changeover' }, 'changeover to greenshed shelf');
await api('POST', '/greenshed/setup', { build_number: bn, machine_number: fx.machine_number, part_number: fx.part_number, shift: 'TEST', starting_piece_count: 100, comments: 're-setup' }, 're-setup after changeover');
await api('POST', '/greenshed/pull', { build_number: bn, reason_code: fx.teardown_reason_code, comments: 'teardown pull' }, 'pull for teardown');
await api('POST', '/cutter-builder/teardowns', { build_number: bn, teardown_tray_serial_number: fx.teardown_tray_serial_number, shelf_location_serial_number: s.finished, scrapped_blade_count: 0, comments: 'bad' }, 'reject finished shelf for teardown', [422]);
await api('POST', '/cutter-builder/teardowns', { build_number: bn, teardown_tray_serial_number: fx.teardown_tray_serial_number, shelf_location_serial_number: s.dull, scrapped_blade_count: 0, comments: 'teardown' }, 'teardown cutter');

// Current way of packing: grind the torn-down tray straight into an empty coater container. The
// set goes to COATER-STAGING by default, the tray empties, and Cancel Last puts everything back.
const td = await api('GET', `/trays/scan/${enc(fx.teardown_tray_serial_number)}`, null, 'scan torn-down tray');
await api('POST', `/trays/${td.id}/start-grinding`, { grinding_machine_id: fx.grinding_machine_id }, 'start grinding torn-down tray');
const grind = { grinding_machine_id: fx.grinding_machine_id, summary_id: fx.summary_id, part_type_id: fx.part_type_id, scrapped_blade_count: 0 };
await api('POST', `/trays/${td.id}/complete-grinding`, { ...grind, destination: 'CONTAINER' }, 'reject container destination without a container', [422]);
await api('POST', `/trays/${td.id}/complete-grinding`, { ...grind, destination: 'CONTAINER', container_serial_number: bt.container_serial_number, rough_shelf_serial_number: s.dull }, 'reject a dull shelf as the coater location', [400, 422]);
let packed = await api('POST', `/trays/${td.id}/complete-grinding`, { ...grind, container_serial_number: bt.container_serial_number }, 'complete grinding into coater container');
if (!packed.tray_emptied || packed.location_serial_number !== 'COATER-STAGING' || packed.container_serial_number !== bt.container_serial_number) throw new Error('Grinding into a container did not empty the tray at COATER-STAGING: ' + JSON.stringify(packed));
let emptied = await api('GET', `/trays/scan/${enc(fx.teardown_tray_serial_number)}`, null, 'read emptied tray');
if (emptied.blade_count !== 0 || emptied.current_stage?.code !== 'EMPTY') throw new Error('Tray was not emptied after its set went into the container');
let box = await api('GET', `/containers/scan/${enc(bt.container_serial_number)}`, null, 'read container set');
if (box.blade_set?.blades?.length !== setCount || box.blade_set.location_serial_number !== 'COATER-STAGING' || box.workflow_eligibility.load) throw new Error('Container does not hold exactly one staged set: ' + JSON.stringify(box.blade_set));
const undo = await api('GET', `/workflow-cancellation/blade-tracking?identifier=${enc(fx.teardown_tray_serial_number)}`, null, 'read cancel last for packing');
if (!undo.latest?.can_cancel) throw new Error('Grinding into a container cannot be canceled: ' + JSON.stringify(undo.latest));
await api('POST', '/workflow-cancellation/blade-tracking', { identifier: fx.teardown_tray_serial_number, operation_id: undo.latest.id, reason: 'workflow test undo' }, 'cancel grinding into container');
box = await api('GET', `/containers/scan/${enc(bt.container_serial_number)}`, null, 'read container after undo');
const restored = await api('GET', `/trays/scan/${enc(fx.teardown_tray_serial_number)}`, null, 'read tray after undo');
if (box.blade_set || restored.blade_count !== setCount || restored.current_stage?.code !== 'GRINDING') throw new Error('Cancel Last did not restore the tray and empty the container');
packed = await api('POST', `/trays/${td.id}/complete-grinding`, { ...grind, container_serial_number: bt.container_serial_number }, 'complete grinding into coater container again');
let sh2 = await api('POST', '/coater-shipments', { request_id: crypto.randomUUID(), destination: 'E2E Coater', notes: 'node-workflow set' }, 'create set shipment');
const sid2 = sh2.id ?? sh2.shipment?.id;
sh2 = await api('POST', `/coater-shipments/${sid2}/containers`, { revision: rev(sh2), serial: bt.container_serial_number }, 'add set container to shipment');
const setRow = (sh2.manifest ?? sh2.shipment?.manifest)?.containers?.[0]?.trays?.[0];
if (setRow?.kind !== 'SET' || setRow.count !== setCount || setRow.rough_shelf !== 'COATER-STAGING') throw new Error('Shipment manifest is missing the container set: ' + JSON.stringify(setRow));
sh2 = await api('POST', `/coater-shipments/${sid2}/review`, { revision: rev(sh2) }, 'review set shipment');
sh2 = await api('POST', `/coater-shipments/${sid2}/print`, { revision: rev(sh2) }, 'print set shipment');
sh2 = await api('POST', `/coater-shipments/${sid2}/dispatch`, { revision: rev(sh2), printed_and_checked: true }, 'dispatch set shipment');
const src = await api('GET', `/trays/scan/${enc(fx.source_tray_serial_number)}`, null, 'scan empty tray for the returned set');
await api('POST', `/containerTrays/container/${container.id}/tray/${src.id}/unload`, { shelf_location_serial_number: s.rough }, 'reject rough shelf for returned set', [422]);
await api('POST', `/containerTrays/container/${container.id}/tray/${src.id}/unload`, { shelf_location_serial_number: s.finished }, 'receive set into empty tray on finished shelf');
const ready = await api('GET', `/trays/scan/${enc(fx.source_tray_serial_number)}`, null, 'read tray holding returned set');
if (ready.blade_count !== setCount || ready.current_stage?.code !== 'READY_FOR_CUTTER') throw new Error('Returned set is not ready for a cutter build in its new tray');
box = await api('GET', `/containers/scan/${enc(bt.container_serial_number)}`, null, 'read container after receiving');
if (box.blade_set || !box.workflow_eligibility.load) throw new Error('Container is not empty and reusable after receiving its set');
console.log(`[PASS] END-TO-END WORKFLOW COMPLETE (${n} API calls) build=${bn}`);
