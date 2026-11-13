import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  workspaceRoot, loadDb, qid, tableExists, tableCount, assertCurrentReferenceSchema,
  foreignKeyEdges, dependentClosure, protectedTableReason,
} from './db-common.mjs';
import { assertNoSapDocumentMetadataForReset } from '../sap-document-reset-safety.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = workspaceRoot(here);
const { Client, config } = loadDb(root);
const client = new Client(config);

async function runTruncate(clearTables, preservedCounts, commit) {
  await client.query('BEGIN');
  try {
    await assertNoSapDocumentMetadataForReset(client);
    await client.query(`TRUNCATE TABLE ${clearTables.map(qid).join(', ')} RESTART IDENTITY`);
    for (const t of clearTables) {
      const n = await tableCount(client, t);
      if (n != null && n !== 0) throw new Error(`${t} still contains ${n} row(s) after clear.`);
    }
    for (const [t, before] of preservedCounts) {
      const after = await tableCount(client, t);
      if (after !== before) throw new Error(`Protected table ${t} changed during clear preflight: before=${before}, after=${after}.`);
    }
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  }
}

await client.connect();
try {
  console.log('\n============================================================');
  console.log(' TRUCK LOG - CLEAR OPERATIONAL + RXO + REFERENCE DATA + DOCKS');
  console.log('============================================================\n');
  console.log(`[INFO] Database: ${config.host}:${config.port}/${config.database}`);
  await assertCurrentReferenceSchema(client);

  const roots = ['truck_visits','scheduled_loads','drivers','carriers','locations','docks','rxo_import_batches','rxo_orders','rxo_shipments','rxo_freight_visibility','rxo_order_shipment_links','rxo_expedite_import_batches','rxo_expedite_shipment_snapshots'];
  const existingRoots = [];
  for (const t of roots) if (await tableExists(client, t)) existingRoots.push(t);
  for (const required of ['truck_visits','drivers','carriers','locations','docks']) {
    if (!existingRoots.includes(required)) throw new Error(`Required table public.${required} was not found.`);
  }

  const clearTables = dependentClosure(existingRoots, await foreignKeyEdges(client));
  const protectedHits = clearTables.map(t => ({t, why:protectedTableReason(t)})).filter(x => x.why);
  if (protectedHits.length) {
    throw new Error(`Refusing to clear because FK closure reaches protected table(s): ${protectedHits.map(x=>`${x.t} (${x.why})`).join(', ')}`);
  }

  console.log('[INFO] Tables that will be cleared:');
  for (const t of clearTables) console.log(`  - ${t}: ${await tableCount(client,t)} row(s)`);
  const preservedCounts = new Map();
  for (const t of ['app_settings','users','roles','permissions']) {
    const n = await tableCount(client, t);
    if (n != null) preservedCounts.set(t, n);
  }

  console.log('\n[CLEAR] Docks, standard RXO, and RXO Expedite ingestion rows are included in this reset.');
  console.log('[KEEP] app_settings / plant identity, users/auth/session, schema metadata.');
  console.log('[INFO] Running rollback-only TRUNCATE preflight...');
  await runTruncate(clearTables, preservedCounts, false);
  console.log('[PASS] Preflight succeeded and was rolled back. Nothing has been cleared yet.\n');

  if (!process.argv.includes('--yes')) {
    const rl = readline.createInterface({ input:process.stdin, output:process.stdout });
    const answer = (await rl.question('Type CLEAR to permanently clear the rows listed above: ')).trim();
    rl.close();
    if (answer !== 'CLEAR') {
      console.log('Cancelled. Database was not changed.');
      process.exit(0);
    }
  }

  await runTruncate(clearTables, preservedCounts, true);
  console.log('\n[PASS] Truck Log operational/RXO/reference data and Docks cleared.');
  console.log('[PASS] Plant/settings and users/auth were preserved.');
} finally {
  await client.end();
}
