// End-to-end workflow test (cross-platform Node port of the main path of
// tools/manufacturing/test-full-workflow.ps1, updated for numbered Cuttergrind shelves, coater
// shipments and Cutter Builder machines).
//
//   npm run test:workflow
//
// Needs a running API and a TEST database (it creates fixtures with known-password
// accounts, so the machine's .env must contain GEAR_APPS_ALLOW_TEST_ACCOUNTS=YES).
// GEAR_APPS_BASE_URL overrides http://localhost:3333/api/v1.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureOut = execFileSync(process.execPath, [path.join(root, 'tools/manufacturing/test-data/ensure-workflow-test-fixtures.mjs')], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const fx = JSON.parse(fixtureOut.trim().split(/\r?\n/).pop());
const B = (process.env.GEAR_APPS_BASE_URL || 'http://localhost:3333/api/v1').replace(/\/$/, '');
const login = await (await fetch(B + '/auth/email/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.GEAR_APPS_ADMIN_EMAIL || 'admin@gearapps.local', password: process.env.GEAR_APPS_ADMIN_PASSWORD || 'GearApps-Admin-Only-2026!' }) })).json();
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
const tray = await api('GET', `/trays/scan/${enc(fx.source_tray_serial_number)}`, null, 'scan source tray');
const container = await api('GET', `/containers/scan/${enc(bt.container_serial_number)}`, null, 'scan container');
await api('POST', `/trays/${tray.id}/start-grinding`, {}, 'start grinding');
await api('POST', `/trays/${tray.id}/complete-grinding`, { summary_id: fx.summary_id, part_type_id: fx.part_type_id, scrapped_blade_count: 0, rough_shelf_serial_number: s.rough }, 'complete grinding');
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
console.log(`[PASS] END-TO-END WORKFLOW COMPLETE (${n} API calls) build=${bn}`);
